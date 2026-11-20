import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { listAuditLogs } from '../services/auditService.ts';
import {
  listUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../services/notificationService.ts';
import {
  getDashboardSummaryForUser,
  getSectionRepScopedOverview,
  listSectionRepScopedReports,
  listSectionRepScopedTasks,
} from '../services/systemModulesService.ts';
import type { ApiSuccessResponse } from '../types/api.ts';

function parseOptionalInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function getNotificationsHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
  const status = statusRaw === 'unread' || statusRaw === 'read' ? statusRaw : 'all';
  const result = await listUserNotifications({
    userId: req.authUser.id,
    status,
    limit: parseOptionalInt(req.query.limit),
  });

  const payload: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function patchNotificationReadHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const notification = await markNotificationAsRead({
    notificationId: req.params.notificationId ?? '',
    userId: req.authUser.id,
  });

  const payload: ApiSuccessResponse<{ notification: typeof notification }> = {
    success: true,
    data: { notification },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postMarkAllNotificationsReadHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const result = await markAllNotificationsAsRead(req.authUser.id);
  const payload: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorAuditLogsHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = await listAuditLogs({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    subjectType: typeof req.query.subjectType === 'string' ? req.query.subjectType : undefined,
    subjectId: parseOptionalInt(req.query.subjectId),
    userId: parseOptionalInt(req.query.userId),
    dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
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

export async function getDashboardSummaryHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const summary = await getDashboardSummaryForUser(req.authUser);

  const payload: ApiSuccessResponse<typeof summary> = {
    success: true,
    data: summary,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getSectionRepOverviewHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const overview = await getSectionRepScopedOverview(req.authUser);

  const payload: ApiSuccessResponse<typeof overview> = {
    success: true,
    data: overview,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getSectionRepTasksHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const result = await listSectionRepScopedTasks(req.authUser);

  const payload: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getSectionRepReportsHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const result = await listSectionRepScopedReports(req.authUser);

  const payload: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(payload);
}
