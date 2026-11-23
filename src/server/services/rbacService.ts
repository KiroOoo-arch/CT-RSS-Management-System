import crypto from 'node:crypto';
import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AccountStatus,
  RegistrationRecord,
  RegistrationStatus,
  RoleName,
} from '../types/api.ts';
import { recordAuditLog } from './auditService.ts';

const VALID_ROLES: ReadonlySet<RoleName> = new Set<RoleName>([
  'RSS Coordinator',
  'Student',
  'Section Representative',
]);

const VALID_ACCOUNT_STATUSES: ReadonlySet<AccountStatus> = new Set<AccountStatus>([
  'pending',
  'active',
  'suspended',
  'deactivated',
]);

interface RegistrationDbRow {
  student_id: number;
  user_id: number;
  student_number: string;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  email: string;
  contact_number: string | null;
  account_status: AccountStatus;
  registration_status: RegistrationStatus;
  submitted_at: string;
  reviewed_at: string | null;
}

export async function listStudentRegistrations(
  statusFilter?: string,
): Promise<RegistrationRecord[]> {
  const normalizedFilter = statusFilter?.trim().toLowerCase();
  const hasFilter =
    normalizedFilter === 'pending' ||
    normalizedFilter === 'approved' ||
    normalizedFilter === 'rejected';
  if (normalizedFilter && !hasFilter) {
    throw new AppError(400, 'INVALID_REGISTRATION_STATUS', 'Invalid registration status filter.');
  }

  const sql = `
    SELECT
      s.id AS student_id,
      u.id AS user_id,
      s.student_number,
      u.name AS full_name,
      s.first_name,
      s.middle_name,
      s.last_name,
      s.suffix,
      u.email,
      s.contact_number,
      u.account_status,
      s.registration_status,
      s.created_at::text AS submitted_at,
      s.reviewed_at::text AS reviewed_at
    FROM students s
    JOIN users u ON u.id = s.user_id
    WHERE u.deleted_at IS NULL
      ${hasFilter ? 'AND s.registration_status = $1' : ''}
    ORDER BY
      CASE WHEN s.registration_status = 'pending' THEN 0 ELSE 1 END,
      s.created_at DESC
  `;

  const res = hasFilter
    ? await query<RegistrationDbRow>(sql, [normalizedFilter])
    : await query<RegistrationDbRow>(sql);

  return res.rows.map((row) => ({
    studentId: Number(row.student_id),
    userId: Number(row.user_id),
    studentNumber: row.student_number,
    fullName: row.full_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    suffix: row.suffix,
    email: row.email,
    contactNumber: row.contact_number,
    accountStatus: row.account_status,
    registrationStatus: row.registration_status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  }));
}

