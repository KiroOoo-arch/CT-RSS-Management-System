import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  assignRoleToUser,
  decideStudentRegistration,
  getStudentProfileById,
  listStudentRegistrations,
  updateAccountStatus,
} from '../services/rbacService.ts';
import type { ApiSuccessResponse, RegistrationRecord } from '../types/api.ts';

function extractClientIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export async function getCoordinatorRegistrations(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const statusQuery = typeof req.query.status === 'string' ? req.query.status : undefined;
  const registrations = await listStudentRegistrations(statusQuery);

  const response: ApiSuccessResponse<{ registrations: RegistrationRecord[] }> = {
    success: true,
    data: { registrations },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorRegistrationDecision(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const studentId = Number.parseInt(req.params.studentId ?? '', 10);
  const body = (req.body ?? {}) as { decision?: unknown; remarks?: unknown };
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null;

  if (!decision) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Decision must be "approved" or "rejected".');
  }

  const result = await decideStudentRegistration({
    studentId,
    decision,
    coordinatorUserId: req.authUser.id,
    remarks: typeof body.remarks === 'string' ? body.remarks : undefined,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorAssignRole(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const targetUserId = Number.parseInt(req.params.userId ?? '', 10);
  const body = (req.body ?? {}) as { roleName?: unknown };
  const roleName = typeof body.roleName === 'string' ? body.roleName : '';

  const result = await assignRoleToUser({
    targetUserId,
    roleName,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function patchCoordinatorUserStatus(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const targetUserId = Number.parseInt(req.params.userId ?? '', 10);
  const body = (req.body ?? {}) as { status?: unknown; reason?: unknown };
  const status = typeof body.status === 'string' ? body.status : '';

  const result = await updateAccountStatus({
    targetUserId,
    status,
    coordinatorUserId: req.authUser.id,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getOwnStudentProfile(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(404, 'STUDENT_PROFILE_MISSING', 'No student profile is linked to this account.');
  }

  const profile = await getStudentProfileById(req.authUser.student.id);
  const response: ApiSuccessResponse<typeof profile> = {
    success: true,
    data: profile,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getStudentProfileScoped(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const studentId = Number.parseInt(req.params.studentId ?? '', 10);
  const profile = await getStudentProfileById(studentId);
  const response: ApiSuccessResponse<typeof profile> = {
    success: true,
    data: profile,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getSectionRepOverview(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const response: ApiSuccessResponse<{
    accessMode: 'read_only';
    college: string;
    role: 'Section Representative';
    message: string;
  }> = {
    success: true,
    data: {
      accessMode: 'read_only',
      college: 'College of Technology',
      role: 'Section Representative',
      message:
        'Section-level academic assignments and participation summaries connect in Milestones 4–10. No private student credentials or approval actions are exposed.',
    },
    requestId: req.requestId,
  };
  res.json(response);
}
