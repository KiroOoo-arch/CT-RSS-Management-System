import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AdjustmentStatus,
  AttendanceRecord,
  AttendanceVerificationStatus,
  ServiceHourAdjustmentRecord,
  ServiceHourBreakdownTaskItem,
  ServiceHoursSummaryResponse,
  SessionRosterParticipant,
  StudentServiceHoursLedgerItem,
} from '../types/api.ts';
import { validateIsoDateString } from './academicService.ts';
import { recordAuditLog } from './auditService.ts';
import { createNotification, notifyActiveCoordinators } from './notificationService.ts';

function parsePositiveInt(value: unknown, code: string, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, code, `Invalid ${label}.`);
  }
  return num;
}

function normalizeOptionalTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a valid timestamp.`);
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} is not a valid date/time.`);
  }
  return parsed.toISOString();
}

function normalizeNonNegativeHours(value: unknown, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 9999.99) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be a non-negative number up to 9999.99.`,
    );
  }
  return Math.round(num * 100) / 100;
}

function normalizeSignedHours(value: unknown, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num === 0 || num < -999.99 || num > 999.99) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be a non-zero number between -999.99 and 999.99.`,
    );
  }
  return Math.round(num * 100) / 100;
}

function normalizeOptionalRemarks(value: unknown, maxLen: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Remarks must be text.');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLen) {
    throw new AppError(400, 'VALIDATION_ERROR', `Remarks must not exceed ${maxLen} characters.`);
  }
  return trimmed;
}

