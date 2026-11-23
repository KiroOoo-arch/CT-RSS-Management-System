import type { PoolClient } from 'pg';
import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  ApplicationListResponse,
  ApplicationReviewRecord,
  ApplicationStatus,
  TaskApplicationDetailRecord,
  TaskApplicationRecord,
  TaskStatus,
  TaskVisibility,
} from '../types/api.ts';
import { recordAuditLog } from './auditService.ts';
import { createNotification, notifyActiveCoordinators } from './notificationService.ts';

function parsePositiveInt(value: unknown, code: string, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, code, `Invalid ${label}.`);
  }
  return num;
}

function normalizeOptionalMessage(value: unknown, maxLen: number, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be text.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLen) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must not exceed ${maxLen} characters.`);
  }
  return trimmed;
}

interface ApplicationDbRow {
  id: number;
  task_id: number;
  task_title: string;
  task_status: TaskStatus;
  task_visibility: TaskVisibility;
  task_capacity: number | null;
  task_approved_count: string;
  task_required_hours: string | null;
  category_name: string;
  student_id: number;
  student_user_id: number;
  student_number: string;
  student_name: string;
  student_email: string;
  section_label: string | null;
  academic_year_name: string | null;
  application_message: string | null;
  status: ApplicationStatus;
  applied_at: string;
  decided_at: string | null;
  latest_remarks: string | null;
  verified_attendance_count: string;
  has_submitted_accomplishment: boolean;
  created_at: string;
  updated_at: string;
}

function mapApplicationRow(row: ApplicationDbRow): TaskApplicationRecord {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    taskVisibility: row.task_visibility,
    taskCapacity: row.task_capacity !== null ? Number(row.task_capacity) : null,
    taskApprovedCount: Number.parseInt(row.task_approved_count ?? '0', 10) || 0,
    taskRequiredHours: row.task_required_hours !== null ? Number(row.task_required_hours) : null,
    categoryName: row.category_name,
    studentId: Number(row.student_id),
    studentUserId: Number(row.student_user_id),
    studentNumber: row.student_number,
    studentName: row.student_name,
    studentEmail: row.student_email,
    sectionLabel: row.section_label,
    academicYearName: row.academic_year_name,
    applicationMessage: row.application_message,
    status: row.status,
    appliedAt: row.applied_at,
    decidedAt: row.decided_at,
    latestRemarks: row.latest_remarks,
    verifiedAttendanceCount: Number.parseInt(row.verified_attendance_count ?? '0', 10) || 0,
    hasSubmittedAccomplishment: Boolean(row.has_submitted_accomplishment),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const APPLICATION_SELECT = `
  SELECT
    ta.id,
    ta.task_id,
    t.title AS task_title,
    t.status AS task_status,
    t.visibility AS task_visibility,
    t.capacity AS task_capacity,
    (
      SELECT COUNT(*)::text
      FROM task_applications ta2
      WHERE ta2.task_id = t.id AND ta2.status = 'approved'
    ) AS task_approved_count,
    t.required_hours::text AS task_required_hours,
    tc.name AS category_name,
    s.id AS student_id,
    u.id AS student_user_id,
    s.student_number,
    u.name AS student_name,
    u.email AS student_email,
    CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
    ay.name AS academic_year_name,
    ta.application_message,
    ta.status,
    ta.applied_at::text AS applied_at,
    ta.decided_at::text AS decided_at,
    (
      SELECT ar.remarks
      FROM application_reviews ar
      WHERE ar.application_id = ta.id
      ORDER BY ar.reviewed_at DESC, ar.id DESC
      LIMIT 1
    ) AS latest_remarks,
    (
      SELECT COUNT(*)::text
      FROM attendance att
      WHERE att.application_id = ta.id AND att.verification_status = 'verified'
    ) AS verified_attendance_count,
    EXISTS (
      SELECT 1
      FROM accomplishments acc
      JOIN accomplishment_submissions sub ON sub.accomplishment_id = acc.id
      WHERE acc.application_id = ta.id
    ) AS has_submitted_accomplishment,
    ta.created_at::text AS created_at,
    ta.updated_at::text AS updated_at
  FROM task_applications ta
  JOIN tasks t ON t.id = ta.task_id
  JOIN task_categories tc ON tc.id = t.category_id
  JOIN students s ON s.id = ta.student_id
  JOIN users u ON u.id = s.user_id
  LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
  LEFT JOIN sections sec ON sec.id = ssh.section_id
  LEFT JOIN programs p ON p.id = sec.program_id
  LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
  LEFT JOIN academic_years ay ON ay.id = ssh.academic_year_id
