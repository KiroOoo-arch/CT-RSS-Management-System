import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AccountStatus,
  RegistrationStatus,
  StudentTaskDetailRecord,
  StudentTaskRecord,
  TaskCategoryRecord,
  TaskDetailRecord,
  TaskListResponse,
  TaskRecord,
  TaskSessionRecord,
  TaskStatus,
  TaskTargetSectionItem,
  TaskTargetStudentItem,
  TaskVisibility,
} from '../types/api.ts';
import { validateIsoDateString } from './academicService.ts';
import { recordAuditLog } from './auditService.ts';

const VALID_VISIBILITIES: ReadonlySet<TaskVisibility> = new Set([
  'all_students',
  'specific_sections',
  'selected_students',
]);

const VALID_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'draft',
  'published',
  'ongoing',
  'completed',
  'cancelled',
  'archived',
]);

const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  draft: new Set(['published', 'cancelled', 'archived']),
  published: new Set(['draft', 'ongoing', 'completed', 'cancelled', 'archived']),
  ongoing: new Set(['completed', 'cancelled', 'archived']),
  completed: new Set(['archived']),
  cancelled: new Set(['draft', 'archived']),
  archived: new Set(['draft']),
};

function parsePositiveInt(value: unknown, code: string, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, code, `Invalid ${label}.`);
  }
  return num;
}

function normalizeOptionalText(value: unknown, maxLength: number, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a text value.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must not exceed ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function normalizeRequiredText(
  value: unknown,
  minLength: number,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be between ${minLength} and ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function normalizeOptionalCapacity(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0 || num > 100000) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Task capacity must be a positive whole number (or left blank for unlimited).',
    );
  }
  return num;
}

function normalizeOptionalRequiredHours(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 9999.99) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Required hours must be a non-negative number up to 9999.99.',
    );
  }
  return Math.round(num * 100) / 100;
}

function normalizeOptionalTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a valid date and time.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} is not a valid date/time value.`);
  }
  return parsed.toISOString();
}

function validateTaskDateWindows(input: {
  applicationStart: string | null;
  applicationDeadline: string | null;
  activityStart: string | null;
  activityEnd: string | null;
}): void {
  if (input.applicationStart && input.applicationDeadline) {
    if (new Date(input.applicationDeadline).getTime() <= new Date(input.applicationStart).getTime()) {
      throw new AppError(
        400,
        'INVALID_DATE_RANGE',
        'Application deadline must be strictly after the application start date/time.',
      );
    }
  }
  if (input.activityStart && input.activityEnd) {
    if (new Date(input.activityEnd).getTime() <= new Date(input.activityStart).getTime()) {
      throw new AppError(
        400,
        'INVALID_DATE_RANGE',
        'Activity end date/time must be strictly after the activity start date/time.',
      );
    }
  }
}

function validateTimeString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be formatted as HH:MM.`);
  }
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed);
  if (!match) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a valid 24-hour time (HH:MM).`);
  }
  const hh = match[1]!;
  const mm = match[2]!;
  const ss = match[3] ?? '00';
  return `${hh}:${mm}:${ss}`;
}

function normalizeVisibility(value: unknown): TaskVisibility {
  if (typeof value !== 'string' || !VALID_VISIBILITIES.has(value as TaskVisibility)) {
    throw new AppError(
      400,
      'INVALID_VISIBILITY',
      'Task visibility must be all_students, specific_sections, or selected_students.',
    );
  }
  return value as TaskVisibility;
}

function normalizeTargetIdList(raw: unknown, label: string): number[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a list of numeric identifiers.`);
  }
  const deduped = new Set<number>();
  for (const item of raw) {
    deduped.add(parsePositiveInt(item, 'VALIDATION_ERROR', label));
  }
  return Array.from(deduped);
}

// ---------------------------------------------------------------------------
// Task Categories Management
// ---------------------------------------------------------------------------

interface TaskCategoryDbRow {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  task_count: string;
  created_at: string;
  updated_at: string;
}

