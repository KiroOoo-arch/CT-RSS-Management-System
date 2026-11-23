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
import { parseOptionalIntParam, parseStrictIntParam } from '../utils/apiValidation.ts';

function extractIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export async function getCoordinatorReportTemplates(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const templates = await listReportTemplates(
    parseOptionalIntParam(req.query.collegeId, 'INVALID_COLLEGE_ID', 'college identifier'),
  );
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
  const templateId = parseStrictIntParam(req.params.templateId, 'INVALID_REPORT_TEMPLATE_ID', 'report template identifier');
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
  if (reportTypeRaw !== undefined && reportTypeRaw !== 'individual' && reportTypeRaw !== 'section') {
    throw new AppError(400, 'INVALID_REPORT_TYPE', 'Invalid report type filter.');
  }
  const reportType =
    reportTypeRaw === 'individual' || reportTypeRaw === 'section'
      ? (reportTypeRaw as ReportType)
      : undefined;

  const page = parseOptionalIntParam(req.query.page, 'INVALID_PAGE', 'page');
  const pageSize = parseOptionalIntParam(req.query.pageSize, 'INVALID_PAGE_SIZE', 'page size');

  const result = await listRssReports({
    reportType,
    studentId: parseOptionalIntParam(req.query.studentId, 'INVALID_STUDENT_ID', 'student identifier'),
    sectionId: parseOptionalIntParam(req.query.sectionId, 'INVALID_SECTION_ID', 'section identifier'),
    academicYearId: parseOptionalIntParam(req.query.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    page: page !== undefined && page > 0 ? page : undefined,
    pageSize: pageSize !== undefined && pageSize > 0 ? pageSize : undefined,
  });

  const payload: ApiSuccessResponse<{
    reports: typeof result.reports;
    totalCount: number;
    page: number;
    pageSize: number;
  }> = {
    success: true,
    data: {
      reports: result.reports,
      totalCount: result.totalCount,
      page: result.page,
      pageSize: result.pageSize,
    },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorIndividualReportPreviewHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const studentId = parseStrictIntParam(req.query.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const preview = await getIndividualReportPreview({
    studentId,
    academicYearId: parseOptionalIntParam(req.query.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
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
  const sectionId = parseStrictIntParam(req.query.sectionId, 'INVALID_SECTION_ID', 'section identifier');
  const preview = await getSectionReportPreview({
    sectionId,
    academicYearId: parseOptionalIntParam(req.query.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
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
  const reportId = parseStrictIntParam(req.params.reportId, 'INVALID_REPORT_ID', 'report identifier');
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
  const [result, preview] = await Promise.all([
    listRssReports({
      reportType: 'individual',
      studentId: req.authUser.student.id,
      page: parseOptionalIntParam(req.query.page, 'INVALID_PAGE', 'page'),
      pageSize: parseOptionalIntParam(req.query.pageSize, 'INVALID_PAGE_SIZE', 'page size'),
    }),
    getIndividualReportPreview({
      studentId: req.authUser.student.id,
      academicYearId: parseOptionalIntParam(req.query.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    }),
  ]);

  const payload: ApiSuccessResponse<{
    reports: typeof result.reports;
    totalCount: number;
    page: number;
    pageSize: number;
    preview: typeof preview;
  }> = {
    success: true,
    data: {
      reports: result.reports,
      totalCount: result.totalCount,
      page: result.page,
      pageSize: result.pageSize,
      preview,
    },
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
  const reportId = parseStrictIntParam(req.params.reportId, 'INVALID_REPORT_ID', 'report identifier');
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