interface AttendanceDbRow {
  id: number;
  application_id: number;
  task_id: number;
  task_title: string;
  task_session_id: number;
  session_title: string;
  session_date: string;
  session_start_time: string;
  session_end_time: string;
  session_location: string;
  student_id: number;
  student_number: string;
  student_name: string;
  section_label: string | null;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  recorded_hours: string;
  verified_hours: string;
  verification_status: AttendanceVerificationStatus;
  verified_by: number | null;
  verified_by_name: string | null;
  verified_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

function mapAttendanceRow(row: AttendanceDbRow): AttendanceRecord {
  return {
    id: Number(row.id),
    applicationId: Number(row.application_id),
    taskId: Number(row.task_id),
    taskTitle: row.task_title,
    taskSessionId: Number(row.task_session_id),
    sessionTitle: row.session_title,
    sessionDate: row.session_date,
    sessionStartTime: row.session_start_time,
    sessionEndTime: row.session_end_time,
    sessionLocation: row.session_location,
    studentId: Number(row.student_id),
    studentNumber: row.student_number,
    studentName: row.student_name,
    sectionLabel: row.section_label,
    attendanceDate: row.attendance_date,
    checkIn: row.check_in,
    checkOut: row.check_out,
    recordedHours: Number(row.recorded_hours),
    verifiedHours: Number(row.verified_hours),
    verificationStatus: row.verification_status,
    verifiedBy: row.verified_by !== null ? Number(row.verified_by) : null,
    verifiedByName: row.verified_by_name,
    verifiedAt: row.verified_at,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ATTENDANCE_SELECT = `
  SELECT
    att.id,
    att.application_id,
    t.id AS task_id,
    t.title AS task_title,
    att.task_session_id,
    ts.session_title,
    ts.session_date::text AS session_date,
    to_char(ts.start_time, 'HH24:MI') AS session_start_time,
    to_char(ts.end_time, 'HH24:MI') AS session_end_time,
    ts.location AS session_location,
    s.id AS student_id,
    s.student_number,
    u.name AS student_name,
    CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
    att.attendance_date::text AS attendance_date,
    att.check_in::text AS check_in,
    att.check_out::text AS check_out,
    att.recorded_hours::text AS recorded_hours,
    att.verified_hours::text AS verified_hours,
    att.verification_status,
    att.verified_by,
    verifier.name AS verified_by_name,
    att.verified_at::text AS verified_at,
    att.remarks,
    att.created_at::text AS created_at,
    att.updated_at::text AS updated_at
  FROM attendance att
  JOIN task_applications ta ON ta.id = att.application_id
  JOIN task_sessions ts ON ts.id = att.task_session_id
  JOIN tasks t ON t.id = ts.task_id
  JOIN students s ON s.id = ta.student_id
  JOIN users u ON u.id = s.user_id
  LEFT JOIN users verifier ON verifier.id = att.verified_by
  LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
  LEFT JOIN sections sec ON sec.id = ssh.section_id
  LEFT JOIN programs p ON p.id = sec.program_id
  LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
`;

export async function listCoordinatorAttendance(input: {
  taskId?: number;
  taskSessionId?: number;
  studentId?: number;
  verificationStatus?: string;
  search?: string;
}): Promise<AttendanceRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.taskId !== undefined) {
    params.push(parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier'));
    conditions.push(`t.id = $${params.length}`);
  }
  if (input.taskSessionId !== undefined) {
    params.push(
      parsePositiveInt(input.taskSessionId, 'INVALID_SESSION_ID', 'task session identifier'),
    );
    conditions.push(`att.task_session_id = $${params.length}`);
  }
  if (input.studentId !== undefined) {
    params.push(parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier'));
    conditions.push(`s.id = $${params.length}`);
  }

  const vStatus = input.verificationStatus?.trim().toLowerCase();
  if (vStatus === 'pending' || vStatus === 'verified' || vStatus === 'rejected') {
    params.push(vStatus);
    conditions.push(`att.verification_status = $${params.length}`);
  }

  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim()}%`);
    const ref = `$${params.length}`;
    conditions.push(
      `(u.name ILIKE ${ref} OR s.student_number ILIKE ${ref} OR t.title ILIKE ${ref} OR ts.session_title ILIKE ${ref})`,
    );
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query<AttendanceDbRow>(
    `${ATTENDANCE_SELECT}
     ${whereSql}
     ORDER BY CASE WHEN att.verification_status = 'pending' THEN 0 ELSE 1 END,
              att.attendance_date DESC,
              att.id DESC
     LIMIT 300`,
    params,
  );
  return res.rows.map(mapAttendanceRow);
}

export async function listStudentAttendance(studentIdInput: number): Promise<AttendanceRecord[]> {
  const studentId = parsePositiveInt(studentIdInput, 'INVALID_STUDENT_ID', 'student identifier');
  const res = await query<AttendanceDbRow>(
    `${ATTENDANCE_SELECT}
     WHERE ta.student_id = $1
     ORDER BY att.attendance_date DESC, ts.start_time DESC, att.id DESC`,
    [studentId],
  );
  return res.rows.map(mapAttendanceRow);
}

export async function getCoordinatorSessionRoster(
  sessionIdInput: number,
): Promise<{
  session: {
    id: number;
    taskId: number;
    taskTitle: string;
    sessionTitle: string;
    sessionDate: string;
    startTime: string;
    endTime: string;
    location: string;
  };
  participants: SessionRosterParticipant[];
}> {
  const sessionId = parsePositiveInt(sessionIdInput, 'INVALID_SESSION_ID', 'session identifier');

  const sessionRes = await query<{
    id: number;
    task_id: number;
    task_title: string;
    session_title: string;
    session_date: string;
    start_time: string;
    end_time: string;
    location: string;
  }>(
    `SELECT
       ts.id,
       ts.task_id,
       t.title AS task_title,
       ts.session_title,
       ts.session_date::text AS session_date,
       to_char(ts.start_time, 'HH24:MI') AS start_time,
       to_char(ts.end_time, 'HH24:MI') AS end_time,
       ts.location
     FROM task_sessions ts
     JOIN tasks t ON t.id = ts.task_id
     WHERE ts.id = $1 AND t.deleted_at IS NULL
     LIMIT 1`,
    [sessionId],
  );
  const sRow = sessionRes.rows[0];
  if (!sRow) {
    throw new AppError(404, 'TASK_SESSION_NOT_FOUND', 'Task session not found.');
  }

  const participantsRes = await query<{
    application_id: number;
    student_id: number;
    student_number: string;
    student_name: string;
    section_label: string | null;
  }>(
    `SELECT
       ta.id AS application_id,
       s.id AS student_id,
       s.student_number,
       u.name AS student_name,
       CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label
     FROM task_applications ta
     JOIN students s ON s.id = ta.student_id
     JOIN users u ON u.id = s.user_id
     LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
     LEFT JOIN sections sec ON sec.id = ssh.section_id
     LEFT JOIN programs p ON p.id = sec.program_id
     LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
     WHERE ta.task_id = $1
       AND ta.status = 'approved'
     ORDER BY u.name ASC`,
    [sRow.task_id],
  );

  const attendanceList = await listCoordinatorAttendance({ taskSessionId: sessionId });
  const attendanceMap = new Map<number, AttendanceRecord>(
    attendanceList.map((item) => [item.applicationId, item]),
  );

  return {
    session: {
      id: Number(sRow.id),
      taskId: Number(sRow.task_id),
      taskTitle: sRow.task_title,
      sessionTitle: sRow.session_title,
      sessionDate: sRow.session_date,
      startTime: sRow.start_time,
      endTime: sRow.end_time,
      location: sRow.location,
    },
    participants: participantsRes.rows.map((p) => ({
      applicationId: Number(p.application_id),
      studentId: Number(p.student_id),
      studentNumber: p.student_number,
      studentName: p.student_name,
      sectionLabel: p.section_label,
      attendance: attendanceMap.get(Number(p.application_id)) ?? null,
    })),
  };
}

export async function recordCoordinatorAttendance(input: {
  applicationId: number;
  taskSessionId: number;
  attendanceDate?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  recordedHours?: number;
  markAbsent?: boolean;
  autoVerify?: boolean;
  remarks?: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AttendanceRecord> {
  const applicationId = parsePositiveInt(
    input.applicationId,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );
  const taskSessionId = parsePositiveInt(
    input.taskSessionId,
    'INVALID_SESSION_ID',
    'task session identifier',
  );

  const markAbsent = Boolean(input.markAbsent);
  const autoVerify = Boolean(input.autoVerify);
  const rawRemarks = normalizeOptionalRemarks(input.remarks, 500);

  return withTransaction(async (client) => {
    const appRes = await client.query<{
      id: number;
      task_id: number;
      student_id: number;
      status: string;
      student_user_id: number;
    }>(
      `SELECT ta.id, ta.task_id, ta.student_id, ta.status, s.user_id AS student_user_id
       FROM task_applications ta
       JOIN students s ON s.id = ta.student_id
       WHERE ta.id = $1
       FOR UPDATE OF ta`,
      [applicationId],
    );
    const appRow = appRes.rows[0];
    if (!appRow) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Task application record not found.');
    }
    if (appRow.status !== 'approved') {
      throw new AppError(
        400,
        'APPLICATION_NOT_APPROVED',
        'Attendance can only be recorded for approved task participants.',
      );
    }

    const sessionRes = await client.query<{
      id: number;
      task_id: number;
      session_title: string;
      session_date: string;
      task_title: string;
    }>(
      `SELECT ts.id, ts.task_id, ts.session_title, ts.session_date::text AS session_date, t.title AS task_title
       FROM task_sessions ts
       JOIN tasks t ON t.id = ts.task_id
       WHERE ts.id = $1 AND t.deleted_at IS NULL`,
      [taskSessionId],
    );
    const sessionRow = sessionRes.rows[0];
    if (!sessionRow) {
      throw new AppError(404, 'TASK_SESSION_NOT_FOUND', 'Task session record not found.');
    }
    if (Number(sessionRow.task_id) !== Number(appRow.task_id)) {
      throw new AppError(
        400,
        'SESSION_TASK_MISMATCH',
        'Selected task session does not belong to this participant application task.',
      );
    }

    const dupCheck = await client.query<{ id: number }>(
      `SELECT id FROM attendance WHERE application_id = $1 AND task_session_id = $2 LIMIT 1`,
      [applicationId, taskSessionId],
    );
    if (dupCheck.rows.length > 0) {
      throw new AppError(
        409,
        'DUPLICATE_ATTENDANCE',
        'Attendance has already been recorded for this participant in this session. Use verification/correction instead.',
      );
    }

    const attendanceDate = input.attendanceDate
      ? validateIsoDateString(input.attendanceDate, 'Attendance date')
      : sessionRow.session_date;

    let checkIn: string | null = null;
    let checkOut: string | null = null;
    let recordedHours = 0;
    let finalRemarks = rawRemarks;

    if (markAbsent) {
      recordedHours = 0;
      finalRemarks = rawRemarks ? `[ABSENT] ${rawRemarks}` : '[ABSENT] Marked absent for session.';
    } else {
      checkIn = normalizeOptionalTimestamp(input.checkIn, 'Check-in time');
      checkOut = normalizeOptionalTimestamp(input.checkOut, 'Check-out time');
      if (checkIn && checkOut && new Date(checkOut).getTime() <= new Date(checkIn).getTime()) {
        throw new AppError(
          400,
          'INVALID_TIME_RANGE',
          'Check-out timestamp must be strictly after check-in timestamp.',
        );
      }

      if (input.recordedHours !== undefined) {
        recordedHours = normalizeNonNegativeHours(input.recordedHours, 'Recorded hours');
      } else if (checkIn && checkOut) {
        const diffHours =
          (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60);
        recordedHours = Math.round(diffHours * 100) / 100;
      } else {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Provide recorded hours or both check-in and check-out timestamps (or mark absent).',
        );
      }
    }

    const verificationStatus: AttendanceVerificationStatus = autoVerify ? 'verified' : 'pending';
    const verifiedHours = autoVerify ? recordedHours : 0;

    const insertedRes = await client.query<{ id: number }>(
      `INSERT INTO attendance (
         application_id,
         task_session_id,
         attendance_date,
         check_in,
         check_out,
         recorded_hours,
         verified_hours,
         verification_status,
         verified_by,
         verified_at,
         remarks
       )
       VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10::timestamptz, $11)
       RETURNING id`,
      [
        applicationId,
        taskSessionId,
        attendanceDate,
        checkIn,
        checkOut,
        recordedHours,
        verifiedHours,
        verificationStatus,
        autoVerify ? input.coordinatorUserId : null,
        autoVerify ? new Date().toISOString() : null,
        finalRemarks,
      ],
    );
    const attendanceId = Number(insertedRes.rows[0]?.id);

    await createNotification(
      {
        userId: Number(appRow.student_user_id),
        title: autoVerify ? 'Attendance Recorded & Verified' : 'Session Attendance Recorded',
        message: markAbsent
          ? `You were marked absent for "${sessionRow.session_title}" (${sessionRow.task_title}).`
          : `Attendance (${recordedHours.toFixed(2)} hrs) recorded for "${sessionRow.session_title}" (${sessionRow.task_title}) with status: ${verificationStatus}.`,
        notificationType: autoVerify ? 'attendance_verified' : 'attendance_recorded',
        relatedType: 'attendance',
        relatedId: attendanceId,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'attendance_recorded',
        subjectType: 'attendance',
        subjectId: attendanceId,
        newValues: {
          application_id: applicationId,
          task_session_id: taskSessionId,
          attendance_date: attendanceDate,
          recorded_hours: recordedHours,
          verified_hours: verifiedHours,
          verification_status: verificationStatus,
          mark_absent: markAbsent,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AttendanceDbRow>(
      `${ATTENDANCE_SELECT} WHERE att.id = $1 LIMIT 1`,
      [attendanceId],
    );
    return mapAttendanceRow(rowRes.rows[0]!);
  });
}

export async function verifyOrCorrectAttendance(input: {
  attendanceId: number;
  verificationStatus: AttendanceVerificationStatus;
  verifiedHours: number;
  recordedHours?: number;
  checkIn?: string | null;
  checkOut?: string | null;
  remarks?: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AttendanceRecord> {
  const attendanceId = parsePositiveInt(
    input.attendanceId,
    'INVALID_ATTENDANCE_ID',
    'attendance identifier',
  );
  if (
    input.verificationStatus !== 'pending' &&
    input.verificationStatus !== 'verified' &&
    input.verificationStatus !== 'rejected'
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Verification status must be pending, verified, or rejected.',
    );
  }
  const verifiedHoursInput = normalizeNonNegativeHours(input.verifiedHours, 'Verified hours');
  const remarks = normalizeOptionalRemarks(input.remarks, 500);
  if (input.verificationStatus === 'rejected' && !remarks) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Remarks explaining the rejection are required when rejecting an attendance entry.',
    );
  }

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      application_id: number;
      task_session_id: number;
      check_in: string | null;
      check_out: string | null;
      recorded_hours: string;
      verified_hours: string;
      verification_status: AttendanceVerificationStatus;
      student_user_id: number;
      session_title: string;
      task_title: string;
    }>(
      `SELECT
         att.id,
         att.application_id,
         att.task_session_id,
         att.check_in::text AS check_in,
         att.check_out::text AS check_out,
         att.recorded_hours::text AS recorded_hours,
         att.verified_hours::text AS verified_hours,
         att.verification_status,
         s.user_id AS student_user_id,
         ts.session_title,
         t.title AS task_title
       FROM attendance att
       JOIN task_applications ta ON ta.id = att.application_id
       JOIN students s ON s.id = ta.student_id
       JOIN task_sessions ts ON ts.id = att.task_session_id
       JOIN tasks t ON t.id = ts.task_id
       WHERE att.id = $1
       FOR UPDATE OF att`,
      [attendanceId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'ATTENDANCE_NOT_FOUND', 'Attendance record not found.');
    }

    const nextCheckIn =
      input.checkIn !== undefined
        ? normalizeOptionalTimestamp(input.checkIn, 'Check-in time')
        : existing.check_in;
    const nextCheckOut =
      input.checkOut !== undefined
        ? normalizeOptionalTimestamp(input.checkOut, 'Check-out time')
        : existing.check_out;

    if (
      nextCheckIn &&
      nextCheckOut &&
      new Date(nextCheckOut).getTime() <= new Date(nextCheckIn).getTime()
    ) {
      throw new AppError(
        400,
        'INVALID_TIME_RANGE',
        'Check-out timestamp must be strictly after check-in timestamp.',
      );
    }

    const nextRecordedHours =
      input.recordedHours !== undefined
        ? normalizeNonNegativeHours(input.recordedHours, 'Recorded hours')
        : Number(existing.recorded_hours);

    const effectiveVerifiedHours =
      input.verificationStatus === 'verified' ? verifiedHoursInput : 0;

    await client.query(
      `UPDATE attendance
       SET check_in = $1::timestamptz,
           check_out = $2::timestamptz,
           recorded_hours = $3,
           verified_hours = $4,
           verification_status = $5,
           verified_by = CASE WHEN $5::varchar = 'pending' THEN NULL ELSE $6::bigint END,
           verified_at = CASE WHEN $5::varchar = 'pending' THEN NULL ELSE NOW() END,
           remarks = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [
        nextCheckIn,
        nextCheckOut,
        nextRecordedHours,
        effectiveVerifiedHours,
        input.verificationStatus,
        input.coordinatorUserId,
        remarks,
        attendanceId,
      ],
    );