function mapTaskCategoryRow(row: TaskCategoryDbRow): TaskCategoryRecord {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    taskCount: Number.parseInt(row.task_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_CATEGORY_SELECT = `
  SELECT
    tc.id,
    tc.name,
    tc.description,
    tc.is_active,
    (
      SELECT COUNT(*)::text
      FROM tasks t
      WHERE t.category_id = tc.id
        AND t.deleted_at IS NULL
    ) AS task_count,
    tc.created_at::text AS created_at,
    tc.updated_at::text AS updated_at
  FROM task_categories tc
`;

export async function listTaskCategories(activeOnly = false): Promise<TaskCategoryRecord[]> {
  const whereClause = activeOnly ? 'WHERE tc.is_active = TRUE' : '';
  const res = await query<TaskCategoryDbRow>(
    `${TASK_CATEGORY_SELECT}
     ${whereClause}
     ORDER BY tc.is_active DESC, tc.name ASC`,
  );
  return res.rows.map(mapTaskCategoryRow);
}

export async function createTaskCategory(input: {
  name: string;
  description?: string | null;
  isActive?: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskCategoryRecord> {
  const name = normalizeRequiredText(input.name, 2, 100, 'Category name');
  const description = normalizeOptionalText(input.description, 1000, 'Category description');
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : true;

  return withTransaction(async (client) => {
    const dup = await client.query<{ id: number }>(
      `SELECT id FROM task_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'TASK_CATEGORY_EXISTS',
        `A task category named "${name}" already exists.`,
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO task_categories (name, description, is_active)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [name, description, isActive],
    );
    const createdId = Number(inserted.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_category_created',
        subjectType: 'task_categories',
        subjectId: createdId,
        newValues: { name, description, is_active: isActive },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<TaskCategoryDbRow>(
      `${TASK_CATEGORY_SELECT} WHERE tc.id = $1 LIMIT 1`,
      [createdId],
    );
    return mapTaskCategoryRow(rowRes.rows[0]!);
  });
}

export async function updateTaskCategory(input: {
  categoryId: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskCategoryRecord> {
  const categoryId = parsePositiveInt(
    input.categoryId,
    'INVALID_CATEGORY_ID',
    'task category identifier',
  );
  const name = normalizeRequiredText(input.name, 2, 100, 'Category name');
  const description = normalizeOptionalText(input.description, 1000, 'Category description');
  const isActive = Boolean(input.isActive);

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      name: string;
      description: string | null;
      is_active: boolean;
    }>(
      `SELECT id, name, description, is_active
       FROM task_categories
       WHERE id = $1
       FOR UPDATE`,
      [categoryId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'TASK_CATEGORY_NOT_FOUND', 'Task category not found.');
    }

    const dup = await client.query<{ id: number }>(
      `SELECT id FROM task_categories WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,
      [name, categoryId],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'TASK_CATEGORY_EXISTS',
        `Another task category named "${name}" already exists.`,
      );
    }

    await client.query(
      `UPDATE task_categories
       SET name = $1,
           description = $2,
           is_active = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [name, description, isActive, categoryId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_category_updated',
        subjectType: 'task_categories',
        subjectId: categoryId,
        oldValues: {
          name: existing.name,
          description: existing.description,
          is_active: existing.is_active,
        },
        newValues: {
          name,
          description,
          is_active: isActive,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<TaskCategoryDbRow>(
      `${TASK_CATEGORY_SELECT} WHERE tc.id = $1 LIMIT 1`,
      [categoryId],
    );
    return mapTaskCategoryRow(rowRes.rows[0]!);
  });
}

// ---------------------------------------------------------------------------
// RSS Tasks Query Helpers & Mapping
// ---------------------------------------------------------------------------

interface TaskDbRow {
  id: number;
  college_id: number;
  college_code: string;
  college_name: string;
  category_id: number;
  category_name: string;
  category_is_active: boolean;
  created_by: number;
  created_by_name: string;
  title: string;
  description: string;
  location: string | null;
  visibility: TaskVisibility;
  capacity: number | null;
  approved_count: string;
  pending_count: string;
  required_hours: string | null;
  application_start: string | null;
  application_deadline: string | null;
  activity_start: string | null;
  activity_end: string | null;
  status: TaskStatus;
  session_count: string;
  target_section_count: string;
  target_student_count: string;
  created_at: string;
  updated_at: string;
}

function mapTaskRow(row: TaskDbRow): TaskRecord {
  const capacity = row.capacity !== null ? Number(row.capacity) : null;
  const approvedCount = Number.parseInt(row.approved_count ?? '0', 10) || 0;
  const pendingCount = Number.parseInt(row.pending_count ?? '0', 10) || 0;
  const remainingCapacity =
    capacity !== null ? Math.max(0, capacity - approvedCount) : null;

  return {
    id: Number(row.id),
    collegeId: Number(row.college_id),
    collegeCode: row.college_code,
    collegeName: row.college_name,
    categoryId: Number(row.category_id),
    categoryName: row.category_name,
    categoryIsActive: Boolean(row.category_is_active),
    createdBy: Number(row.created_by),
    createdByName: row.created_by_name,
    title: row.title,
    description: row.description,
    location: row.location,
    visibility: row.visibility,
    capacity,
    approvedCount,
    pendingCount,
    remainingCapacity,
    requiredHours: row.required_hours !== null ? Number(row.required_hours) : null,
    applicationStart: row.application_start,
    applicationDeadline: row.application_deadline,
    activityStart: row.activity_start,
    activityEnd: row.activity_end,
    status: row.status,
    sessionCount: Number.parseInt(row.session_count ?? '0', 10) || 0,
    targetSectionCount: Number.parseInt(row.target_section_count ?? '0', 10) || 0,
    targetStudentCount: Number.parseInt(row.target_student_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT_FIELDS = `
  SELECT
    t.id,
    t.college_id,
    c.code AS college_code,
    c.name AS college_name,
    t.category_id,
    tc.name AS category_name,
    tc.is_active AS category_is_active,
    t.created_by,
    creator.name AS created_by_name,
    t.title,
    t.description,
    t.location,
    t.visibility,
    t.capacity,
    (
      SELECT COUNT(*)::text
      FROM task_applications ta
      WHERE ta.task_id = t.id AND ta.status = 'approved'
    ) AS approved_count,
    (
      SELECT COUNT(*)::text
      FROM task_applications ta
      WHERE ta.task_id = t.id AND ta.status = 'pending'
    ) AS pending_count,
    t.required_hours::text AS required_hours,
    t.application_start::text AS application_start,
    t.application_deadline::text AS application_deadline,
    t.activity_start::text AS activity_start,
    t.activity_end::text AS activity_end,
    t.status,
    (
      SELECT COUNT(*)::text
      FROM task_sessions ts
      WHERE ts.task_id = t.id
    ) AS session_count,
    (
      SELECT COUNT(*)::text
      FROM task_target_sections tts
      WHERE tts.task_id = t.id
    ) AS target_section_count,
    (
      SELECT COUNT(*)::text
      FROM task_target_students ttu
      WHERE ttu.task_id = t.id
    ) AS target_student_count,
    t.created_at::text AS created_at,
    t.updated_at::text AS updated_at
`;

const TASK_FROM_CLAUSES = `
  FROM tasks t
  JOIN colleges c ON c.id = t.college_id
  JOIN task_categories tc ON tc.id = t.category_id
  JOIN users creator ON creator.id = t.created_by
`;

async function validateTargetsInTx(
  client: PoolClient,
  visibility: TaskVisibility,
  sectionIds: number[],
  studentIds: number[],
  status: TaskStatus,
): Promise<{ cleanSectionIds: number[]; cleanStudentIds: number[] }> {
  if (visibility === 'all_students') {
    return { cleanSectionIds: [], cleanStudentIds: [] };
  }

  if (visibility === 'specific_sections') {
    if ((status === 'published' || status === 'ongoing') && sectionIds.length === 0) {
      throw new AppError(
        400,
        'TARGET_SECTIONS_REQUIRED',
        'Select at least one active section before publishing a section-targeted task.',
      );
    }
    if (sectionIds.length > 0) {
      const secRes = await client.query<{ id: number; name: string; is_active: boolean }>(
        `SELECT id, name, is_active FROM sections WHERE id = ANY($1::bigint[])`,
        [sectionIds],
      );
      if (secRes.rows.length !== sectionIds.length) {
        throw new AppError(
          404,
          'SECTION_NOT_FOUND',
          'One or more selected target sections do not exist.',
        );
      }
      const inactive = secRes.rows.find((row) => !row.is_active);
      if (inactive) {
        throw new AppError(
          400,
          'SECTION_INACTIVE',
          `Section "${inactive.name}" is inactive and cannot be selected as an active task target.`,
        );
      }
    }
    return { cleanSectionIds: sectionIds, cleanStudentIds: [] };
  }

  // selected_students
  if ((status === 'published' || status === 'ongoing') && studentIds.length === 0) {
    throw new AppError(
      400,
      'TARGET_STUDENTS_REQUIRED',
      'Select at least one approved active student before publishing an individually targeted task.',
    );
  }
  if (studentIds.length > 0) {
    const stuRes = await client.query<{
      id: number;
      student_number: string;
      account_status: AccountStatus;
      registration_status: RegistrationStatus;
    }>(
      `SELECT st.id, st.student_number, u.account_status, st.registration_status
       FROM students st
       JOIN users u ON u.id = st.user_id
       WHERE st.id = ANY($1::bigint[])
         AND u.deleted_at IS NULL`,
      [studentIds],
    );
    if (stuRes.rows.length !== studentIds.length) {
      throw new AppError(
        404,
        'STUDENT_NOT_FOUND',
        'One or more selected target students do not exist.',
      );
    }
    const ineligible = stuRes.rows.find(
      (row) => row.account_status !== 'active' || row.registration_status !== 'approved',
    );
    if (ineligible) {
      throw new AppError(
        400,
        'TARGET_STUDENT_INELIGIBLE',
        `Student ${ineligible.student_number} is not currently active and approved.`,
      );
    }
  }
  return { cleanSectionIds: [], cleanStudentIds: studentIds };
}

interface DbExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

async function fetchTaskSessionsWithClient(
  executor: DbExecutor,
  taskId: number,
): Promise<TaskSessionRecord[]> {
  const res = await executor.query<{
    id: number;
    task_id: number;
    session_title: string;
    session_date: string;
    start_time: string;
    end_time: string;
    location: string;
    attendance_count: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       ts.id,
       ts.task_id,
       ts.session_title,
       ts.session_date::text AS session_date,
       to_char(ts.start_time, 'HH24:MI') AS start_time,
       to_char(ts.end_time, 'HH24:MI') AS end_time,
       ts.location,
       (
         SELECT COUNT(*)::text
         FROM attendance a
         WHERE a.task_session_id = ts.id
       ) AS attendance_count,
       ts.created_at::text AS created_at,
       ts.updated_at::text AS updated_at
     FROM task_sessions ts
     WHERE ts.task_id = $1
     ORDER BY ts.session_date ASC, ts.start_time ASC, ts.id ASC`,
    [taskId],
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    taskId: Number(row.task_id),
    sessionTitle: row.session_title,
    sessionDate: row.session_date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    attendanceCount: Number.parseInt(row.attendance_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function fetchTaskDetailWithExecutor(
  executor: DbExecutor,
  taskId: number,
): Promise<TaskDetailRecord> {
  const taskRes = await executor.query<TaskDbRow>(
    `${TASK_SELECT_FIELDS} ${TASK_FROM_CLAUSES} WHERE t.id = $1 AND t.deleted_at IS NULL LIMIT 1`,
    [taskId],
  );
  const taskRow = taskRes.rows[0];
  if (!taskRow) {
    throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
  }

  const base = mapTaskRow(taskRow);

  const [secRes, stuRes, sessions] = await Promise.all([
    executor.query<{
      section_id: number;
      section_name: string;
      program_id: number;
      program_code: string;
      program_name: string;
      year_level_id: number;
      year_level_name: string;
      is_active: boolean;
      current_student_count: string;
    }>(
      `SELECT
         s.id AS section_id,
         s.name AS section_name,
         p.id AS program_id,
         p.code AS program_code,
         p.name AS program_name,
         yl.id AS year_level_id,
         yl.name AS year_level_name,
         s.is_active,
         (
           SELECT COUNT(*)::text
           FROM student_section_history ssh
           JOIN students st ON st.id = ssh.student_id
           JOIN users u ON u.id = st.user_id
           WHERE ssh.section_id = s.id
             AND ssh.is_current = TRUE
             AND u.deleted_at IS NULL
             AND u.account_status = 'active'
             AND st.registration_status = 'approved'
         ) AS current_student_count
       FROM task_target_sections tts
       JOIN sections s ON s.id = tts.section_id
       JOIN programs p ON p.id = s.program_id
       JOIN year_levels yl ON yl.id = s.year_level_id
       WHERE tts.task_id = $1
       ORDER BY p.code ASC, yl.sort_order ASC, s.name ASC`,
      [taskId],
    ),
    executor.query<{
      student_id: number;
      user_id: number;
      student_number: string;
      full_name: string;
      email: string;
      account_status: AccountStatus;
      registration_status: RegistrationStatus;
      section_label: string | null;
    }>(
      `SELECT
         st.id AS student_id,
         u.id AS user_id,
         st.student_number,
         u.name AS full_name,
         u.email,
         u.account_status,
         st.registration_status,
         (
           SELECT p.code || ' ' || sec.name
           FROM student_section_history ssh
           JOIN sections sec ON sec.id = ssh.section_id
           JOIN programs p ON p.id = sec.program_id
           WHERE ssh.student_id = st.id AND ssh.is_current = TRUE
           LIMIT 1
         ) AS section_label
       FROM task_target_students ttu
       JOIN students st ON st.id = ttu.student_id
       JOIN users u ON u.id = st.user_id
       WHERE ttu.task_id = $1
       ORDER BY st.last_name ASC, st.first_name ASC, st.student_number ASC`,
      [taskId],
    ),
    fetchTaskSessionsWithClient(executor, taskId),
  ]);

  let eligibleCountQuery = '';
  let eligibleCountParams: unknown[] = [];

  if (base.visibility === 'all_students') {
    eligibleCountQuery = `
      SELECT COUNT(DISTINCT st.id)::text AS count
      FROM students st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN student_section_history ssh
        ON ssh.student_id = st.id AND ssh.is_current = TRUE
      LEFT JOIN sections s ON s.id = ssh.section_id
      LEFT JOIN programs p ON p.id = s.program_id
      WHERE u.deleted_at IS NULL
        AND u.account_status = 'active'
        AND st.registration_status = 'approved'
        AND (p.college_id IS NULL OR p.college_id = $1)
    `;
    eligibleCountParams = [base.collegeId];
  } else if (base.visibility === 'specific_sections') {
    eligibleCountQuery = `
      SELECT COUNT(DISTINCT st.id)::text AS count
      FROM task_target_sections tts
      JOIN student_section_history ssh
        ON ssh.section_id = tts.section_id AND ssh.is_current = TRUE
      JOIN students st ON st.id = ssh.student_id
      JOIN users u ON u.id = st.user_id
      WHERE tts.task_id = $1
        AND u.deleted_at IS NULL
        AND u.account_status = 'active'
        AND st.registration_status = 'approved'
    `;
    eligibleCountParams = [taskId];
  } else {
    eligibleCountQuery = `
      SELECT COUNT(DISTINCT st.id)::text AS count
      FROM task_target_students ttu
      JOIN students st ON st.id = ttu.student_id
      JOIN users u ON u.id = st.user_id
      WHERE ttu.task_id = $1
        AND u.deleted_at IS NULL
        AND u.account_status = 'active'
        AND st.registration_status = 'approved'
    `;
    eligibleCountParams = [taskId];
  }

  const eligibleRes = await executor.query<{ count: string }>(
    eligibleCountQuery,
    eligibleCountParams,
  );
  const eligibleStudentCount = Number.parseInt(eligibleRes.rows[0]?.count ?? '0', 10) || 0;

  return {
    ...base,
    targetSections: secRes.rows.map((row) => ({
      sectionId: Number(row.section_id),
      sectionName: row.section_name,
      programId: Number(row.program_id),
      programCode: row.program_code,
      programName: row.program_name,
      yearLevelId: Number(row.year_level_id),
      yearLevelName: row.year_level_name,
      isActive: Boolean(row.is_active),
      currentStudentCount: Number.parseInt(row.current_student_count ?? '0', 10) || 0,
    })),
    targetStudents: stuRes.rows.map((row) => ({
      studentId: Number(row.student_id),
      userId: Number(row.user_id),
      studentNumber: row.student_number,
      fullName: row.full_name,
      email: row.email,
      accountStatus: row.account_status,
      registrationStatus: row.registration_status,
      sectionLabel: row.section_label,
    })),
    sessions,
    eligibleStudentCount,
  };
}

export interface ListCoordinatorTasksFilters {
  search?: string;
  status?: string;
  categoryId?: number;
  visibility?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export async function listCoordinatorTasks(
  filters: ListCoordinatorTasksFilters,
): Promise<TaskListResponse> {
  const conditions: string[] = ['t.deleted_at IS NULL'];
  const params: unknown[] = [];

  const pushParam = (val: unknown): string => {
    params.push(val);
    return `$${params.length}`;
  };

  if (filters.search && filters.search.trim().length > 0) {
    const pattern = `%${filters.search.trim()}%`;
    const pRef = pushParam(pattern);
    conditions.push(
      `(t.title ILIKE ${pRef} OR t.description ILIKE ${pRef} OR COALESCE(t.location, '') ILIKE ${pRef} OR tc.name ILIKE ${pRef})`,
    );
  }

  if (filters.status && filters.status !== 'all') {
    const normalizedStatus = filters.status.trim().toLowerCase() as TaskStatus;
    if (!VALID_TASK_STATUSES.has(normalizedStatus)) {
      throw new AppError(400, 'INVALID_TASK_STATUS', 'Invalid task status filter.');
    }
    const pRef = pushParam(normalizedStatus);
    conditions.push(`t.status = ${pRef}`);
  }

  if (filters.categoryId !== undefined) {
    const validCatId = parsePositiveInt(filters.categoryId, 'INVALID_CATEGORY_ID', 'task category');
    const pRef = pushParam(validCatId);
    conditions.push(`t.category_id = ${pRef}`);
  }

  if (filters.visibility && filters.visibility !== 'all') {
    const normalizedVis = filters.visibility.trim().toLowerCase() as TaskVisibility;
    if (!VALID_VISIBILITIES.has(normalizedVis)) {
      throw new AppError(400, 'INVALID_VISIBILITY', 'Invalid task visibility filter.');
    }
    const pRef = pushParam(normalizedVis);
    conditions.push(`t.visibility = ${pRef}`);
  }

  let orderByClause = 't.created_at DESC, t.id DESC';
  switch (filters.sort) {
    case 'deadline_asc':
      orderByClause = 't.application_deadline ASC NULLS LAST, t.created_at DESC, t.id DESC';
      break;
    case 'deadline_desc':
      orderByClause = 't.application_deadline DESC NULLS LAST, t.created_at DESC, t.id DESC';
      break;
    case 'activity_asc':
      orderByClause = 't.activity_start ASC NULLS LAST, t.created_at DESC, t.id DESC';
      break;
    case 'title_asc':
      orderByClause = 'LOWER(t.title) ASC, t.id DESC';
      break;
    default:
      orderByClause = 't.created_at DESC, t.id DESC';
      break;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const pageSize = Math.min(Math.max(filters.pageSize ?? 10, 1), 50);
  const requestedPage = Math.max(filters.page ?? 1, 1);

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     ${TASK_FROM_CLAUSES}
     ${whereClause}`,
    params,
  );
  const total = Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const limitRef = `$${params.length + 1}`;
  const offsetRef = `$${params.length + 2}`;

  const rowsRes = await query<TaskDbRow>(
    `${TASK_SELECT_FIELDS}
     ${TASK_FROM_CLAUSES}
     ${whereClause}
     ORDER BY ${orderByClause}
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    [...params, pageSize, offset],
  );

  return {
    tasks: rowsRes.rows.map(mapTaskRow),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getCoordinatorTaskDetail(taskIdInput: number): Promise<TaskDetailRecord> {
  const taskId = parsePositiveInt(taskIdInput, 'INVALID_TASK_ID', 'task identifier');
  return fetchTaskDetailWithExecutor({ query }, taskId);
}

// ---------------------------------------------------------------------------
// Task Create, Edit, and Status Lifecycle
// ---------------------------------------------------------------------------

export async function createCoordinatorTask(input: {
  collegeId: number;
  categoryId: number;
  title: string;
  description: string;
  location?: string | null;
  visibility: string;
  capacity?: number | null;
  requiredHours?: number | null;
  applicationStart?: string | null;
  applicationDeadline?: string | null;
  activityStart?: string | null;
  activityEnd?: string | null;
  status?: string;
  targetSectionIds?: number[];
  targetStudentIds?: number[];
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskDetailRecord> {
  const collegeId = parsePositiveInt(input.collegeId, 'INVALID_COLLEGE_ID', 'college');
  const categoryId = parsePositiveInt(input.categoryId, 'INVALID_CATEGORY_ID', 'task category');
  const title = normalizeRequiredText(input.title, 3, 200, 'Task title');
  const description = normalizeRequiredText(input.description, 3, 5000, 'Task description');
  const location = normalizeOptionalText(input.location, 255, 'Location');
  const visibility = normalizeVisibility(input.visibility);
  const capacity = normalizeOptionalCapacity(input.capacity);
  const requiredHours = normalizeOptionalRequiredHours(input.requiredHours);
  const applicationStart = normalizeOptionalTimestamp(input.applicationStart, 'Application start');
  const applicationDeadline = normalizeOptionalTimestamp(
    input.applicationDeadline,
    'Application deadline',
  );
  const activityStart = normalizeOptionalTimestamp(input.activityStart, 'Activity start');
  const activityEnd = normalizeOptionalTimestamp(input.activityEnd, 'Activity end');

  validateTaskDateWindows({
    applicationStart,
    applicationDeadline,
    activityStart,
    activityEnd,
  });

  const requestedStatus = (input.status ?? 'draft').trim().toLowerCase() as TaskStatus;
  if (requestedStatus !== 'draft' && requestedStatus !== 'published') {
    throw new AppError(
      400,
      'INVALID_TASK_STATUS',
      'New tasks may only be saved as draft or published immediately.',
    );
  }

  const rawSectionIds = normalizeTargetIdList(input.targetSectionIds, 'target section IDs');
  const rawStudentIds = normalizeTargetIdList(input.targetStudentIds, 'target student IDs');

  return withTransaction(async (client) => {
    const collegeRes = await client.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM colleges WHERE id = $1 LIMIT 1`,
      [collegeId],
    );
    const college = collegeRes.rows[0];
    if (!college) {
      throw new AppError(404, 'COLLEGE_NOT_FOUND', 'Selected college does not exist.');
    }
    if (!college.is_active) {
      throw new AppError(400, 'COLLEGE_INACTIVE', 'Cannot create a task under an inactive college.');
    }

    const catRes = await client.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM task_categories WHERE id = $1 LIMIT 1`,
      [categoryId],
    );
    const category = catRes.rows[0];
    if (!category) {
      throw new AppError(404, 'TASK_CATEGORY_NOT_FOUND', 'Selected task category does not exist.');
    }
    if (!category.is_active) {
      throw new AppError(
        400,
        'TASK_CATEGORY_INACTIVE',
        `Category "${category.name}" is inactive. Activate it or choose an active category.`,
      );
    }

    const { cleanSectionIds, cleanStudentIds } = await validateTargetsInTx(
      client,
      visibility,
      rawSectionIds,
      rawStudentIds,
      requestedStatus,
    );

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO tasks (
         college_id,
         category_id,
         created_by,
         title,
         description,
         location,
         visibility,
         capacity,
         required_hours,
         application_start,
         application_deadline,
         activity_start,
         activity_end,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::timestamptz, $14)
       RETURNING id`,
      [
        collegeId,
        categoryId,
        input.coordinatorUserId,
        title,
        description,
        location,
        visibility,
        capacity,
        requiredHours,
        applicationStart,
        applicationDeadline,
        activityStart,
        activityEnd,
        requestedStatus,
      ],
    );
    const createdTaskId = Number(inserted.rows[0]?.id);

    for (const secId of cleanSectionIds) {
      await client.query(
        `INSERT INTO task_target_sections (task_id, section_id) VALUES ($1, $2)`,
        [createdTaskId, secId],
      );
    }

    for (const stuId of cleanStudentIds) {
      await client.query(
        `INSERT INTO task_target_students (task_id, student_id) VALUES ($1, $2)`,
        [createdTaskId, stuId],
      );
    }

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_created',
        subjectType: 'tasks',
        subjectId: createdTaskId,
        newValues: {
          college_id: collegeId,
          category_id: categoryId,
          title,
          visibility,
          capacity,
          required_hours: requiredHours,
          status: requestedStatus,
          target_section_ids: cleanSectionIds,
          target_student_ids: cleanStudentIds,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return fetchTaskDetailWithExecutor(client, createdTaskId);
  });
}

export async function updateCoordinatorTask(input: {
  taskId: number;
  collegeId: number;
  categoryId: number;
  title: string;
  description: string;
  location?: string | null;
  visibility: string;
  capacity?: number | null;
  requiredHours?: number | null;
  applicationStart?: string | null;
  applicationDeadline?: string | null;
  activityStart?: string | null;
  activityEnd?: string | null;
  targetSectionIds?: number[];
  targetStudentIds?: number[];
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskDetailRecord> {
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const collegeId = parsePositiveInt(input.collegeId, 'INVALID_COLLEGE_ID', 'college');
  const categoryId = parsePositiveInt(input.categoryId, 'INVALID_CATEGORY_ID', 'task category');
  const title = normalizeRequiredText(input.title, 3, 200, 'Task title');
  const description = normalizeRequiredText(input.description, 3, 5000, 'Task description');
  const location = normalizeOptionalText(input.location, 255, 'Location');
  const visibility = normalizeVisibility(input.visibility);
  const capacity = normalizeOptionalCapacity(input.capacity);
  const requiredHours = normalizeOptionalRequiredHours(input.requiredHours);
  const applicationStart = normalizeOptionalTimestamp(input.applicationStart, 'Application start');
  const applicationDeadline = normalizeOptionalTimestamp(
    input.applicationDeadline,
    'Application deadline',
  );
  const activityStart = normalizeOptionalTimestamp(input.activityStart, 'Activity start');
  const activityEnd = normalizeOptionalTimestamp(input.activityEnd, 'Activity end');

  validateTaskDateWindows({
    applicationStart,
    applicationDeadline,
    activityStart,
    activityEnd,
  });

  const rawSectionIds = normalizeTargetIdList(input.targetSectionIds, 'target section IDs');
  const rawStudentIds = normalizeTargetIdList(input.targetStudentIds, 'target student IDs');

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      college_id: number;
      category_id: number;
      title: string;
      visibility: TaskVisibility;
      capacity: number | null;
      required_hours: string | null;
      status: TaskStatus;
    }>(
      `SELECT id, college_id, category_id, title, visibility, capacity, required_hours::text, status
       FROM tasks
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [taskId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
    }
    if (existing.status === 'archived') {
      throw new AppError(
        409,
        'TASK_ARCHIVED',
        'Archived tasks must be reopened to draft before editing.',
      );
    }

    const approvedRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM task_applications
       WHERE task_id = $1 AND status = 'approved'`,
      [taskId],
    );
    const approvedCount = Number.parseInt(approvedRes.rows[0]?.count ?? '0', 10) || 0;
    if (capacity !== null && capacity < approvedCount) {
      throw new AppError(
        409,
        'CAPACITY_BELOW_APPROVED',
        `Capacity (${capacity}) cannot be lower than the ${approvedCount} already approved student applications.`,
      );
    }

    const collegeRes = await client.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM colleges WHERE id = $1 LIMIT 1`,
      [collegeId],
    );
    const college = collegeRes.rows[0];
    if (!college) {
      throw new AppError(404, 'COLLEGE_NOT_FOUND', 'Selected college does not exist.');
    }
    if (!college.is_active && Number(existing.college_id) !== collegeId) {
      throw new AppError(400, 'COLLEGE_INACTIVE', 'Selected college is inactive.');
    }

    const catRes = await client.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM task_categories WHERE id = $1 LIMIT 1`,
      [categoryId],
    );
    const category = catRes.rows[0];
    if (!category) {
      throw new AppError(404, 'TASK_CATEGORY_NOT_FOUND', 'Selected task category does not exist.');
    }
    if (!category.is_active && Number(existing.category_id) !== categoryId) {
      throw new AppError(
        400,
        'TASK_CATEGORY_INACTIVE',
        `Category "${category.name}" is inactive. Select an active category.`,
      );
    }

    const { cleanSectionIds, cleanStudentIds } = await validateTargetsInTx(
      client,
      visibility,
      rawSectionIds,
      rawStudentIds,
      existing.status,
    );

    await client.query(
      `UPDATE tasks
       SET college_id = $1,
           category_id = $2,
           title = $3,
           description = $4,
           location = $5,
           visibility = $6,
           capacity = $7,
           required_hours = $8,
           application_start = $9::timestamptz,
           application_deadline = $10::timestamptz,
           activity_start = $11::timestamptz,
           activity_end = $12::timestamptz,
           updated_at = NOW()
       WHERE id = $13`,
      [
        collegeId,
        categoryId,
        title,
        description,
        location,
        visibility,
        capacity,
        requiredHours,
        applicationStart,
        applicationDeadline,
        activityStart,
        activityEnd,
        taskId,
      ],
    );

    await client.query(`DELETE FROM task_target_sections WHERE task_id = $1`, [taskId]);
    await client.query(`DELETE FROM task_target_students WHERE task_id = $1`, [taskId]);

    for (const secId of cleanSectionIds) {
      await client.query(
        `INSERT INTO task_target_sections (task_id, section_id) VALUES ($1, $2)`,
        [taskId, secId],
      );
    }

    for (const stuId of cleanStudentIds) {
      await client.query(
        `INSERT INTO task_target_students (task_id, student_id) VALUES ($1, $2)`,
        [taskId, stuId],
      );
    }

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_updated',
        subjectType: 'tasks',
        subjectId: taskId,
        oldValues: {
          college_id: Number(existing.college_id),
          category_id: Number(existing.category_id),
          title: existing.title,
          visibility: existing.visibility,
          capacity: existing.capacity,
          required_hours: existing.required_hours,
        },
        newValues: {
          college_id: collegeId,
          category_id: categoryId,
          title,
          visibility,
          capacity,
          required_hours: requiredHours,
          target_section_ids: cleanSectionIds,
          target_student_ids: cleanStudentIds,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return fetchTaskDetailWithExecutor(client, taskId);
  });
}

export async function updateCoordinatorTaskStatus(input: {
  taskId: number;
  status: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskDetailRecord> {
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const nextStatus = input.status.trim().toLowerCase() as TaskStatus;
  if (!VALID_TASK_STATUSES.has(nextStatus)) {
    throw new AppError(400, 'INVALID_TASK_STATUS', 'Invalid target task status.');
  }

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      college_id: number;
      category_id: number;
      visibility: TaskVisibility;
      status: TaskStatus;
    }>(
      `SELECT id, college_id, category_id, visibility, status
       FROM tasks
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [taskId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
    }

    if (existing.status === nextStatus) {
      return fetchTaskDetailWithExecutor(client, taskId);
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status];
    if (!allowed || !allowed.has(nextStatus)) {
      throw new AppError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Cannot transition task status from "${existing.status}" to "${nextStatus}".`,
      );
    }

    if (nextStatus === 'draft' && existing.status === 'published') {
      const appRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM task_applications
         WHERE task_id = $1 AND status IN ('pending', 'approved')`,
        [taskId],
      );
      const activeAppCount = Number.parseInt(appRes.rows[0]?.count ?? '0', 10) || 0;
      if (activeAppCount > 0) {
        throw new AppError(
          409,
          'TASK_HAS_APPLICATIONS',
          `Cannot unpublish to draft because ${activeAppCount} pending or approved application(s) already exist. Cancel or archive the task instead.`,
        );
      }
    }

    if (nextStatus === 'published') {
      const checkRes = await client.query<{
        college_active: boolean;
        category_active: boolean;
        category_name: string;
      }>(
        `SELECT c.is_active AS college_active, tc.is_active AS category_active, tc.name AS category_name
         FROM colleges c
         JOIN task_categories tc ON tc.id = $2
         WHERE c.id = $1
         LIMIT 1`,
        [existing.college_id, existing.category_id],
      );
      const checkRow = checkRes.rows[0];
      if (!checkRow?.college_active) {
        throw new AppError(400, 'COLLEGE_INACTIVE', 'Cannot publish a task under an inactive college.');
      }
      if (!checkRow?.category_active) {
        throw new AppError(
          400,
          'TASK_CATEGORY_INACTIVE',
          `Cannot publish while category "${checkRow?.category_name ?? ''}" is inactive.`,
        );
      }

      if (existing.visibility === 'specific_sections') {
        const countRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM task_target_sections WHERE task_id = $1`,
          [taskId],
        );
        if ((Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0) === 0) {
          throw new AppError(
            400,
            'TARGET_SECTIONS_REQUIRED',
            'Select at least one target section before publishing this task.',
          );
        }
      } else if (existing.visibility === 'selected_students') {
        const countRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM task_target_students WHERE task_id = $1`,
          [taskId],
        );
        if ((Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0) === 0) {
          throw new AppError(
            400,
            'TARGET_STUDENTS_REQUIRED',
            'Select at least one target student before publishing this task.',
          );
        }
      }
    }

    await client.query(
      `UPDATE tasks
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [nextStatus, taskId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_status_updated',
        subjectType: 'tasks',
        subjectId: taskId,
        oldValues: { status: existing.status },
        newValues: { status: nextStatus },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return fetchTaskDetailWithExecutor(client, taskId);
  });
}

// ---------------------------------------------------------------------------
// Task Sessions Management (task_sessions)
// ---------------------------------------------------------------------------

export async function listCoordinatorTaskSessions(taskIdInput: number): Promise<TaskSessionRecord[]> {
  const taskId = parsePositiveInt(taskIdInput, 'INVALID_TASK_ID', 'task identifier');
  const taskCheck = await query<{ id: number }>(
    `SELECT id FROM tasks WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [taskId],
  );
  if (taskCheck.rows.length === 0) {
    throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
  }
  return fetchTaskSessionsWithClient({ query }, taskId);
}

export async function createCoordinatorTaskSession(input: {
  taskId: number;
  sessionTitle: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  location: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskSessionRecord> {
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const sessionTitle = normalizeRequiredText(input.sessionTitle, 2, 150, 'Session title');
  const sessionDate = validateIsoDateString(input.sessionDate, 'Session date');
  const startTime = validateTimeString(input.startTime, 'Start time');
  const endTime = validateTimeString(input.endTime, 'End time');
  const location = normalizeRequiredText(input.location, 2, 255, 'Session location');

  if (endTime <= startTime) {
    throw new AppError(
      400,
      'INVALID_TIME_RANGE',
      'Session end time must be strictly after the start time.',
    );
  }

  return withTransaction(async (client) => {
    const taskRes = await client.query<{ id: number; status: TaskStatus }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [taskId],
    );
    const task = taskRes.rows[0];
    if (!task) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
    }
    if (task.status === 'archived') {
      throw new AppError(
        409,
        'TASK_ARCHIVED',
        'Cannot add sessions to an archived task.',
      );
    }

    const overlapRes = await client.query<{
      id: number;
      session_title: string;
      start_time: string;
      end_time: string;
    }>(
      `SELECT
         id,
         session_title,
         to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time
       FROM task_sessions
       WHERE task_id = $1
         AND session_date = $2::date
         AND start_time < $4::time
         AND end_time > $3::time
       LIMIT 1`,
      [taskId, sessionDate, startTime, endTime],
    );
    const overlap = overlapRes.rows[0];
    if (overlap) {
      throw new AppError(
        409,
        'SESSION_TIME_OVERLAP',
        `Session time overlaps with "${overlap.session_title}" (${overlap.start_time}–${overlap.end_time}) on ${sessionDate}.`,
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location)
       VALUES ($1, $2, $3::date, $4::time, $5::time, $6)
       RETURNING id`,
      [taskId, sessionTitle, sessionDate, startTime, endTime, location],
    );
    const sessionId = Number(inserted.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_session_created',
        subjectType: 'task_sessions',
        subjectId: sessionId,
        newValues: {
          task_id: taskId,
          session_title: sessionTitle,
          session_date: sessionDate,
          start_time: startTime,
          end_time: endTime,
          location,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const sessions = await fetchTaskSessionsWithClient(client, taskId);
    return sessions.find((item) => item.id === sessionId)!;
  });
}

export async function updateCoordinatorTaskSession(input: {
  taskId: number;
  sessionId: number;
  sessionTitle: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  location: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TaskSessionRecord> {
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const sessionId = parsePositiveInt(input.sessionId, 'INVALID_SESSION_ID', 'session identifier');
  const sessionTitle = normalizeRequiredText(input.sessionTitle, 2, 150, 'Session title');
  const sessionDate = validateIsoDateString(input.sessionDate, 'Session date');
  const startTime = validateTimeString(input.startTime, 'Start time');
  const endTime = validateTimeString(input.endTime, 'End time');
  const location = normalizeRequiredText(input.location, 2, 255, 'Session location');

  if (endTime <= startTime) {
    throw new AppError(
      400,
      'INVALID_TIME_RANGE',
      'Session end time must be strictly after the start time.',
    );
  }

  return withTransaction(async (client) => {
    const taskRes = await client.query<{ id: number; status: TaskStatus }>(
      `SELECT id, status FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [taskId],
    );
    const task = taskRes.rows[0];
    if (!task) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'RSS task record not found.');
    }
    if (task.status === 'archived') {
      throw new AppError(409, 'TASK_ARCHIVED', 'Cannot modify sessions on an archived task.');
    }

    const existingRes = await client.query<{
      id: number;
      session_title: string;
      session_date: string;
      start_time: string;
      end_time: string;
      location: string;
    }>(
      `SELECT
         id,
         session_title,
         session_date::text AS session_date,
         to_char(start_time, 'HH24:MI:SS') AS start_time,
         to_char(end_time, 'HH24:MI:SS') AS end_time,
         location
       FROM task_sessions
       WHERE id = $1 AND task_id = $2
       FOR UPDATE`,
      [sessionId, taskId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'TASK_SESSION_NOT_FOUND', 'Task session record not found.');
    }

    const overlapRes = await client.query<{
      id: number;
      session_title: string;
      start_time: string;
      end_time: string;
    }>(
      `SELECT
         id,
         session_title,
         to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time
       FROM task_sessions
       WHERE task_id = $1
         AND id <> $2
         AND session_date = $3::date
         AND start_time < $5::time
         AND end_time > $4::time
       LIMIT 1`,
      [taskId, sessionId, sessionDate, startTime, endTime],
    );
    const overlap = overlapRes.rows[0];
    if (overlap) {
      throw new AppError(
        409,
        'SESSION_TIME_OVERLAP',
        `Session time overlaps with "${overlap.session_title}" (${overlap.start_time}–${overlap.end_time}) on ${sessionDate}.`,
      );
    }

    await client.query(
      `UPDATE task_sessions
       SET session_title = $1,
           session_date = $2::date,
           start_time = $3::time,
           end_time = $4::time,
           location = $5,
           updated_at = NOW()
       WHERE id = $6 AND task_id = $7`,
      [sessionTitle, sessionDate, startTime, endTime, location, sessionId, taskId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_session_updated',
        subjectType: 'task_sessions',
        subjectId: sessionId,
        oldValues: {
          session_title: existing.session_title,
          session_date: existing.session_date,
          start_time: existing.start_time,
          end_time: existing.end_time,
          location: existing.location,
        },
        newValues: {
          session_title: sessionTitle,
          session_date: sessionDate,
          start_time: startTime,
          end_time: endTime,
          location,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const sessions = await fetchTaskSessionsWithClient(client, taskId);
    return sessions.find((item) => item.id === sessionId)!;
  });
}

export async function deleteCoordinatorTaskSession(input: {
  taskId: number;
  sessionId: number;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ deletedSessionId: number }> {
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const sessionId = parsePositiveInt(input.sessionId, 'INVALID_SESSION_ID', 'session identifier');

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      session_title: string;
      session_date: string;
      start_time: string;
      end_time: string;
    }>(
      `SELECT
         id,
         session_title,
         session_date::text AS session_date,
         to_char(start_time, 'HH24:MI:SS') AS start_time,
         to_char(end_time, 'HH24:MI:SS') AS end_time
       FROM task_sessions
       WHERE id = $1 AND task_id = $2
       FOR UPDATE`,
      [sessionId, taskId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'TASK_SESSION_NOT_FOUND', 'Task session record not found.');
    }

    const attCheck = await client.query<{ id: number }>(
      `SELECT id FROM attendance WHERE task_session_id = $1 LIMIT 1`,
      [sessionId],
    );
    if (attCheck.rows.length > 0) {
      throw new AppError(
        409,
        'SESSION_HAS_ATTENDANCE',
        'Cannot remove a task session that already has recorded attendance entries.',
      );
    }

    await client.query(`DELETE FROM task_sessions WHERE id = $1 AND task_id = $2`, [
      sessionId,
      taskId,
    ]);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'task_session_deleted',
        subjectType: 'task_sessions',
        subjectId: sessionId,
        oldValues: {
          task_id: taskId,
          session_title: existing.session_title,
          session_date: existing.session_date,
          start_time: existing.start_time,
          end_time: existing.end_time,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return { deletedSessionId: sessionId };
  });
}

// ---------------------------------------------------------------------------
// Student Task Discovery & Viewing (Strictly Published & Eligible)
// ---------------------------------------------------------------------------

interface StudentTaskDbRow {
  id: number;
  college_id: number;
  college_code: string;
  college_name: string;
  category_id: number;
  category_name: string;
  title: string;
  description: string;
  location: string | null;
  visibility: TaskVisibility;
  eligibility_reason: string;
  capacity: number | null;
  approved_count: string;
  required_hours: string | null;
  application_start: string | null;
  application_deadline: string | null;
  activity_start: string | null;
  activity_end: string | null;
  status: TaskStatus;
  session_count: string;
  my_application_status: string | null;
  created_at: string;
  updated_at: string;
}

function mapStudentTaskRow(row: StudentTaskDbRow): StudentTaskRecord {
  const capacity = row.capacity !== null ? Number(row.capacity) : null;
  const approvedCount = Number.parseInt(row.approved_count ?? '0', 10) || 0;
  const remainingCapacity =
    capacity !== null ? Math.max(0, capacity - approvedCount) : null;
  const isFull = capacity !== null && approvedCount >= capacity;

  return {
    id: Number(row.id),
    collegeId: Number(row.college_id),
    collegeCode: row.college_code,
    collegeName: row.college_name,
    categoryId: Number(row.category_id),
    categoryName: row.category_name,
    title: row.title,
    description: row.description,
    location: row.location,
    visibility: row.visibility,
    eligibilityReason: row.eligibility_reason,
    capacity,
    approvedCount,
    remainingCapacity,
    isFull,
    requiredHours: row.required_hours !== null ? Number(row.required_hours) : null,
    applicationStart: row.application_start,
    applicationDeadline: row.application_deadline,
    activityStart: row.activity_start,
    activityEnd: row.activity_end,
    status: row.status,
    sessionCount: Number.parseInt(row.session_count ?? '0', 10) || 0,
    myApplicationStatus: row.my_application_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getStudentCurrentCollegeId(studentId: number): Promise<number | null> {
  const res = await query<{ college_id: number }>(
    `SELECT p.college_id
     FROM student_section_history ssh
     JOIN sections s ON s.id = ssh.section_id
     JOIN programs p ON p.id = s.program_id
     WHERE ssh.student_id = $1 AND ssh.is_current = TRUE
     LIMIT 1`,
    [studentId],
  );
  return res.rows[0]?.college_id ? Number(res.rows[0].college_id) : null;
}

const STUDENT_ELIGIBLE_CONDITION = `
  t.deleted_at IS NULL
  AND t.status = 'published'
  AND (
    (
      t.visibility = 'all_students'
      AND ($2::bigint IS NULL OR t.college_id = $2::bigint)
    )
    OR (
      t.visibility = 'specific_sections'
      AND EXISTS (
        SELECT 1
        FROM task_target_sections tts
        JOIN student_section_history ssh
          ON ssh.section_id = tts.section_id
        WHERE tts.task_id = t.id
          AND ssh.student_id = $1
          AND ssh.is_current = TRUE
      )
    )
    OR (
      t.visibility = 'selected_students'
      AND EXISTS (
        SELECT 1
        FROM task_target_students ttu
        WHERE ttu.task_id = t.id
          AND ttu.student_id = $1
      )
    )
  )
`;

const STUDENT_TASK_SELECT_FIELDS = `
  SELECT
    t.id,
    t.college_id,
    c.code AS college_code,
    c.name AS college_name,
    t.category_id,
    tc.name AS category_name,
    t.title,
    t.description,
    t.location,
    t.visibility,
    CASE
      WHEN t.visibility = 'all_students' THEN 'Open to All Students'
      WHEN t.visibility = 'specific_sections' THEN 'Targeted to Your Section'
      ELSE 'Assigned Directly to You'
    END AS eligibility_reason,
    t.capacity,
    (
      SELECT COUNT(*)::text
      FROM task_applications ta
      WHERE ta.task_id = t.id AND ta.status = 'approved'
    ) AS approved_count,
    t.required_hours::text AS required_hours,
    t.application_start::text AS application_start,
    t.application_deadline::text AS application_deadline,
    t.activity_start::text AS activity_start,
    t.activity_end::text AS activity_end,
    t.status,
    (
      SELECT COUNT(*)::text
      FROM task_sessions ts
      WHERE ts.task_id = t.id
    ) AS session_count,
    (
      SELECT ta.status
      FROM task_applications ta
      WHERE ta.task_id = t.id AND ta.student_id = $1
      LIMIT 1
    ) AS my_application_status,
    t.created_at::text AS created_at,
    t.updated_at::text AS updated_at
  FROM tasks t
  JOIN colleges c ON c.id = t.college_id
  JOIN task_categories tc ON tc.id = t.category_id
`;

export async function listStudentEligibleTasks(input: {
  studentId: number;
  search?: string;
  categoryId?: number;
}): Promise<{ tasks: StudentTaskRecord[]; categories: TaskCategoryRecord[] }> {
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const studentCollegeId = await getStudentCurrentCollegeId(studentId);

  const params: unknown[] = [studentId, studentCollegeId];
  const extraConditions: string[] = [];

  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim()}%`);
    const pRef = `$${params.length}`;
    extraConditions.push(
      `(t.title ILIKE ${pRef} OR t.description ILIKE ${pRef} OR COALESCE(t.location, '') ILIKE ${pRef} OR tc.name ILIKE ${pRef})`,
    );
  }

  if (input.categoryId !== undefined) {
    const validCatId = parsePositiveInt(input.categoryId, 'INVALID_CATEGORY_ID', 'task category');
    params.push(validCatId);
    extraConditions.push(`t.category_id = $${params.length}`);
  }

  const extraSql = extraConditions.length > 0 ? `AND ${extraConditions.join(' AND ')}` : '';

  const [taskRes, categories] = await Promise.all([
    query<StudentTaskDbRow>(
      `${STUDENT_TASK_SELECT_FIELDS}
       WHERE ${STUDENT_ELIGIBLE_CONDITION}
         ${extraSql}
       ORDER BY t.application_deadline ASC NULLS LAST, t.created_at DESC, t.id DESC`,
      params,
    ),
    listTaskCategories(true),
  ]);

  return {
    tasks: taskRes.rows.map(mapStudentTaskRow),
    categories,
  };
}

export async function getStudentEligibleTaskDetail(input: {
  studentId: number;
  taskId: number;
}): Promise<StudentTaskDetailRecord> {
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const taskId = parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier');
  const studentCollegeId = await getStudentCurrentCollegeId(studentId);

  const existsRes = await query<{ id: number; status: TaskStatus }>(
    `SELECT id, status FROM tasks WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [taskId],
  );
  const existingTask = existsRes.rows[0];
  if (!existingTask || existingTask.status !== 'published') {
    throw new AppError(404, 'TASK_NOT_FOUND', 'Published RSS task not found.');
  }

  const eligibleRes = await query<StudentTaskDbRow>(
    `${STUDENT_TASK_SELECT_FIELDS}
     WHERE t.id = $3
       AND ${STUDENT_ELIGIBLE_CONDITION}
     LIMIT 1`,
    [studentId, studentCollegeId, taskId],
  );
  const row = eligibleRes.rows[0];
  if (!row) {
    throw new AppError(
      403,
      'TASK_NOT_ELIGIBLE',
      'You are not eligible to view this restricted RSS task.',
    );
  }

  const sessions = await fetchTaskSessionsWithClient({ query }, taskId);
  return {
    ...mapStudentTaskRow(row),
    sessions,
  };
}
