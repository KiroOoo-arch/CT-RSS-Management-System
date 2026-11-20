import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  applyToTask,
  getApplicationDetail,
  listCoordinatorApplications,
  listStudentApplications,
  reviewCoordinatorApplication,
  withdrawOrCancelStudentApplication,
} from '../services/applicationService.ts';
import type { ApiSuccessResponse } from '../types/api.ts';

function extractIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

function parseOptionalInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function postStudentTaskApplication(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }

  const taskId = Number.parseInt(req.params.taskId ?? '', 10);
  const body = (req.body ?? {}) as { applicationMessage?: unknown };

  const application = await applyToTask({
    taskId,
    studentId: req.authUser.student.id,
    actorUserId: req.authUser.id,
    studentName: req.authUser.name,
    studentNumber: req.authUser.student.studentNumber,
    applicationMessage:
      typeof body.applicationMessage === 'string' ? body.applicationMessage : undefined,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ application: typeof application }> = {
    success: true,
    data: { application },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function getStudentApplicationsList(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const applications = await listStudentApplications({
    studentId: req.authUser.student.id,
    status,
  });

  const payload: ApiSuccessResponse<{ applications: typeof applications }> = {
    success: true,
    data: { applications },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getStudentApplicationDetailHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const applicationId = Number.parseInt(req.params.applicationId ?? '', 10);
  const application = await getApplicationDetail(applicationId, req.authUser.student.id);

  const payload: ApiSuccessResponse<{ application: typeof application }> = {
    success: true,
    data: { application },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postStudentWithdrawApplication(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const applicationId = Number.parseInt(req.params.applicationId ?? '', 10);
  const body = (req.body ?? {}) as { reason?: unknown };

  const application = await withdrawOrCancelStudentApplication({
    applicationId,
    studentId: req.authUser.student.id,
    actorUserId: req.authUser.id,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ application: typeof application }> = {
    success: true,
    data: { application },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorApplicationsHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = await listCoordinatorApplications({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    taskId: parseOptionalInt(req.query.taskId),
    studentId: parseOptionalInt(req.query.studentId),
    sectionId: parseOptionalInt(req.query.sectionId),
    academicYearId: parseOptionalInt(req.query.academicYearId),
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page: parseOptionalInt(req.query.page),
    pageSize: parseOptionalInt(req.query.pageSize),
  });

  const payload: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorApplicationDetailHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const applicationId = Number.parseInt(req.params.applicationId ?? '', 10);
  const application = await getApplicationDetail(applicationId);

  const payload: ApiSuccessResponse<{ application: typeof application }> = {
    success: true,
    data: { application },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorApplicationDecision(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const applicationId = Number.parseInt(req.params.applicationId ?? '', 10);
  const body = (req.body ?? {}) as { decision?: unknown; remarks?: unknown };
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null;
  if (!decision) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Decision must be "approved" or "rejected".');
  }

  const application = await reviewCoordinatorApplication({
    applicationId,
    decision,
    remarks: typeof body.remarks === 'string' ? body.remarks : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ application: typeof application }> = {
    success: true,
    data: { application },
    requestId: req.requestId,
  };
  res.json(payload);
}
