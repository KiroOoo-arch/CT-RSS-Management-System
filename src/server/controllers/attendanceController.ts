import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  createServiceHourAdjustment,
  decideServiceHourAdjustment,
  getCoordinatorSessionRoster,
  getServiceHoursSummary,
  listCoordinatorAttendance,
  listStudentAttendance,
  recordCoordinatorAttendance,
  verifyOrCorrectAttendance,
} from '../services/attendanceService.ts';
import type { ApiSuccessResponse, AttendanceVerificationStatus } from '../types/api.ts';

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

export async function getCoordinatorAttendanceList(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const records = await listCoordinatorAttendance({
    taskId: parseOptionalInt(req.query.taskId),
    taskSessionId: parseOptionalInt(req.query.taskSessionId),
    studentId: parseOptionalInt(req.query.studentId),
    verificationStatus:
      typeof req.query.verificationStatus === 'string' ? req.query.verificationStatus : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
  });

  const payload: ApiSuccessResponse<{ records: typeof records }> = {
    success: true,
    data: { records },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorSessionRosterHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const sessionId = Number.parseInt(req.params.sessionId ?? '', 10);
  const roster = await getCoordinatorSessionRoster(sessionId);

  const payload: ApiSuccessResponse<typeof roster> = {
    success: true,
    data: roster,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorAttendance(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as {
    applicationId?: unknown;
    taskSessionId?: unknown;
    attendanceDate?: unknown;
    checkIn?: unknown;
    checkOut?: unknown;
    recordedHours?: unknown;
    markAbsent?: unknown;
    autoVerify?: unknown;
    remarks?: unknown;
  };

  const record = await recordCoordinatorAttendance({
    applicationId: Number(body.applicationId),
    taskSessionId: Number(body.taskSessionId),
    attendanceDate: typeof body.attendanceDate === 'string' ? body.attendanceDate : undefined,
    checkIn: typeof body.checkIn === 'string' ? body.checkIn : null,
    checkOut: typeof body.checkOut === 'string' ? body.checkOut : null,
    recordedHours:
      body.recordedHours !== undefined && body.recordedHours !== '' && body.recordedHours !== null
        ? Number(body.recordedHours)
        : undefined,
    markAbsent: Boolean(body.markAbsent),
    autoVerify: Boolean(body.autoVerify),
    remarks: typeof body.remarks === 'string' ? body.remarks : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ record: typeof record }> = {
    success: true,
    data: { record },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function patchCoordinatorAttendance(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const attendanceId = Number.parseInt(req.params.attendanceId ?? '', 10);
  const body = (req.body ?? {}) as {
    verificationStatus?: unknown;
    verifiedHours?: unknown;
    recordedHours?: unknown;
    checkIn?: unknown;
    checkOut?: unknown;
    remarks?: unknown;
  };

  const verificationStatus = String(
    body.verificationStatus ?? 'verified',
  ) as AttendanceVerificationStatus;

  const record = await verifyOrCorrectAttendance({
    attendanceId,
    verificationStatus,
    verifiedHours: Number(body.verifiedHours ?? 0),
    recordedHours:
      body.recordedHours !== undefined && body.recordedHours !== '' && body.recordedHours !== null
        ? Number(body.recordedHours)
        : undefined,
    checkIn:
      body.checkIn === null
        ? null
        : typeof body.checkIn === 'string'
          ? body.checkIn
          : undefined,
    checkOut:
      body.checkOut === null
        ? null
        : typeof body.checkOut === 'string'
          ? body.checkOut
          : undefined,
    remarks: typeof body.remarks === 'string' ? body.remarks : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ record: typeof record }> = {
    success: true,
    data: { record },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getStudentAttendanceList(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const records = await listStudentAttendance(req.authUser.student.id);
  const payload: ApiSuccessResponse<{ records: typeof records }> = {
    success: true,
    data: { records },
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getCoordinatorServiceHoursHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const summary = await getServiceHoursSummary({
    studentId: parseOptionalInt(req.query.studentId),
    academicYearId: parseOptionalInt(req.query.academicYearId),
    taskId: parseOptionalInt(req.query.taskId),
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
  });

  const payload: ApiSuccessResponse<typeof summary> = {
    success: true,
    data: summary,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function getStudentServiceHoursHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const summary = await getServiceHoursSummary({
    studentId: req.authUser.student.id,
    academicYearId: parseOptionalInt(req.query.academicYearId),
    taskId: parseOptionalInt(req.query.taskId),
  });

  const payload: ApiSuccessResponse<typeof summary> = {
    success: true,
    data: summary,
    requestId: req.requestId,
  };
  res.json(payload);
}

export async function postCoordinatorServiceHourAdjustment(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as {
    applicationId?: unknown;
    adjustmentHours?: unknown;
    reason?: unknown;
    autoApprove?: unknown;
  };

  const adjustment = await createServiceHourAdjustment({
    applicationId: Number(body.applicationId),
    adjustmentHours: Number(body.adjustmentHours),
    reason: typeof body.reason === 'string' ? body.reason : '',
    requestedByUserId: req.authUser.id,
    isCoordinator: true,
    autoApprove: body.autoApprove !== false,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ adjustment: typeof adjustment }> = {
    success: true,
    data: { adjustment },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function postStudentServiceHourAdjustmentRequest(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.student) {
    throw new AppError(403, 'STUDENT_PROFILE_MISSING', 'An approved student profile is required.');
  }
  const body = (req.body ?? {}) as {
    applicationId?: unknown;
    adjustmentHours?: unknown;
    reason?: unknown;
  };

  const adjustment = await createServiceHourAdjustment({
    applicationId: Number(body.applicationId),
    adjustmentHours: Number(body.adjustmentHours),
    reason: typeof body.reason === 'string' ? body.reason : '',
    requestedByUserId: req.authUser.id,
    isCoordinator: false,
    autoApprove: false,
    studentIdScope: req.authUser.student.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ adjustment: typeof adjustment }> = {
    success: true,
    data: { adjustment },
    requestId: req.requestId,
  };
  res.status(201).json(payload);
}

export async function postCoordinatorAdjustmentDecision(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const adjustmentId = Number.parseInt(req.params.adjustmentId ?? '', 10);
  const body = (req.body ?? {}) as { decision?: unknown };
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null;
  if (!decision) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Decision must be "approved" or "rejected".');
  }

  const adjustment = await decideServiceHourAdjustment({
    adjustmentId,
    decision,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const payload: ApiSuccessResponse<{ adjustment: typeof adjustment }> = {
    success: true,
    data: { adjustment },
    requestId: req.requestId,
  };
  res.json(payload);
}
