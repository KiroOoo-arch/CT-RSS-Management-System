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
import { parseOptionalIntParam, parseStrictIntParam } from '../utils/apiValidation.ts';

function extractIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export async function postStudentTaskApplication(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }

  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
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
  const applicationId = parseStrictIntParam(req.params.applicationId, 'INVALID_APPLICATION_ID', 'application identifier');
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
  const applicationId = parseStrictIntParam(req.params.applicationId, 'INVALID_APPLICATION_ID', 'application identifier');
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
    taskId: parseOptionalIntParam(req.query.taskId, 'INVALID_TASK_ID', 'task identifier'),
    studentId: parseOptionalIntParam(req.query.studentId, 'INVALID_STUDENT_ID', 'student identifier'),
    sectionId: parseOptionalIntParam(req.query.sectionId, 'INVALID_SECTION_ID', 'section identifier'),
    academicYearId: parseOptionalIntParam(req.query.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page: parseOptionalIntParam(req.query.page, 'INVALID_PAGE', 'page'),
    pageSize: parseOptionalIntParam(req.query.pageSize, 'INVALID_PAGE_SIZE', 'page size'),
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
  const applicationId = parseStrictIntParam(req.params.applicationId, 'INVALID_APPLICATION_ID', 'application identifier');
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

  const applicationId = parseStrictIntParam(req.params.applicationId, 'INVALID_APPLICATION_ID', 'application identifier');
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