export async function decideStudentRegistration(input: {
  studentId: number;
  decision: 'approved' | 'rejected';
  coordinatorUserId: number;
  remarks?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{
  studentId: number;
  userId: number;
  registrationStatus: RegistrationStatus;
  accountStatus: AccountStatus;
}> {
  if (!Number.isInteger(input.studentId) || input.studentId <= 0) {
    throw new AppError(400, 'INVALID_STUDENT_ID', 'Invalid student identifier.');
  }

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      student_id: number;
      user_id: number;
      registration_status: RegistrationStatus;
      account_status: AccountStatus;
      student_number: string;
    }>(
      `SELECT
         s.id AS student_id,
         u.id AS user_id,
         s.registration_status,
         u.account_status,
         s.student_number
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND u.deleted_at IS NULL
       FOR UPDATE OF s, u`,
      [input.studentId],
    );

    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student registration record not found.');
    }

    if (existing.registration_status !== 'pending') {
      throw new AppError(
        409,
        'ALREADY_REVIEWED',
        `Student registration has already been marked "${existing.registration_status}".`,
      );
    }

    const nextAccountStatus: AccountStatus =
      input.decision === 'approved' ? 'active' : 'deactivated';

    await client.query(
      `UPDATE students
       SET registration_status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [input.decision, input.coordinatorUserId, input.studentId],
    );

    await client.query(
      `UPDATE users
       SET account_status = $1,
           remember_token = CASE WHEN $1::varchar = 'active' THEN remember_token ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2`,
      [nextAccountStatus, Number(existing.user_id)],
    );

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
        Number(existing.user_id),
        input.decision === 'approved'
          ? 'Student Registration Approved'
          : 'Student Registration Declined',
        input.decision === 'approved'
          ? 'Your CT-RSS Student Service Portal account has been verified and activated by the RSS Coordinator.'
          : `Your student registration (${existing.student_number}) was not approved.${input.remarks?.trim() ? ` Remarks: ${input.remarks.trim()}` : ''}`,
        input.decision === 'approved' ? 'registration_approved' : 'registration_rejected',
        'students',
        input.studentId,
      ],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'student_registration_decided',
        subjectType: 'students',
        subjectId: input.studentId,
        oldValues: {
          registration_status: existing.registration_status,
          account_status: existing.account_status,
        },
        newValues: {
          registration_status: input.decision,
          account_status: nextAccountStatus,
          remarks: input.remarks?.trim() || null,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return {
      studentId: Number(existing.student_id),
      userId: Number(existing.user_id),
      registrationStatus: input.decision,
      accountStatus: nextAccountStatus,
    };
  });
}

export async function assignRoleToUser(input: {
  targetUserId: number;
  roleName: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ userId: number; assignedRole: RoleName }> {
  if (!Number.isInteger(input.targetUserId) || input.targetUserId <= 0) {
    throw new AppError(400, 'INVALID_USER_ID', 'Invalid user identifier.');
  }

  const trimmedRole = input.roleName.trim() as RoleName;
  if (!VALID_ROLES.has(trimmedRole)) {
    throw new AppError(
      400,
      'INVALID_ROLE',
      'Only the three approved CT-RSS roles (RSS Coordinator, Student, Section Representative) may be assigned.',
    );
  }

  return withTransaction(async (client) => {
    const userRes = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [input.targetUserId],
    );
    if (userRes.rows.length === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Target user account not found.');
    }

    const roleRes = await client.query<{ id: number }>(
      `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
      [trimmedRole],
    );
    const roleId = roleRes.rows[0]?.id;
    if (!roleId) {
      throw new AppError(500, 'ROLES_NOT_SEEDED', 'Requested role is not present in roles table.');
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [input.targetUserId, roleId, input.coordinatorUserId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'user_role_assigned',
        subjectType: 'users',
        subjectId: input.targetUserId,
        newValues: { role: trimmedRole },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return {
      userId: input.targetUserId,
      assignedRole: trimmedRole,
    };
  });
}