`;

async function verifyStudentEligibilityForTask(
  client: PoolClient,
  studentId: number,
  taskId: number,
): Promise<{
  taskTitle: string;
  taskStatus: TaskStatus;
  visibility: TaskVisibility;
  capacity: number | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
}> {
  const taskRes = await client.query<{
    id: number;
    college_id: number;
    title: string;
    status: TaskStatus;
    visibility: TaskVisibility;
    capacity: number | null;
    application_start: string | null;
    application_deadline: string | null;
  }>(
    `SELECT id, college_id, title, status, visibility, capacity,
            application_start::text AS application_start,
            application_deadline::text AS application_deadline
     FROM tasks
     WHERE id = $1 AND deleted_at IS NULL
     FOR UPDATE`,
    [taskId],
  );
  const task = taskRes.rows[0];
  if (!task) {
    throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
  }
  if (task.status !== 'published') {
    throw new AppError(
      400,
      'TASK_NOT_OPEN',
      `Applications are only accepted for published tasks (current status: "${task.status}").`,
    );
  }

  const now = Date.now();
  if (task.application_start && now < new Date(task.application_start).getTime()) {
    throw new AppError(
      400,
      'APPLICATION_NOT_STARTED',
      'The application window for this RSS task has not opened yet.',
    );
  }
  if (task.application_deadline && now > new Date(task.application_deadline).getTime()) {
    throw new AppError(
      400,
      'APPLICATION_DEADLINE_PASSED',
      'The application deadline for this RSS task has already passed.',
    );
  }

  const secRes = await client.query<{ college_id: number | null; section_id: number | null }>(
    `SELECT p.college_id, ssh.section_id
     FROM student_section_history ssh
     JOIN sections sec ON sec.id = ssh.section_id
     JOIN programs p ON p.id = sec.program_id
     WHERE ssh.student_id = $1 AND ssh.is_current = TRUE
     LIMIT 1`,
    [studentId],
  );
  const studentCollegeId = secRes.rows[0]?.college_id ? Number(secRes.rows[0].college_id) : null;
  const studentSectionId = secRes.rows[0]?.section_id ? Number(secRes.rows[0].section_id) : null;

  let eligible = false;
  if (task.visibility === 'all_students') {
    eligible = studentCollegeId === null || studentCollegeId === Number(task.college_id);
  } else if (task.visibility === 'specific_sections') {
    if (studentSectionId) {
      const targetSec = await client.query<{ id: number }>(
        `SELECT id FROM task_target_sections WHERE task_id = $1 AND section_id = $2 LIMIT 1`,
        [taskId, studentSectionId],
      );
      eligible = targetSec.rows.length > 0;
    }
  } else if (task.visibility === 'selected_students') {
    const targetStu = await client.query<{ id: number }>(
      `SELECT id FROM task_target_students WHERE task_id = $1 AND student_id = $2 LIMIT 1`,
      [taskId, studentId],
    );
    eligible = targetStu.rows.length > 0;
  }

  if (!eligible) {
    throw new AppError(
      403,
      'TASK_NOT_ELIGIBLE',
      'You are not eligible to apply for this restricted RSS task.',
    );
  }

  if (task.capacity !== null) {
    const countRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM task_applications
       WHERE task_id = $1 AND status = 'approved'`,
      [taskId],
    );
    const approvedCount = Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0;
    if (approvedCount >= Number(task.capacity)) {
      throw new AppError(
        409,
        'TASK_CAPACITY_FULL',
        'This RSS task has already reached its maximum approved participant capacity.',
      );
    }
  }

  return {
    taskTitle: task.title,
    taskStatus: task.status,
    visibility: task.visibility,
    capacity: task.capacity !== null ? Number(task.capacity) : null,
    applicationStart: task.application_start,
    applicationDeadline: task.application_deadline,
  };
}

