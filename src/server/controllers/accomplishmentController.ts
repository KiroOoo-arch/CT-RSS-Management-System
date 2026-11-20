import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  getAccomplishmentDetail,
  getAuthorizedEvidenceFile,
  initializeStudentAccomplishmentDraft,
  listAccomplishments,
  reviewAccomplishmentSubmission,
  submitStudentAccomplishmentVersion,
  type EvidenceUploadInput,
} from '../services/accomplishmentService.ts';
import type { ApiSuccessResponse, EvidenceImageCategory } from '../types/api.ts';

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

export async function getCoordinatorAccomplishments(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const accomplishments = await listAccomplishments({
    taskId: parseOptionalInt(req.query.taskId),
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
  });

  const payload: ApiSuccessResponse<{ accomplishments: typeof accomplishments }> = {
    success: true,
    data: { accomplishments },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorAccomplishmentDetailHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const accomplishmentId = Number.parseInt(req.params.accomplishmentId ?? '', 10);
  const accomplishment = await getAccomplishmentDetail(accomplishmentId);

  const payload: ApiSuccessResponse<{ accomplishment: typeof accomplishment }> = {
    success: true,
    data: { accomplishment },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorAccomplishmentReview(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const submissionId = Number.parseInt(req.params.submissionId ?? '', 10);
  const body = (req.body ?? {}) as { decision?: unknown; remarks?: unknown };
  const decision =
    body.decision === 'approved' ||
    body.decision === 'revision_required' ||
    body.decision === 'rejected'
      ? body.decision
      : null;
  if (!decision) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Decision must be "approved", "revision_required", or "rejected".',
    );
  }

  const accomplishment = await reviewAccomplishmentSubmission({
    submissionId,
    decision,
    remarks: typeof body.remarks === 'string' ? body.remarks : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ accomplishment: typeof accomplishment }> = {
    success: true,
    data: { accomplishment },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getStudentAccomplishmentsList(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const accomplishments = await listAccomplishments({
    studentId: req.authUser.student.id,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });

  const payload: ApiSuccessResponse<{ accomplishments: typeof accomplishments }> = {
    success: true,
    data: { accomplishments },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getStudentAccomplishmentDetailHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const accomplishmentId = Number.parseInt(req.params.accomplishmentId ?? '', 10);
  const accomplishment = await getAccomplishmentDetail(
    accomplishmentId,
    req.authUser.student.id,
  );

  const payload: ApiSuccessResponse<{ accomplishment: typeof accomplishment }> = {
    success: true,
    data: { accomplishment },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postStudentAccomplishmentDraft(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const body = (req.body ?? {}) as { applicationId?: unknown };

  const accomplishment = await initializeStudentAccomplishmentDraft({
    applicationId: Number(body.applicationId),
    studentId: req.authUser.student.id,
    actorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ accomplishment: typeof accomplishment }> = {
    success: true,
    data: { accomplishment },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function postStudentAccomplishmentSubmission(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const body = (req.body ?? {}) as {
    applicationId?: unknown;
    activityDate?: unknown;
    accomplishmentDescription?: unknown;
    studentRemarks?: unknown;
    evidenceImages?: Array<{
      originalFilename?: unknown;
      mimeType?: unknown;
      dataBase64?: unknown;
      imageCategory?: unknown;
      caption?: unknown;
    }>;
  };

  const rawImages = Array.isArray(body.evidenceImages) ? body.evidenceImages : [];
  const evidenceImages: EvidenceUploadInput[] = rawImages.map((img) => ({
    originalFilename: typeof img.originalFilename === 'string' ? img.originalFilename : 'evidence.jpg',
    mimeType: typeof img.mimeType === 'string' ? img.mimeType : '',
    dataBase64: typeof img.dataBase64 === 'string' ? img.dataBase64 : '',
    imageCategory: String(img.imageCategory ?? 'other') as EvidenceImageCategory,
    caption: typeof img.caption === 'string' ? img.caption : undefined,
  }));

  const accomplishment = await submitStudentAccomplishmentVersion({
    applicationId: Number(body.applicationId),
    studentId: req.authUser.student.id,
    actorUserId: req.authUser.id,
    studentName: req.authUser.name,
    studentNumber: req.authUser.student.studentNumber,
    activityDate: typeof body.activityDate === 'string' ? body.activityDate : '',
    accomplishmentDescription:
      typeof body.accomplishmentDescription === 'string' ? body.accomplishmentDescription : '',
    studentRemarks: typeof body.studentRemarks === 'string' ? body.studentRemarks : undefined,
    evidenceImages,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ accomplishment: typeof accomplishment }> = {
    success: true,
    data: { accomplishment },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function getAuthorizedEvidenceFileHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const imageId = Number.parseInt(req.params.imageId ?? '', 10);
  const isCoordinator = req.authUser.roles.includes('RSS Coordinator');

  const file = await getAuthorizedEvidenceFile({
    imageId,
    isCoordinator,
    studentId: req.authUser.student?.id ?? null,
  });

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${file.originalFilename.replace(/"/g, '')}"`,
  );
  res.send(file.buffer);
}
