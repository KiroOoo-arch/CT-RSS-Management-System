import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  createCoordinatorTask,
  createCoordinatorTaskSession,
  createTaskCategory,
  deleteCoordinatorTaskSession,
  getCoordinatorTaskDetail,
  getStudentEligibleTaskDetail,
  listCoordinatorTaskSessions,
  listCoordinatorTasks,
  listStudentEligibleTasks,
  listTaskCategories,
  updateCoordinatorTask,
  updateCoordinatorTaskSession,
  updateCoordinatorTaskStatus,
  updateTaskCategory,
} from '../services/taskService.ts';
import type { ApiSuccessResponse } from '../types/api.ts';
import { parseOptionalIntParam, parseStrictIntParam } from '../utils/apiValidation.ts';

function extractClientIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

function parseOptionalIdList(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Target IDs must be provided as an array.');
  }
  return raw.map((item) => Number(item));
}

// ---------------------------------------------------------------------------
// Coordinator: Task Categories
// ---------------------------------------------------------------------------

export async function getCoordinatorTaskCategories(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const activeOnly = req.query.activeOnly === 'true';
  const categories = await listTaskCategories(activeOnly);
  const response: ApiSuccessResponse<{ categories: typeof categories }> = {
    success: true,
    data: { categories },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorTaskCategory(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const category = await createTaskCategory({
    name: typeof body.name === 'string' ? body.name : '',
    description: typeof body.description === 'string' ? body.description : null,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ category: typeof category }> = {
    success: true,
    data: { category },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorTaskCategory(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const categoryId = parseStrictIntParam(req.params.categoryId, 'INVALID_TASK_CATEGORY_ID', 'task category identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const category = await updateTaskCategory({
    categoryId,
    name: typeof body.name === 'string' ? body.name : '',
    description: typeof body.description === 'string' ? body.description : null,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ category: typeof category }> = {
    success: true,
    data: { category },
    requestId: req.requestId,
  };
  res.json(response);
}

// ---------------------------------------------------------------------------
// Coordinator: Tasks
// ---------------------------------------------------------------------------

export async function getCoordinatorTasks(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = await listCoordinatorTasks({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    categoryId: parseOptionalIntParam(req.query.categoryId, 'INVALID_TASK_CATEGORY_ID', 'task category identifier'),
    visibility: typeof req.query.visibility === 'string' ? req.query.visibility : undefined,
    sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
    page: parseOptionalIntParam(req.query.page, 'INVALID_PAGE', 'page'),
    pageSize: parseOptionalIntParam(req.query.pageSize, 'INVALID_PAGE_SIZE', 'page size'),
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getCoordinatorTaskById(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const task = await getCoordinatorTaskDetail(taskId);
  const response: ApiSuccessResponse<{ task: typeof task }> = {
    success: true,
    data: { task },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorTask(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const task = await createCoordinatorTask({
    collegeId: Number(body.collegeId),
    categoryId: Number(body.categoryId),
    title: typeof body.title === 'string' ? body.title : '',
    description: typeof body.description === 'string' ? body.description : '',
    location: typeof body.location === 'string' ? body.location : null,
    visibility: typeof body.visibility === 'string' ? body.visibility : 'all_students',
    capacity:
      body.capacity === undefined || body.capacity === null || body.capacity === ''
        ? null
        : Number(body.capacity),
    requiredHours:
      body.requiredHours === undefined || body.requiredHours === null || body.requiredHours === ''
        ? null
        : Number(body.requiredHours),
    applicationStart: typeof body.applicationStart === 'string' ? body.applicationStart : null,
    applicationDeadline:
      typeof body.applicationDeadline === 'string' ? body.applicationDeadline : null,
    activityStart: typeof body.activityStart === 'string' ? body.activityStart : null,
    activityEnd: typeof body.activityEnd === 'string' ? body.activityEnd : null,
    status: typeof body.status === 'string' ? body.status : 'draft',
    targetSectionIds: parseOptionalIdList(body.targetSectionIds),
    targetStudentIds: parseOptionalIdList(body.targetStudentIds),
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ task: typeof task }> = {
    success: true,
    data: { task },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorTask(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const task = await updateCoordinatorTask({
    taskId,
    collegeId: Number(body.collegeId),
    categoryId: Number(body.categoryId),
    title: typeof body.title === 'string' ? body.title : '',
    description: typeof body.description === 'string' ? body.description : '',
    location: typeof body.location === 'string' ? body.location : null,
    visibility: typeof body.visibility === 'string' ? body.visibility : 'all_students',
    capacity:
      body.capacity === undefined || body.capacity === null || body.capacity === ''
        ? null
        : Number(body.capacity),
    requiredHours:
      body.requiredHours === undefined || body.requiredHours === null || body.requiredHours === ''
        ? null
        : Number(body.requiredHours),
    applicationStart: typeof body.applicationStart === 'string' ? body.applicationStart : null,
    applicationDeadline:
      typeof body.applicationDeadline === 'string' ? body.applicationDeadline : null,
    activityStart: typeof body.activityStart === 'string' ? body.activityStart : null,
    activityEnd: typeof body.activityEnd === 'string' ? body.activityEnd : null,
    targetSectionIds: parseOptionalIdList(body.targetSectionIds),
    targetStudentIds: parseOptionalIdList(body.targetStudentIds),
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ task: typeof task }> = {
    success: true,
    data: { task },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function patchCoordinatorTaskStatus(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const task = await updateCoordinatorTaskStatus({
    taskId,
    status: typeof body.status === 'string' ? body.status : '',
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ task: typeof task }> = {
    success: true,
    data: { task },
    requestId: req.requestId,
  };
  res.json(response);
}

// ---------------------------------------------------------------------------
// Coordinator: Task Sessions
// ---------------------------------------------------------------------------

export async function getCoordinatorTaskSessions(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const sessions = await listCoordinatorTaskSessions(taskId);
  const response: ApiSuccessResponse<{ sessions: typeof sessions }> = {
    success: true,
    data: { sessions },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorTaskSession(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const session = await createCoordinatorTaskSession({
    taskId,
    sessionTitle: typeof body.sessionTitle === 'string' ? body.sessionTitle : '',
    sessionDate: typeof body.sessionDate === 'string' ? body.sessionDate : '',
    startTime: typeof body.startTime === 'string' ? body.startTime : '',
    endTime: typeof body.endTime === 'string' ? body.endTime : '',
    location: typeof body.location === 'string' ? body.location : '',
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ session: typeof session }> = {
    success: true,
    data: { session },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorTaskSession(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const sessionId = parseStrictIntParam(req.params.sessionId, 'INVALID_TASK_SESSION_ID', 'task session identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const session = await updateCoordinatorTaskSession({
    taskId,
    sessionId,
    sessionTitle: typeof body.sessionTitle === 'string' ? body.sessionTitle : '',
    sessionDate: typeof body.sessionDate === 'string' ? body.sessionDate : '',
    startTime: typeof body.startTime === 'string' ? body.startTime : '',
    endTime: typeof body.endTime === 'string' ? body.endTime : '',
    location: typeof body.location === 'string' ? body.location : '',
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ session: typeof session }> = {
    success: true,
    data: { session },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function deleteCoordinatorTaskSessionHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const sessionId = parseStrictIntParam(req.params.sessionId, 'INVALID_TASK_SESSION_ID', 'task session identifier');
  const result = await deleteCoordinatorTaskSession({
    taskId,
    sessionId,
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

// ---------------------------------------------------------------------------
// Student: Eligible Published Task Discovery & Detail Viewing
// ---------------------------------------------------------------------------

export async function getStudentTasks(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(
      403,
      'STUDENT_PROFILE_REQUIRED',
      'An approved student profile is required to view eligible RSS tasks.',
    );
  }

  const result = await listStudentEligibleTasks({
    studentId: req.authUser.student.id,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    categoryId: parseOptionalIntParam(req.query.categoryId, 'INVALID_TASK_CATEGORY_ID', 'task category identifier'),
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getStudentTaskDetail(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(
      403,
      'STUDENT_PROFILE_REQUIRED',
      'An approved student profile is required to inspect RSS task details.',
    );
  }
  const taskId = parseStrictIntParam(req.params.taskId, 'INVALID_TASK_ID', 'task identifier');
  const task = await getStudentEligibleTaskDetail({
    studentId: req.authUser.student.id,
    taskId,
  });

  const response: ApiSuccessResponse<{ task: typeof task }> = {
    success: true,
    data: { task },
    requestId: req.requestId,
  };
  res.json(response);
}
