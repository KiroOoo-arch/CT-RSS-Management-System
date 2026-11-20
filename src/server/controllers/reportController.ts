import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  createReportTemplate,
  generateIndividualReportPdf,
  generateSectionReportPdf,
  getAuthorizedReportFile,
  getIndividualReportPreview,
  getSectionReportPreview,
  listReportTemplates,
  listRssReports,
  updateReportTemplate,
  updateRssReportStatus,
} from '../services/reportService.ts';
import { resolveSectionRepAssignedSectionId } from '../services/systemModulesService.ts';
import type { ApiSuccessResponse, ReportStatus, ReportType } from '../types/api.ts';

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

export async function getCoordinatorReportTemplates(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const templates = await listReportTemplates(parseOptionalInt(req.query.collegeId));
  const payload: ApiSuccessResponse<{ templates: typeof templates }> = {
    success: true,
    data: { templates },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorReportTemplate(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as {
    collegeId?: unknown;
    templateName?: unknown;
    templateVersion?: unknown;
    isActive?: unknown;
    config?: unknown;
  };

  const template = await createReportTemplate({
    collegeId: Number(body.collegeId),
    templateName: typeof body.templateName === 'string' ? body.templateName : '',
    templateVersion: typeof body.templateVersion === 'string' ? body.templateVersion : '',
    isActive: body.isActive !== false,
    config: body.config,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ template: typeof template }> = {
    success: true,
    data: { template },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function patchCoordinatorReportTemplate(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const templateId = Number.parseInt(req.params.templateId ?? '', 10);
  const body = (req.body ?? {}) as {
    templateName?: unknown;
    isActive?: unknown;
    config?: unknown;
  };

  const template = await updateReportTemplate({
    templateId,
    templateName: typeof body.templateName === 'string' ? body.templateName : undefined,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    config: body.config,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ template: typeof template }> = {
    success: true,
    data: { template },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorReportsList(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const reportTypeRaw = typeof req.query.reportType === 'string' ? req.query.reportType : undefined;
  const reportType =
    reportTypeRaw === 'individual' || reportTypeRaw === 'section'
      ? (reportTypeRaw as ReportType)
      : undefined;

  const reports = await listRssReports({
    reportType,
    studentId: parseOptionalInt(req.query.studentId),
    sectionId: parseOptionalInt(req.query.sectionId),
    academicYearId: parseOptionalInt(req.query.academicYearId),
  });

  const payload: ApiSuccessResponse<{ reports: typeof reports }> = {
    success: true,
    data: { reports },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorIndividualReportPreviewHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const studentId = Number.parseInt(String(req.query.studentId ?? ''), 10);
  const preview = await getIndividualReportPreview({
    studentId,
    academicYearId: parseOptionalInt(req.query.academicYearId),
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
  });

  const payload: ApiSuccessResponse<{ preview: typeof preview }> = {
    success: true,
    data: { preview },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorGenerateIndividualReport(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as {
    studentId?: unknown;
    templateId?: unknown;
    academicYearId?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
  };

  const report = await generateIndividualReportPdf({
    studentId: Number(body.studentId),
    templateId:
      body.templateId !== undefined && body.templateId !== null && body.templateId !== ''
        ? Number(body.templateId)
        : undefined,
    academicYearId:
      body.academicYearId !== undefined &&
      body.academicYearId !== null &&
      body.academicYearId !== ''
        ? Number(body.academicYearId)
        : undefined,
    dateFrom: typeof body.dateFrom === 'string' ? body.dateFrom : undefined,
    dateTo: typeof body.dateTo === 'string' ? body.dateTo : undefined,
    coordinatorUserId: req.authUser.id,
    coordinatorName: req.authUser.name,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ report: typeof report }> = {
    success: true,
    data: { report },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function getCoordinatorSectionReportPreviewHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const sectionId = Number.parseInt(String(req.query.sectionId ?? ''), 10);
  const preview = await getSectionReportPreview({
    sectionId,
    academicYearId: parseOptionalInt(req.query.academicYearId),
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    includeComparison: req.query.includeComparison === 'true',
  });

  const payload: ApiSuccessResponse<{ preview: typeof preview }> = {
    success: true,
    data: { preview },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorGenerateSectionReport(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as {
    sectionId?: unknown;
    academicYearId?: unknown;
    templateId?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
  };

  const report = await generateSectionReportPdf({
    sectionId: Number(body.sectionId),
    academicYearId:
      body.academicYearId !== undefined &&
      body.academicYearId !== null &&
      body.academicYearId !== ''
        ? Number(body.academicYearId)
        : undefined,
    templateId:
      body.templateId !== undefined && body.templateId !== null && body.templateId !== ''
        ? Number(body.templateId)
        : undefined,
    dateFrom: typeof body.dateFrom === 'string' ? body.dateFrom : undefined,
    dateTo: typeof body.dateTo === 'string' ? body.dateTo : undefined,
    coordinatorUserId: req.authUser.id,
    coordinatorName: req.authUser.name,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ report: typeof report }> = {
    success: true,
    data: { report },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function patchCoordinatorReportStatus(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const reportId = Number.parseInt(req.params.reportId ?? '', 10);
  const body = (req.body ?? {}) as { status?: unknown };
  const status = String(body.status ?? '') as ReportStatus;

  const report = await updateRssReportStatus({
    reportId,
    status,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ report: typeof report }> = {
    success: true,
    data: { report },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getStudentOwnReports(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const [reports, preview] = await Promise.all([
    listRssReports({
      reportType: 'individual',
      studentId: req.authUser.student.id,
    }),
    getIndividualReportPreview({
      studentId: req.authUser.student.id,
      academicYearId: parseOptionalInt(req.query.academicYearId),
    }),
  ]);

  const payload: ApiSuccessResponse<{ reports: typeof reports; preview: typeof preview }> = {
    success: true,
    data: { reports, preview },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getAuthorizedReportDownloadHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const reportId = Number.parseInt(req.params.reportId ?? '', 10);
  const isCoordinator = req.authUser.roles.includes('RSS Coordinator');
  const sectionRepSectionId = req.authUser.roles.includes('Section Representative')
    ? await resolveSectionRepAssignedSectionId(req.authUser.student?.id ?? null)
    : null;

  const file = await getAuthorizedReportFile({
    reportId,
    isCoordinator,
    studentId: req.authUser.student?.id ?? null,
    sectionRepAssignedSectionId: sectionRepSectionId,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.buffer);
}
