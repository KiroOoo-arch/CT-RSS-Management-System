import type { NextFunction, Response } from 'express';
import { isDatabaseConfigured, query } from '../config/database.ts';
import type { ContextualRequest } from './requestContext.ts';
import { AppError } from './errorHandler.ts';
import type {
  AccountStatus,
  AuthenticatedUser,
  RegistrationStatus,
  RoleName,
  StudentSummary,
} from '../types/api.ts';
import {
  deriveCsrfToken,
  hashSessionId,
  isSessionRevoked,
  parseCookies,
  SESSION_COOKIE_NAME,
  safeCompareHex,
  verifyCsrfToken,
  verifySessionToken,
} from '../utils/session.ts';

export interface AuthenticatedRequest extends ContextualRequest {
  authUser?: AuthenticatedUser;
  sessionId?: string;
  sessionExp?: number;
  csrfToken?: string;
}

const VALID_ROLES: ReadonlySet<RoleName> = new Set<RoleName>([
  'RSS Coordinator',
  'Student',
  'Section Representative',
]);

export function resolvePrimaryRole(roles: RoleName[]): RoleName {
  if (roles.includes('RSS Coordinator')) {
    return 'RSS Coordinator';
  }
  if (roles.includes('Section Representative')) {
    return 'Section Representative';
  }
  return 'Student';
}

interface UserDbRow {
  id: number;
  name: string;
  email: string;
  account_status: AccountStatus;
  remember_token: string | null;
}

interface RoleDbRow {
  name: string;
}

interface StudentDbRow {
  id: number;
  student_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  sex: string | null;
  birth_date: string | null;
  contact_number: string | null;
  registration_status: RegistrationStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
}

export async function loadAuthenticatedUserById(
  userId: number,
): Promise<{ user: AuthenticatedUser; rememberToken: string | null } | null> {
  const userRes = await query<UserDbRow>(
    `SELECT id, name, email, account_status, remember_token
     FROM users
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [userId],
  );

  const userRow = userRes.rows[0];
  if (!userRow) {
    return null;
  }

  const rolesRes = await query<RoleDbRow>(
    `SELECT r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userRow.id],
  );

  const roles = rolesRes.rows
    .map((r) => r.name as RoleName)
    .filter((name) => VALID_ROLES.has(name));

  if (roles.length === 0) {
    return null;
  }

  const studentRes = await query<StudentDbRow>(
    `SELECT
       id,
       student_number,
       first_name,
       middle_name,
       last_name,
       suffix,
       sex,
       birth_date::text AS birth_date,
       contact_number,
       registration_status,
       reviewed_by,
       reviewed_at::text AS reviewed_at
     FROM students
     WHERE user_id = $1
     LIMIT 1`,
    [userRow.id],
  );

  const studentRow = studentRes.rows[0];
  const student: StudentSummary | null = studentRow
    ? {
        id: Number(studentRow.id),
        studentNumber: studentRow.student_number,
        firstName: studentRow.first_name,
        middleName: studentRow.middle_name,
        lastName: studentRow.last_name,
        suffix: studentRow.suffix,
        sex: studentRow.sex,
        birthDate: studentRow.birth_date,
        contactNumber: studentRow.contact_number,
        registrationStatus: studentRow.registration_status,
        reviewedBy: studentRow.reviewed_by ? Number(studentRow.reviewed_by) : null,
        reviewedAt: studentRow.reviewed_at,
      }
    : null;

  return {
    user: {
      id: Number(userRow.id),
      name: userRow.name,
      email: userRow.email,
      accountStatus: userRow.account_status,
      roles,
      primaryRole: resolvePrimaryRole(roles),
      student,
    },
    rememberToken: userRow.remember_token,
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required. Please sign in.');
    }

    const session = verifySessionToken(token);
    if (!session || isSessionRevoked(session.sid)) {
      throw new AppError(401, 'SESSION_INVALID', 'Your session has expired or been signed out.');
    }

    if (!isDatabaseConfigured()) {
      throw new AppError(
        503,
        'DATABASE_NOT_CONFIGURED',
        'PostgreSQL database is not configured; authentication cannot be verified.',
      );
    }

    const loaded = await loadAuthenticatedUserById(session.uid);
    if (!loaded) {
      throw new AppError(401, 'SESSION_INVALID', 'Authenticated account is no longer valid.');
    }

    const expectedHash = hashSessionId(session.sid);
    if (!safeCompareHex(loaded.rememberToken, expectedHash)) {
      throw new AppError(401, 'SESSION_REVOKED', 'Session has been invalidated. Please sign in again.');
    }

    if (loaded.user.accountStatus !== 'active') {
      throw new AppError(
        403,
        'ACCOUNT_NOT_ACTIVE',
        `Your account status is "${loaded.user.accountStatus}" and cannot access portal resources.`,
      );
    }

    if (
      loaded.user.roles.includes('Student') &&
      !loaded.user.roles.includes('RSS Coordinator')
    ) {
      if (!loaded.user.student || loaded.user.student.registrationStatus !== 'approved') {
        throw new AppError(
          403,
          'REGISTRATION_NOT_APPROVED',
          'Student registration must be approved by an RSS Coordinator before accessing portal features.',
        );
      }
    }

    req.authUser = loaded.user;
    req.sessionId = session.sid;
    req.sessionExp = session.exp;
    req.csrfToken = deriveCsrfToken(loaded.user.id, session.sid);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCsrf(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  if (!req.authUser || !req.sessionId) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
    return;
  }

  const headerToken = req.header('x-csrf-token');
  if (!verifyCsrfToken(req.authUser.id, req.sessionId, headerToken)) {
    next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF security token.'));
    return;
  }

  next();
}

export function requireRole(...allowedRoles: RoleName[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
      return;
    }

    const hasAccess = req.authUser.roles.some((role) => allowedRoles.includes(role));
    if (!hasAccess) {
      next(
        new AppError(
          403,
          'FORBIDDEN',
          'You do not have permission to perform this action.',
        ),
      );
      return;
    }

    next();
  };
}

export function requireStudentOwnership(paramName = 'studentId') {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
      return;
    }

    if (req.authUser.roles.includes('RSS Coordinator')) {
      next();
      return;
    }

    const requestedId = Number.parseInt(req.params[paramName] ?? '', 10);
    if (!Number.isInteger(requestedId) || requestedId <= 0) {
      next(new AppError(400, 'INVALID_STUDENT_ID', 'Invalid student identifier.'));
      return;
    }

    if (
      req.authUser.roles.includes('Student') &&
      req.authUser.student &&
      req.authUser.student.id === requestedId
    ) {
      next();
      return;
    }

    next(
      new AppError(
        403,
        'FORBIDDEN',
        'Students and Section Representatives cannot access another student record.',
      ),
    );
  };
}