    await createNotification(
      {
        userId: Number(existing.student_user_id),
        title:
          input.verificationStatus === 'verified'
            ? 'Attendance Hours Verified'
            : input.verificationStatus === 'rejected'
              ? 'Attendance Entry Rejected'
              : 'Attendance Entry Updated',
        message:
          input.verificationStatus === 'verified'
            ? `Your attendance for "${existing.session_title}" (${existing.task_title}) was verified for ${effectiveVerifiedHours.toFixed(2)} service hours.`
            : `Your attendance status for "${existing.session_title}" (${existing.task_title}) was updated to ${input.verificationStatus}.${remarks ? ` Remarks: ${remarks}` : ''}`,
        notificationType: `attendance_${input.verificationStatus}`,
        relatedType: 'attendance',
        relatedId: attendanceId,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: `attendance_${input.verificationStatus}`,
        subjectType: 'attendance',
        subjectId: attendanceId,
        oldValues: {
          recorded_hours: Number(existing.recorded_hours),
          verified_hours: Number(existing.verified_hours),
          verification_status: existing.verification_status,
        },
        newValues: {
          recorded_hours: nextRecordedHours,
          verified_hours: effectiveVerifiedHours,
          verification_status: input.verificationStatus,
          remarks,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AttendanceDbRow>(
      `${ATTENDANCE_SELECT} WHERE att.id = $1 LIMIT 1`,
      [attendanceId],
    );
    return mapAttendanceRow(rowRes.rows[0]!);
  });
}

// ---------------------------------------------------------------------------
// Official Credited Service Hours & Adjustments
// Formula: SUM(attendance.verified_hours WHERE verification_status = 'verified')
//        + SUM(service_hour_adjustments.adjustment_hours WHERE status = 'approved')
// ---------------------------------------------------------------------------

interface AdjustmentDbRow {
  id: number;
  application_id: number;
  task_id: number;
  task_title: string;
  student_id: number;
  student_number: string;
  student_name: string;
  section_label: string | null;
  requested_by: number;
  requested_by_name: string;
  approved_by: number | null;
  approved_by_name: string | null;
  adjustment_hours: string;
  reason: string;
  status: AdjustmentStatus;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapAdjustmentRow(row: AdjustmentDbRow): ServiceHourAdjustmentRecord {
  return {
    id: Number(row.id),
    applicationId: Number(row.application_id),
    taskId: Number(row.task_id),
    taskTitle: row.task_title,
    studentId: Number(row.student_id),
    studentNumber: row.student_number,
    studentName: row.student_name,
    sectionLabel: row.section_label,
    requestedBy: Number(row.requested_by),
    requestedByName: row.requested_by_name,
    approvedBy: row.approved_by !== null ? Number(row.approved_by) : null,
    approvedByName: row.approved_by_name,
    adjustmentHours: Number(row.adjustment_hours),
    reason: row.reason,
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getServiceHoursSummary(input: {
  studentId?: number;
  academicYearId?: number;
  taskId?: number;
  search?: string;
}): Promise<ServiceHoursSummaryResponse> {
  const stuConditions: string[] = [`u.deleted_at IS NULL`, `s.registration_status = 'approved'`];
  const stuParams: unknown[] = [];

  if (input.studentId !== undefined) {
    stuParams.push(parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier'));
    stuConditions.push(`s.id = $${stuParams.length}`);
  }
  if (input.academicYearId !== undefined) {
    stuParams.push(
      parsePositiveInt(input.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    );
    stuConditions.push(`ssh.academic_year_id = $${stuParams.length}`);
  }
  if (input.search && input.search.trim().length > 0) {
    stuParams.push(`%${input.search.trim()}%`);
    const ref = `$${stuParams.length}`;
    stuConditions.push(`(u.name ILIKE ${ref} OR s.student_number ILIKE ${ref})`);
  }

  let taskFilterAttSql = '';
  let taskFilterAdjSql = '';
  if (input.taskId !== undefined) {
    stuParams.push(parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier'));
    const tRef = `$${stuParams.length}`;
    taskFilterAttSql = `AND ta_att.task_id = ${tRef}`;
    taskFilterAdjSql = `AND ta_adj.task_id = ${tRef}`;
  }

  const ledgerRes = await query<{
    student_id: number;
    student_number: string;
    student_name: string;
    section_label: string | null;
    academic_year_name: string | null;
    verified_attendance_hours: string;
    pending_attendance_hours: string;
    rejected_attendance_hours: string;
    approved_adjustment_hours: string;
    pending_adjustment_hours: string;
    verified_session_count: string;
    pending_session_count: string;
  }>(
    `SELECT
       s.id AS student_id,
       s.student_number,
       u.name AS student_name,
       CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
       ay.name AS academic_year_name,
       COALESCE((
         SELECT SUM(att.verified_hours)
         FROM attendance att
         JOIN task_applications ta_att ON ta_att.id = att.application_id
         WHERE ta_att.student_id = s.id
           AND att.verification_status = 'verified'
           ${taskFilterAttSql}
       ), 0)::text AS verified_attendance_hours,
       COALESCE((
         SELECT SUM(att.recorded_hours)
         FROM attendance att
         JOIN task_applications ta_att ON ta_att.id = att.application_id
         WHERE ta_att.student_id = s.id
           AND att.verification_status = 'pending'
           ${taskFilterAttSql}
       ), 0)::text AS pending_attendance_hours,
       COALESCE((
         SELECT SUM(att.recorded_hours)
         FROM attendance att
         JOIN task_applications ta_att ON ta_att.id = att.application_id
         WHERE ta_att.student_id = s.id
           AND att.verification_status = 'rejected'
           ${taskFilterAttSql}
       ), 0)::text AS rejected_attendance_hours,
       COALESCE((
         SELECT SUM(adj.adjustment_hours)
         FROM service_hour_adjustments adj
         JOIN task_applications ta_adj ON ta_adj.id = adj.application_id
         WHERE ta_adj.student_id = s.id
           AND adj.status = 'approved'
           ${taskFilterAdjSql}
       ), 0)::text AS approved_adjustment_hours,
       COALESCE((
         SELECT SUM(adj.adjustment_hours)
         FROM service_hour_adjustments adj
         JOIN task_applications ta_adj ON ta_adj.id = adj.application_id
         WHERE ta_adj.student_id = s.id
           AND adj.status = 'pending'
           ${taskFilterAdjSql}
       ), 0)::text AS pending_adjustment_hours,
       COALESCE((
         SELECT COUNT(*)
         FROM attendance att
         JOIN task_applications ta_att ON ta_att.id = att.application_id
         WHERE ta_att.student_id = s.id
           AND att.verification_status = 'verified'
           ${taskFilterAttSql}
       ), 0)::text AS verified_session_count,
       COALESCE((
         SELECT COUNT(*)
         FROM attendance att
         JOIN task_applications ta_att ON ta_att.id = att.application_id
         WHERE ta_att.student_id = s.id
           AND att.verification_status = 'pending'
           ${taskFilterAttSql}
       ), 0)::text AS pending_session_count
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
     LEFT JOIN sections sec ON sec.id = ssh.section_id
     LEFT JOIN programs p ON p.id = sec.program_id
     LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
     LEFT JOIN academic_years ay ON ay.id = ssh.academic_year_id
     WHERE ${stuConditions.join(' AND ')}
     ORDER BY u.name ASC`,
    stuParams,
  );

  const ledger: StudentServiceHoursLedgerItem[] = ledgerRes.rows.map((row) => {
    const verifiedAtt = Number(row.verified_attendance_hours) || 0;
    const approvedAdj = Number(row.approved_adjustment_hours) || 0;
    return {
      studentId: Number(row.student_id),
      studentNumber: row.student_number,
      studentName: row.student_name,
      sectionLabel: row.section_label,
      academicYearName: row.academic_year_name,
      verifiedAttendanceHours: Math.round(verifiedAtt * 100) / 100,
      pendingAttendanceHours: Math.round((Number(row.pending_attendance_hours) || 0) * 100) / 100,
      rejectedAttendanceHours: Math.round((Number(row.rejected_attendance_hours) || 0) * 100) / 100,
      approvedAdjustmentHours: Math.round(approvedAdj * 100) / 100,
      pendingAdjustmentHours: Math.round((Number(row.pending_adjustment_hours) || 0) * 100) / 100,
      totalCreditedHours: Math.round((verifiedAtt + approvedAdj) * 100) / 100,
      verifiedSessionCount: Number.parseInt(row.verified_session_count ?? '0', 10) || 0,
      pendingSessionCount: Number.parseInt(row.pending_session_count ?? '0', 10) || 0,
    };
  });

  // Adjustments list
  const adjConditions: string[] = [];
  const adjParams: unknown[] = [];
  if (input.studentId !== undefined) {
    adjParams.push(input.studentId);
    adjConditions.push(`s.id = $${adjParams.length}`);
  }
  if (input.taskId !== undefined) {
    adjParams.push(input.taskId);
    adjConditions.push(`t.id = $${adjParams.length}`);
  }
  if (input.search && input.search.trim().length > 0) {
    adjParams.push(`%${input.search.trim()}%`);
    const ref = `$${adjParams.length}`;
    adjConditions.push(`(u.name ILIKE ${ref} OR s.student_number ILIKE ${ref} OR t.title ILIKE ${ref})`);
  }
  const adjWhere = adjConditions.length > 0 ? `WHERE ${adjConditions.join(' AND ')}` : '';

  const adjRes = await query<AdjustmentDbRow>(
    `SELECT
       sha.id,
       sha.application_id,
       t.id AS task_id,
       t.title AS task_title,
       s.id AS student_id,
       s.student_number,
       u.name AS student_name,
       CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
       sha.requested_by,
       req_u.name AS requested_by_name,
       sha.approved_by,
       app_u.name AS approved_by_name,
       sha.adjustment_hours::text AS adjustment_hours,
       sha.reason,
       sha.status,
       sha.approved_at::text AS approved_at,
       sha.created_at::text AS created_at,
       sha.updated_at::text AS updated_at
     FROM service_hour_adjustments sha
     JOIN task_applications ta ON ta.id = sha.application_id
     JOIN tasks t ON t.id = ta.task_id
     JOIN students s ON s.id = ta.student_id
     JOIN users u ON u.id = s.user_id
     JOIN users req_u ON req_u.id = sha.requested_by
     LEFT JOIN users app_u ON app_u.id = sha.approved_by
     LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
     LEFT JOIN sections sec ON sec.id = ssh.section_id
     LEFT JOIN programs p ON p.id = sec.program_id
     LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
     ${adjWhere}
     ORDER BY CASE WHEN sha.status = 'pending' THEN 0 ELSE 1 END, sha.created_at DESC, sha.id DESC
     LIMIT 200`,
    adjParams,
  );

  // Per-task breakdown for approved applications
  const brkConditions: string[] = [`ta.status = 'approved'`];
  const brkParams: unknown[] = [];
  if (input.studentId !== undefined) {
    brkParams.push(input.studentId);
    brkConditions.push(`ta.student_id = $${brkParams.length}`);
  }
  if (input.taskId !== undefined) {
    brkParams.push(input.taskId);
    brkConditions.push(`ta.task_id = $${brkParams.length}`);
  }
  const brkRes = await query<{
    application_id: number;
    task_id: number;
    task_title: string;
    category_name: string;
    required_hours: string | null;
    verified_attendance_hours: string;
    pending_attendance_hours: string;
    approved_adjustment_hours: string;
  }>(
    `SELECT
       ta.id AS application_id,
       t.id AS task_id,
       t.title AS task_title,
       tc.name AS category_name,
       t.required_hours::text AS required_hours,
       COALESCE((
         SELECT SUM(att.verified_hours)
         FROM attendance att
         WHERE att.application_id = ta.id AND att.verification_status = 'verified'
       ), 0)::text AS verified_attendance_hours,
       COALESCE((
         SELECT SUM(att.recorded_hours)
         FROM attendance att
         WHERE att.application_id = ta.id AND att.verification_status = 'pending'
       ), 0)::text AS pending_attendance_hours,
       COALESCE((
         SELECT SUM(adj.adjustment_hours)
         FROM service_hour_adjustments adj
         WHERE adj.application_id = ta.id AND adj.status = 'approved'
       ), 0)::text AS approved_adjustment_hours
     FROM task_applications ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN task_categories tc ON tc.id = t.category_id
     WHERE ${brkConditions.join(' AND ')}
     ORDER BY t.title ASC`,
    brkParams,
  );

  const breakdown: ServiceHourBreakdownTaskItem[] = brkRes.rows.map((r) => {
    const ver = Number(r.verified_attendance_hours) || 0;
    const adj = Number(r.approved_adjustment_hours) || 0;
    return {
      applicationId: Number(r.application_id),
      taskId: Number(r.task_id),
      taskTitle: r.task_title,
      categoryName: r.category_name,
      requiredHours: r.required_hours !== null ? Number(r.required_hours) : null,
      verifiedAttendanceHours: Math.round(ver * 100) / 100,
      pendingAttendanceHours: Math.round((Number(r.pending_attendance_hours) || 0) * 100) / 100,
      approvedAdjustmentHours: Math.round(adj * 100) / 100,
      totalCreditedHours: Math.round((ver + adj) * 100) / 100,
    };
  });

  const attendanceRecords =
    input.studentId !== undefined
      ? await listStudentAttendance(input.studentId)
      : await listCoordinatorAttendance({
          taskId: input.taskId,
          search: input.search,
        });

  return {
    ledger,
    students: ledger,
    adjustments: adjRes.rows.map(mapAdjustmentRow),
    breakdown,
    attendanceRecords,
  };
}

export async function createServiceHourAdjustment(input: {
  applicationId: number;
  adjustmentHours: number;
  reason: string;
  requestedByUserId: number;
  isCoordinator: boolean;
  autoApprove?: boolean;
  studentIdScope?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ServiceHourAdjustmentRecord> {
  const applicationId = parsePositiveInt(
    input.applicationId,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );
  const adjustmentHours = normalizeSignedHours(input.adjustmentHours, 'Adjustment hours');
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 5 || reason.length > 1000) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'A descriptive adjustment reason (5–1000 characters) is required.',
    );
  }

  if (!input.isCoordinator && adjustmentHours < 0) {
    throw new AppError(
      400,
      'INVALID_ADJUSTMENT_HOURS',
      'Students cannot submit negative hour adjustment requests.',
    );
  }

  const autoApprove = input.isCoordinator && Boolean(input.autoApprove);

  return withTransaction(async (client) => {
    const appRes = await client.query<{
      id: number;
      student_id: number;
      student_user_id: number;
      status: string;
      task_title: string;
    }>(
      `SELECT ta.id, ta.student_id, s.user_id AS student_user_id, ta.status, t.title AS task_title
       FROM task_applications ta
       JOIN students s ON s.id = ta.student_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.id = $1
       FOR UPDATE OF ta`,
      [applicationId],
    );
    const appRow = appRes.rows[0];
    if (!appRow) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Task application record not found.');
    }
    if (input.studentIdScope !== undefined && Number(appRow.student_id) !== input.studentIdScope) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'You can only submit adjustment requests for your own approved task applications.',
      );
    }
    if (appRow.status !== 'approved') {
      throw new AppError(
        400,
        'APPLICATION_NOT_APPROVED',
        'Service-hour adjustments apply only to approved task participations.',
      );
    }

    if (adjustmentHours < 0) {
      const currRes = await client.query<{ credited: string }>(
        `SELECT (
           COALESCE((SELECT SUM(verified_hours) FROM attendance WHERE application_id = $1 AND verification_status = 'verified'), 0)
           + COALESCE((SELECT SUM(adjustment_hours) FROM service_hour_adjustments WHERE application_id = $1 AND status = 'approved'), 0)
         )::text AS credited`,
        [applicationId],
      );
      const currentCredited = Number(currRes.rows[0]?.credited ?? '0') || 0;
      if (currentCredited + adjustmentHours < 0) {
        throw new AppError(
          400,
          'NEGATIVE_TOTAL_NOT_ALLOWED',
          `A deduction of ${adjustmentHours.toFixed(2)} hrs would reduce credited task hours below 0.00 (current: ${currentCredited.toFixed(2)} hrs).`,
        );
      }
    }

    const status: AdjustmentStatus = autoApprove ? 'approved' : 'pending';
    const insertRes = await client.query<{ id: number }>(
      `INSERT INTO service_hour_adjustments (
         application_id,
         requested_by,
         approved_by,
         adjustment_hours,
         reason,
         status,
         approved_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       RETURNING id`,
      [
        applicationId,
        input.requestedByUserId,
        autoApprove ? input.requestedByUserId : null,
        adjustmentHours,
        reason,
        status,
        autoApprove ? new Date().toISOString() : null,
      ],
    );
    const adjId = Number(insertRes.rows[0]?.id);

    if (autoApprove) {
      await createNotification(
        {
          userId: Number(appRow.student_user_id),
          title: 'Service Hour Adjustment Applied',
          message: `An adjustment of ${adjustmentHours >= 0 ? '+' : ''}${adjustmentHours.toFixed(2)} hrs was approved for "${appRow.task_title}". Reason: ${reason}`,
          notificationType: 'service_hour_adjustment_approved',
          relatedType: 'service_hour_adjustments',
          relatedId: adjId,
        },
        client,
      );
    } else if (!input.isCoordinator) {
      await notifyActiveCoordinators(
        {
          title: 'Service Hour Adjustment Request',
          message: `A student requested +${adjustmentHours.toFixed(2)} hrs adjustment for "${appRow.task_title}".`,
          notificationType: 'service_hour_adjustment_requested',
          relatedType: 'service_hour_adjustments',
          relatedId: adjId,
        },
        client,
      );
    }

    await recordAuditLog(
      {
        userId: input.requestedByUserId,
        action: autoApprove ? 'service_hour_adjustment_created_and_approved' : 'service_hour_adjustment_requested',
        subjectType: 'service_hour_adjustments',
        subjectId: adjId,
        newValues: {
          application_id: applicationId,
          adjustment_hours: adjustmentHours,
          reason,
          status,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AdjustmentDbRow>(
      `SELECT
         sha.id,
         sha.application_id,
         t.id AS task_id,
         t.title AS task_title,
         s.id AS student_id,
         s.student_number,
         u.name AS student_name,
         CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
         sha.requested_by,
         req_u.name AS requested_by_name,
         sha.approved_by,
         app_u.name AS approved_by_name,
         sha.adjustment_hours::text AS adjustment_hours,
         sha.reason,
         sha.status,
         sha.approved_at::text AS approved_at,
         sha.created_at::text AS created_at,
         sha.updated_at::text AS updated_at
       FROM service_hour_adjustments sha
       JOIN task_applications ta ON ta.id = sha.application_id
       JOIN tasks t ON t.id = ta.task_id
       JOIN students s ON s.id = ta.student_id
       JOIN users u ON u.id = s.user_id
       JOIN users req_u ON req_u.id = sha.requested_by
       LEFT JOIN users app_u ON app_u.id = sha.approved_by
       LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
       LEFT JOIN sections sec ON sec.id = ssh.section_id
       LEFT JOIN programs p ON p.id = sec.program_id
       LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
       WHERE sha.id = $1
       LIMIT 1`,
      [adjId],
    );
    return mapAdjustmentRow(rowRes.rows[0]!);
  });
}

export async function decideServiceHourAdjustment(input: {
  adjustmentId: number;
  decision: 'approved' | 'rejected';
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ServiceHourAdjustmentRecord> {
  const adjustmentId = parsePositiveInt(
    input.adjustmentId,
    'INVALID_ADJUSTMENT_ID',
    'adjustment identifier',
  );
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Decision must be "approved" or "rejected".');
  }

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      application_id: number;
      adjustment_hours: string;
      status: AdjustmentStatus;
      reason: string;
      student_user_id: number;
      task_title: string;
    }>(
      `SELECT sha.id, sha.application_id, sha.adjustment_hours::text, sha.status, sha.reason,
              s.user_id AS student_user_id, t.title AS task_title
       FROM service_hour_adjustments sha
       JOIN task_applications ta ON ta.id = sha.application_id
       JOIN students s ON s.id = ta.student_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE sha.id = $1
       FOR UPDATE OF sha`,
      [adjustmentId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'ADJUSTMENT_NOT_FOUND', 'Service-hour adjustment record not found.');
    }
    if (existing.status !== 'pending') {
      throw new AppError(
        409,
        'ALREADY_DECIDED',
        `This adjustment request has already been marked "${existing.status}".`,
      );
    }

    const adjVal = Number(existing.adjustment_hours);
    if (input.decision === 'approved' && adjVal < 0) {
      const currRes = await client.query<{ credited: string }>(
        `SELECT (
           COALESCE((SELECT SUM(verified_hours) FROM attendance WHERE application_id = $1 AND verification_status = 'verified'), 0)
           + COALESCE((SELECT SUM(adjustment_hours) FROM service_hour_adjustments WHERE application_id = $1 AND status = 'approved'), 0)
         )::text AS credited`,
        [existing.application_id],
      );
      const currentCredited = Number(currRes.rows[0]?.credited ?? '0') || 0;
      if (currentCredited + adjVal < 0) {
        throw new AppError(
          400,
          'NEGATIVE_TOTAL_NOT_ALLOWED',
          `Cannot approve negative adjustment because credited hours (${currentCredited.toFixed(2)}) would become negative.`,
        );
      }
    }

    await client.query(
      `UPDATE service_hour_adjustments
       SET status = $1,
           approved_by = $2,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [input.decision, input.coordinatorUserId, adjustmentId],
    );

    await createNotification(
      {
        userId: Number(existing.student_user_id),
        title:
          input.decision === 'approved'
            ? 'Service Hour Adjustment Approved'
            : 'Service Hour Adjustment Declined',
        message:
          input.decision === 'approved'
            ? `Your service-hour adjustment (${adjVal >= 0 ? '+' : ''}${adjVal.toFixed(2)} hrs) for "${existing.task_title}" was approved.`
            : `Your service-hour adjustment request (${adjVal >= 0 ? '+' : ''}${adjVal.toFixed(2)} hrs) for "${existing.task_title}" was declined.`,
        notificationType: `service_hour_adjustment_${input.decision}`,
        relatedType: 'service_hour_adjustments',
        relatedId: adjustmentId,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: `service_hour_adjustment_${input.decision}`,
        subjectType: 'service_hour_adjustments',
        subjectId: adjustmentId,
        oldValues: { status: existing.status },
        newValues: { status: input.decision, adjustment_hours: adjVal },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AdjustmentDbRow>(
      `SELECT
         sha.id,
         sha.application_id,
         t.id AS task_id,
         t.title AS task_title,
         s.id AS student_id,
         s.student_number,
         u.name AS student_name,
         CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
         sha.requested_by,
         req_u.name AS requested_by_name,
         sha.approved_by,
         app_u.name AS approved_by_name,
         sha.adjustment_hours::text AS adjustment_hours,
         sha.reason,
         sha.status,
         sha.approved_at::text AS approved_at,
         sha.created_at::text AS created_at,
         sha.updated_at::text AS updated_at
       FROM service_hour_adjustments sha
       JOIN task_applications ta ON ta.id = sha.application_id
       JOIN tasks t ON t.id = ta.task_id
       JOIN students s ON s.id = ta.student_id
       JOIN users u ON u.id = s.user_id
       JOIN users req_u ON req_u.id = sha.requested_by
       LEFT JOIN users app_u ON app_u.id = sha.approved_by
       LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
       LEFT JOIN sections sec ON sec.id = ssh.section_id
       LEFT JOIN programs p ON p.id = sec.program_id
       LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
       WHERE sha.id = $1
       LIMIT 1`,
      [adjustmentId],
    );
    return mapAdjustmentRow(rowRes.rows[0]!);
  });
}