export async function applyToTask(input: {
  taskId: number;
  studentId: number;
  actorUserId: number;
  studentName: string;
  studentNumber: string;
  applicationMessage?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskApplicationRecord> {
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const applicationMessage = normalizeOptionalMessage(
    input.applicationMessage,
    1000,
    'Application message',
  );

  return withTransaction(async (client) => {
    const taskInfo = await verifyStudentEligibilityForTask(client, studentId, taskId);

    const existingRes = await client.query<{
      id: number;
      status: ApplicationStatus;
    }>(
      `SELECT id, status
       FROM task_applications
       WHERE task_id = $1 AND student_id = $2
       FOR UPDATE`,
      [taskId, studentId],
    );
    const existing = existingRes.rows[0];

    let applicationId: number;
    let actionName = 'task_application_submitted';

    if (existing) {
      if (existing.status === 'pending' || existing.status === 'approved') {
        throw new AppError(
          409,
          'DUPLICATE_APPLICATION',
          `You already have an active (${existing.status}) application for this task.`,
        );
      }
      if (existing.status === 'rejected') {
        throw new AppError(
          409,
          'APPLICATION_REJECTED',
          'Your previous application for this task was declined by the Coordinator.',
        );
      }
      // Reactivate withdrawn or cancelled application cleanly respecting UNIQUE(task_id, student_id)
      const updatedRes = await client.query<{ id: number }>(
        `UPDATE task_applications
         SET status = 'pending',
             application_message = $1,
             applied_at = NOW(),
             decided_at = NULL,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id`,
        [applicationMessage, existing.id],
      );
      applicationId = Number(updatedRes.rows[0]?.id);
      actionName = 'task_application_resubmitted';
    } else {
      const insertRes = await client.query<{ id: number }>(
        `INSERT INTO task_applications (task_id, student_id, application_message, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [taskId, studentId, applicationMessage],
      );
      applicationId = Number(insertRes.rows[0]?.id);
    }

    await notifyActiveCoordinators(
      {
        title: 'New RSS Task Application',
        message: `${input.studentName} (${input.studentNumber}) applied for "${taskInfo.taskTitle}".`,
        notificationType: 'task_application_submitted',
        relatedType: 'task_applications',
        relatedId: applicationId,
        deduplicateUnread: true,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.actorUserId,
        action: actionName,
        subjectType: 'task_applications',
        subjectId: applicationId,
        newValues: {
          task_id: taskId,
          student_id: studentId,
          status: 'pending',
          application_message: applicationMessage,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<ApplicationDbRow>(
      `${APPLICATION_SELECT} WHERE ta.id = $1 LIMIT 1`,
      [applicationId],
    );
    return mapApplicationRow(rowRes.rows[0]!);
  });
}

export async function listStudentApplications(input: {
  studentId: number;
  status?: string;
}): Promise<TaskApplicationRecord[]> {
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const params: unknown[] = [studentId];
  let statusSql = '';
  const status = input.status?.trim().toLowerCase();
  if (
    status === 'pending' ||
    status === 'approved' ||
    status === 'rejected' ||
    status === 'withdrawn' ||
    status === 'cancelled'
  ) {
    params.push(status);
    statusSql = `AND ta.status = $${params.length}`;
  }

  const res = await query<ApplicationDbRow>(
    `${APPLICATION_SELECT}
     WHERE ta.student_id = $1
       ${statusSql}
     ORDER BY ta.applied_at DESC, ta.id DESC`,
    params,
  );
  return res.rows.map(mapApplicationRow);
}

export async function withdrawOrCancelStudentApplication(input: {
  applicationId: number;
  studentId: number;
  actorUserId: number;
  reason?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskApplicationRecord> {
  const applicationId = parsePositiveInt(
    input.applicationId,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const reason = normalizeOptionalMessage(input.reason, 500, 'Cancellation reason');

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      task_id: number;
      student_id: number;
      status: ApplicationStatus;
    }>(
      `SELECT id, task_id, student_id, status
       FROM task_applications
       WHERE id = $1
       FOR UPDATE`,
      [applicationId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Task application record not found.');
    }
    if (Number(existing.student_id) !== studentId) {
      throw new AppError(403, 'FORBIDDEN', 'You can only manage your own task applications.');
    }

    let nextStatus: 'withdrawn' | 'cancelled';
    if (existing.status === 'pending') {
      nextStatus = 'withdrawn';
    } else if (existing.status === 'approved') {
      const attCheck = await client.query<{ id: number }>(
        `SELECT id FROM attendance WHERE application_id = $1 AND verification_status = 'verified' LIMIT 1`,
        [applicationId],
      );
      if (attCheck.rows.length > 0) {
        throw new AppError(
          409,
          'APPLICATION_HAS_VERIFIED_ATTENDANCE',
          'Cannot cancel an approved application that already has verified attendance records.',
        );
      }
      const accCheck = await client.query<{ id: number }>(
        `SELECT sub.id
         FROM accomplishments acc
         JOIN accomplishment_submissions sub ON sub.accomplishment_id = acc.id
         WHERE acc.application_id = $1
         LIMIT 1`,
        [applicationId],
      );
      if (accCheck.rows.length > 0) {
        throw new AppError(
          409,
          'APPLICATION_HAS_ACCOMPLISHMENT',
          'Cannot cancel an application with submitted accomplishments.',
        );
      }
      nextStatus = 'cancelled';
    } else {
      throw new AppError(
        409,
        'CANNOT_WITHDRAW_APPLICATION',
        `Applications with status "${existing.status}" cannot be withdrawn or cancelled.`,
      );
    }

    await client.query(
      `UPDATE task_applications
       SET status = $1,
           decided_at = CASE WHEN $1::varchar = 'cancelled' THEN NOW() ELSE decided_at END,
           updated_at = NOW()
       WHERE id = $2`,
      [nextStatus, applicationId],
    );

    await recordAuditLog(
      {
        userId: input.actorUserId,
        action: `task_application_${nextStatus}`,
        subjectType: 'task_applications',
        subjectId: applicationId,
        oldValues: { status: existing.status },
        newValues: { status: nextStatus, reason },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<ApplicationDbRow>(
      `${APPLICATION_SELECT} WHERE ta.id = $1 LIMIT 1`,
      [applicationId],
    );
    return mapApplicationRow(rowRes.rows[0]!);
  });
}

export async function listCoordinatorApplications(input: {
  search?: string;
  taskId?: number;
  studentId?: number;
  sectionId?: number;
  academicYearId?: number;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<ApplicationListResponse> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim()}%`);
    const ref = `$${params.length}`;
    conditions.push(
      `(u.name ILIKE ${ref} OR s.student_number ILIKE ${ref} OR t.title ILIKE ${ref} OR tc.name ILIKE ${ref})`,
    );
  }

  if (input.taskId !== undefined) {
    params.push(parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier'));
    conditions.push(`ta.task_id = $${params.length}`);
  }
  if (input.studentId !== undefined) {
    params.push(parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier'));
    conditions.push(`ta.student_id = $${params.length}`);
  }
  if (input.sectionId !== undefined) {
    params.push(parsePositiveInt(input.sectionId, 'INVALID_SECTION_ID', 'section identifier'));
    conditions.push(`ssh.section_id = $${params.length}`);
  }
  if (input.academicYearId !== undefined) {
    params.push(
      parsePositiveInt(input.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    );
    conditions.push(`ssh.academic_year_id = $${params.length}`);
  }

  const status = input.status?.trim().toLowerCase();
  if (
    status &&
    status !== 'all' &&
    status !== 'pending' &&
    status !== 'approved' &&
    status !== 'rejected' &&
    status !== 'withdrawn' &&
    status !== 'cancelled'
  ) {
    throw new AppError(400, 'INVALID_APPLICATION_STATUS', 'Invalid application status filter.');
  }
  if (
    status === 'pending' ||
    status === 'approved' ||
    status === 'rejected' ||
    status === 'withdrawn' ||
    status === 'cancelled'
  ) {
    params.push(status);
    conditions.push(`ta.status = $${params.length}`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM task_applications ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN task_categories tc ON tc.id = t.category_id
     JOIN students s ON s.id = ta.student_id
     JOIN users u ON u.id = s.user_id
     LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
     ${whereSql}`,
    params,
  );
  const total = Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const dataParams = [...params, pageSize, offset];
  const rowsRes = await query<ApplicationDbRow>(
    `${APPLICATION_SELECT}
     ${whereSql}
     ORDER BY CASE WHEN ta.status = 'pending' THEN 0 ELSE 1 END, ta.applied_at DESC, ta.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );

  return {
    applications: rowsRes.rows.map(mapApplicationRow),
    total,
    page: Math.min(page, totalPages),
    pageSize,
    totalPages,
  };
}

export async function getApplicationDetail(
  applicationIdInput: number,
  studentIdScope?: number,
): Promise<TaskApplicationDetailRecord> {
  const applicationId = parsePositiveInt(
    applicationIdInput,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );

  const rowRes = await query<ApplicationDbRow>(
    `${APPLICATION_SELECT} WHERE ta.id = $1 LIMIT 1`,
    [applicationId],
  );
  const row = rowRes.rows[0];
  if (!row) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Task application record not found.');
  }
  if (studentIdScope !== undefined && Number(row.student_id) !== studentIdScope) {
    throw new AppError(403, 'FORBIDDEN', 'You can only inspect your own task applications.');
  }

  const reviewsRes = await query<{
    id: number;
    application_id: number;
    reviewed_by: number;
    reviewed_by_name: string;
    decision: 'approved' | 'rejected';
    remarks: string | null;
    reviewed_at: string;
  }>(
    `SELECT
       ar.id,
       ar.application_id,
       ar.reviewed_by,
       u.name AS reviewed_by_name,
       ar.decision,
       ar.remarks,
       ar.reviewed_at::text AS reviewed_at
     FROM application_reviews ar
     JOIN users u ON u.id = ar.reviewed_by
     WHERE ar.application_id = $1
     ORDER BY ar.reviewed_at DESC, ar.id DESC`,
    [applicationId],
  );

  const reviews: ApplicationReviewRecord[] = reviewsRes.rows.map((r) => ({
    id: Number(r.id),
    applicationId: Number(r.application_id),
    reviewedBy: Number(r.reviewed_by),
    reviewedByName: r.reviewed_by_name,
    decision: r.decision,
    remarks: r.remarks,
    reviewedAt: r.reviewed_at,
  }));

  return {
    ...mapApplicationRow(row),
    reviews,
  };
}

export async function reviewCoordinatorApplication(input: {
  applicationId: number;
  decision: 'approved' | 'rejected';
  remarks?: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskApplicationDetailRecord> {
  const applicationId = parsePositiveInt(
    input.applicationId,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Decision must be "approved" or "rejected".');
  }
  const remarks = normalizeOptionalMessage(input.remarks, 1000, 'Review remarks');
  if (input.decision === 'rejected' && !remarks) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Remarks are required when rejecting an application.');
  }

  await withTransaction(async (client) => {
    const appRes = await client.query<{
      id: number;
      task_id: number;
      student_id: number;
      status: ApplicationStatus;
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

    if (appRow.status !== 'pending') {
      throw new AppError(
        409,
        'APPLICATION_ALREADY_DECIDED',
        `Cannot review an application that is already "${appRow.status}".`,
      );
    }

    // Lock parent task row to serialize concurrent capacity approvals cleanly
    const taskRes = await client.query<{
      id: number;
      title: string;
      status: TaskStatus;
      capacity: number | null;
    }>(
      `SELECT id, title, status, capacity
       FROM tasks
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [appRow.task_id],
    );
    const task = taskRes.rows[0];
    if (!task) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Associated RSS task no longer exists.');
    }

    if (input.decision === 'approved') {
      if (task.status === 'cancelled' || task.status === 'archived') {
        throw new AppError(
          409,
          'TASK_CLOSED',
          `Cannot approve applications for a "${task.status}" task.`,
        );
      }

      if (task.capacity !== null) {
        const capRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM task_applications
           WHERE task_id = $1 AND status = 'approved'`,
          [task.id],
        );
        const currentApproved = Number.parseInt(capRes.rows[0]?.count ?? '0', 10) || 0;
        if (currentApproved >= Number(task.capacity)) {
          throw new AppError(
            409,
            'TASK_CAPACITY_FULL',
            `Cannot approve application because "${task.title}" is already at full capacity (${task.capacity}).`,
          );
        }
      }
    }

    await client.query(
      `UPDATE task_applications
       SET status = $1,
           decided_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [input.decision, applicationId],
    );

    await client.query(
      `INSERT INTO application_reviews (application_id, reviewed_by, decision, remarks, reviewed_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [applicationId, input.coordinatorUserId, input.decision, remarks],
    );

    await createNotification(
      {
        userId: Number(appRow.student_user_id),
        title:
          input.decision === 'approved'
            ? 'RSS Task Application Approved'
            : 'RSS Task Application Declined',
        message:
          input.decision === 'approved'
            ? `Your application for "${task.title}" has been approved.${remarks ? ` Coordinator remarks: ${remarks}` : ''}`
            : `Your application for "${task.title}" was declined.${remarks ? ` Remarks: ${remarks}` : ''}`,
        notificationType:
          input.decision === 'approved' ? 'application_approved' : 'application_rejected',
        relatedType: 'task_applications',
        relatedId: applicationId,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: `task_application_${input.decision}`,
        subjectType: 'task_applications',
        subjectId: applicationId,
        oldValues: { status: appRow.status },
        newValues: { status: input.decision, remarks },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );
  });

  return getApplicationDetail(applicationId);
}