export async function updateAccountStatus(input: {
  targetUserId: number;
  status: string;
  coordinatorUserId: number;
  reason?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ userId: number; accountStatus: AccountStatus }> {
  if (!Number.isInteger(input.targetUserId) || input.targetUserId <= 0) {
    throw new AppError(400, 'INVALID_USER_ID', 'Invalid user identifier.');
  }

  const nextStatus = input.status.trim().toLowerCase() as AccountStatus;
  if (!VALID_ACCOUNT_STATUSES.has(nextStatus)) {
    throw new AppError(
      400,
      'INVALID_ACCOUNT_STATUS',
      'Account status must be one of: pending, active, suspended, deactivated.',
    );
  }

  if (input.targetUserId === input.coordinatorUserId && nextStatus !== 'active') {
    throw new AppError(
      400,
      'SELF_STATUS_LOCK',
      'Coordinators cannot suspend or deactivate their own active session account.',
    );
  }

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      account_status: AccountStatus;
      registration_status: string | null;
    }>(
      `SELECT u.id, u.account_status, s.registration_status
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL
       FOR UPDATE OF u`,
      [input.targetUserId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Target user account not found.');
    }

    const isStudent = existing.registration_status !== null;
    const registrationStatus = existing.registration_status;

    // Student accounts must obey the registration/account consistency matrix.
    // Rejected or pending registrations cannot be activated through this endpoint,
    // and a rejected registration can never be reactivated via account status.
    if (isStudent) {
      if (registrationStatus === 'rejected' && nextStatus !== 'deactivated') {
        throw new AppError(
          409,
          'REGISTRATION_REJECTED',
          'A rejected registration cannot be reactivated through account status. Re-decide the registration first.',
        );
      }
      if (registrationStatus === 'pending' && (nextStatus === 'active' || nextStatus === 'suspended')) {
        throw new AppError(
          409,
          'REGISTRATION_PENDING',
          'A pending registration cannot be activated or suspended through account status. Approve or reject the registration first.',
        );
      }
      if (registrationStatus === 'approved' && nextStatus === 'pending') {
        throw new AppError(
          400,
          'INVALID_ACCOUNT_STATUS',
          'An approved student account cannot be moved back to pending.',
        );
      }
      if (existing.account_status === 'deactivated' && nextStatus === 'suspended') {
        throw new AppError(
          400,
          'INVALID_ACCOUNT_STATUS',
          'A deactivated student account must be reactivated before it can be suspended.',
        );
      }
    }

    await client.query(
      `UPDATE users
       SET account_status = $1,
           remember_token = CASE WHEN $1::varchar = 'active' THEN remember_token ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2`,
      [nextStatus, input.targetUserId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'user_account_status_updated',
        subjectType: 'users',
        subjectId: input.targetUserId,
        oldValues: { account_status: existing.account_status },
        newValues: { account_status: nextStatus, reason: input.reason?.trim() || null },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return {
      userId: input.targetUserId,
      accountStatus: nextStatus,
    };
  });
}

export async function getStudentProfileById(studentId: number) {
  const res = await query<{
    student_id: number;
    user_id: number;
    student_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    suffix: string | null;
    sex: string | null;
    birth_date: string | null;
    email: string;
    contact_number: string | null;
    registration_status: RegistrationStatus;
    account_status: AccountStatus;
    reviewed_at: string | null;
  }>(
    `SELECT
       s.id AS student_id,
       u.id AS user_id,
       s.student_number,
       s.first_name,
       s.middle_name,
       s.last_name,
       s.suffix,
       s.sex,
       s.birth_date::text AS birth_date,
       u.email,
       s.contact_number,
       s.registration_status,
       u.account_status,
       s.reviewed_at::text AS reviewed_at
     FROM students s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [studentId],
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
  }

  const historyRes = await query<{
    id: number;
    section_id: number;
    section_name: string;
    program_id: number;
    program_code: string;
    program_name: string;
    year_level_id: number;
    year_level_name: string;
    academic_year_id: number;
    academic_year_name: string;
    enrolled_at: string;
    ended_at: string | null;
    is_current: boolean;
  }>(
    `SELECT
       ssh.id,
       sec.id AS section_id,
       sec.name AS section_name,
       p.id AS program_id,
       p.code AS program_code,
       p.name AS program_name,
       yl.id AS year_level_id,
       yl.name AS year_level_name,
       ay.id AS academic_year_id,
       ay.name AS academic_year_name,
       ssh.enrolled_at::text AS enrolled_at,
       ssh.ended_at::text AS ended_at,
       ssh.is_current
     FROM student_section_history ssh
     JOIN sections sec ON sec.id = ssh.section_id
     JOIN programs p ON p.id = sec.program_id
     JOIN year_levels yl ON yl.id = sec.year_level_id
     JOIN academic_years ay ON ay.id = ssh.academic_year_id
     WHERE ssh.student_id = $1
     ORDER BY ssh.is_current DESC, ssh.enrolled_at DESC, ssh.id DESC`,
    [studentId],
  );

  const sectionHistory = historyRes.rows.map((h) => ({
    historyId: Number(h.id),
    sectionId: Number(h.section_id),
    sectionName: h.section_name,
    programId: Number(h.program_id),
    programCode: h.program_code,
    programName: h.program_name,
    yearLevelId: Number(h.year_level_id),
    yearLevelName: h.year_level_name,
    academicYearId: Number(h.academic_year_id),
    academicYearName: h.academic_year_name,
    enrolledAt: h.enrolled_at,
    endedAt: h.ended_at,
    isCurrent: Boolean(h.is_current),
  }));

  return {
    studentId: Number(row.student_id),
    userId: Number(row.user_id),
    studentNumber: row.student_number,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    suffix: row.suffix,
    sex: row.sex,
    birthDate: row.birth_date,
    email: row.email,
    contactNumber: row.contact_number,
    registrationStatus: row.registration_status,
    accountStatus: row.account_status,
    reviewedAt: row.reviewed_at,
    currentSection: sectionHistory.find((item) => item.isCurrent) ?? null,
    sectionHistory,
  };
}
