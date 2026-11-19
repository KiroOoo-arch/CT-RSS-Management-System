import crypto from 'node:crypto';
import { isDatabaseConfigured, query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { loadAuthenticatedUserById, resolvePrimaryRole } from '../middleware/auth.ts';
import type {
  AccountStatus,
  AuthenticatedUser,
  RegistrationStatus,
  RoleName,
  StudentSummary,
} from '../types/api.ts';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../utils/password.ts';
import { createSessionToken, revokeSessionId } from '../utils/session.ts';
import { recordAuditLog } from './auditService.ts';

// Pre-computed dummy bcrypt hash (cost 10) to avoid timing differences when user email does not exist.
const DUMMY_PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

interface LoginUserRow {
  id: number;
  name: string;
  email: string;
  password: string;
  account_status: AccountStatus;
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{
  user: AuthenticatedUser;
  sessionToken: string;
  csrfToken: string;
}> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email and password are required.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please enter a valid email address.');
  }

  if (password.length > 128) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (!isDatabaseConfigured()) {
    throw new AppError(
      503,
      'DATABASE_NOT_CONFIGURED',
      'PostgreSQL database is not configured in this environment. Configure SQL_* variables and run migrations to enable sign-in.',
    );
  }

  const userRes = await query<LoginUserRow>(
    `SELECT id, name, email, password, account_status
     FROM users
     WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
     LIMIT 1`,
    [email],
  );

  const userRow = userRes.rows[0];
  if (!userRow) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    await recordAuditLog({
      userId: null,
      action: 'auth_login_failed',
      subjectType: 'users',
      subjectId: null,
      newValues: { reason: 'unknown_email' },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }).catch(() => undefined);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const passwordMatches = await verifyPassword(password, userRow.password);
  if (!passwordMatches) {
    await recordAuditLog({
      userId: Number(userRow.id),
      action: 'auth_login_failed',
      subjectType: 'users',
      subjectId: Number(userRow.id),
      newValues: { reason: 'invalid_password' },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }).catch(() => undefined);

    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const logBlockedAttempt = async (reason: string): Promise<void> => {
    await recordAuditLog({
      userId: Number(userRow.id),
      action: 'auth_login_blocked',
      subjectType: 'users',
      subjectId: Number(userRow.id),
      newValues: { reason },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }).catch(() => undefined);
  };

  if (userRow.account_status === 'pending') {
    await logBlockedAttempt('account_pending');
    throw new AppError(
      403,
      'ACCOUNT_PENDING',
      'Your account is pending approval by the College of Technology RSS Coordinator.',
    );
  }
  if (userRow.account_status === 'suspended') {
    await logBlockedAttempt('account_suspended');
    throw new AppError(
      403,
      'ACCOUNT_SUSPENDED',
      'Your account is currently suspended. Contact the RSS Coordinator for assistance.',
    );
  }
  if (userRow.account_status === 'deactivated') {
    await logBlockedAttempt('account_deactivated');
    throw new AppError(
      403,
      'ACCOUNT_DEACTIVATED',
      'Your account has been deactivated and cannot sign in.',
    );
  }
  if (userRow.account_status !== 'active') {
    await logBlockedAttempt('account_inactive');
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'Your account is not active.');
  }

  const loaded = await loadAuthenticatedUserById(Number(userRow.id));
  if (!loaded || loaded.user.roles.length === 0) {
    await logBlockedAttempt('no_assigned_role');
    throw new AppError(
      403,
      'NO_ASSIGNED_ROLE',
      'No authorized CT-RSS role is assigned to this account.',
    );
  }

  if (
    loaded.user.roles.includes('Student') &&
    !loaded.user.roles.includes('RSS Coordinator')
  ) {
    if (!loaded.user.student) {
      await logBlockedAttempt('student_profile_missing');
      throw new AppError(
        403,
        'STUDENT_PROFILE_MISSING',
        'Student profile record is missing. Contact the RSS Coordinator.',
      );
    }
    if (loaded.user.student.registrationStatus === 'pending') {
      await logBlockedAttempt('registration_pending');
      throw new AppError(
        403,
        'REGISTRATION_PENDING',
        'Your student registration is still pending RSS Coordinator verification.',
      );
    }
    if (loaded.user.student.registrationStatus === 'rejected') {
      await logBlockedAttempt('registration_rejected');
      throw new AppError(
        403,
        'REGISTRATION_REJECTED',
        'Your student registration was not approved. Contact the College of Technology office for details.',
      );
    }
  }

  const session = createSessionToken(loaded.user.id);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users
       SET remember_token = $1, updated_at = NOW()
       WHERE id = $2`,
      [session.sidHash, loaded.user.id],
    );

    await recordAuditLog(
      {
        userId: loaded.user.id,
        action: 'auth_login_success',
        subjectType: 'users',
        subjectId: loaded.user.id,
        newValues: { role: loaded.user.primaryRole },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );
  });

  return {
    user: loaded.user,
    sessionToken: session.token,
    csrfToken: session.csrfToken,
  };
}

export async function registerStudentAccount(input: {
  email: string;
  password: string;
  studentNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  contactNumber?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{
  userId: number;
  studentId: number;
  studentNumber: string;
  email: string;
  accountStatus: AccountStatus;
  registrationStatus: RegistrationStatus;
}> {
  const email = input.email.trim().toLowerCase();
  const studentNumber = input.studentNumber.trim();
  const firstName = input.firstName.trim();
  const middleName = input.middleName?.trim() || null;
  const lastName = input.lastName.trim();
  const suffix = input.suffix?.trim() || null;
  const contactNumber = input.contactNumber?.trim() || null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please enter a valid institutional or personal email address.');
  }
  if (!studentNumber || studentNumber.length < 3 || studentNumber.length > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Student number must be 3–50 characters.');
  }
  if (!firstName || firstName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'First name is required.');
  }
  if (!lastName || lastName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Last name is required.');
  }

  const strengthError = validatePasswordStrength(input.password);
  if (strengthError) {
    throw new AppError(400, 'WEAK_PASSWORD', strengthError);
  }

  if (!isDatabaseConfigured()) {
    throw new AppError(
      503,
      'DATABASE_NOT_CONFIGURED',
      'PostgreSQL database is not configured in this environment. Registration requires a connected database.',
    );
  }

  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ').slice(0, 150);
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const emailDup = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (emailDup.rows.length > 0) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email address already exists.');
    }

    const studentDup = await client.query<{ id: number }>(
      `SELECT id FROM students WHERE LOWER(student_number) = LOWER($1) LIMIT 1`,
      [studentNumber],
    );
    if (studentDup.rows.length > 0) {
      throw new AppError(409, 'STUDENT_NUMBER_EXISTS', 'This student number is already registered.');
    }

    const roleRes = await client.query<{ id: number }>(
      `SELECT id FROM roles WHERE name = 'Student' LIMIT 1`,
    );
    const studentRoleId = roleRes.rows[0]?.id;
    if (!studentRoleId) {
      throw new AppError(
        500,
        'ROLES_NOT_SEEDED',
        'Roles table is not seeded. Run npm run db:migrate first.',
      );
    }

    const userInsert = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password, account_status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [fullName, email, passwordHash],
    );
    const userId = Number(userInsert.rows[0]?.id);

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, NULL)`,
      [userId, studentRoleId],
    );

    const studentInsert = await client.query<{ id: number }>(
      `INSERT INTO students (
         user_id,
         student_number,
         first_name,
         middle_name,
         last_name,
         suffix,
         contact_number,
         registration_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id`,
      [userId, studentNumber, firstName, middleName, lastName, suffix, contactNumber],
    );
    const studentId = Number(studentInsert.rows[0]?.id);

    const coordinatorsRes = await client.query<{ id: number }>(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'RSS Coordinator'
         AND u.account_status = 'active'
         AND u.deleted_at IS NULL`,
    );

    for (const coordinator of coordinatorsRes.rows) {
      await client.query(
        `INSERT INTO notifications (
           id,
           user_id,
           title,
           message,
           notification_type,
           related_type,
           related_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          Number(coordinator.id),
          'New Student Registration Request',
          `${fullName} (${studentNumber}) submitted a registration request awaiting Coordinator approval.`,
          'student_registration',
          'students',
          studentId,
        ],
      );
    }

    await recordAuditLog(
      {
        userId,
        action: 'student_registration_submitted',
        subjectType: 'students',
        subjectId: studentId,
        newValues: {
          student_number: studentNumber,
          email,
          account_status: 'pending',
          registration_status: 'pending',
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return {
      userId,
      studentId,
      studentNumber,
      email,
      accountStatus: 'pending' as const,
      registrationStatus: 'pending' as const,
    };
  });
}

export async function logoutSession(input: {
  userId: number;
  sessionId: string;
  sessionExp?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  revokeSessionId(input.sessionId, input.sessionExp);

  if (isDatabaseConfigured()) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET remember_token = NULL, updated_at = NOW()
         WHERE id = $1`,
        [input.userId],
      );

      await recordAuditLog(
        {
          userId: input.userId,
          action: 'auth_logout',
          subjectType: 'users',
          subjectId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        client,
      );
    });
  }
}

export type { RoleName, StudentSummary };
export { resolvePrimaryRole };
