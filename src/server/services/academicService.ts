import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AcademicYearPeriodStatus,
  AcademicYearRecord,
  CollegeRecord,
  ProgramRecord,
  SectionRecord,
  SectionStudentItem,
  YearLevelRecord,
} from '../types/api.ts';
import { recordAuditLog } from './auditService.ts';

function parsePositiveIntId(value: unknown, code: string, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, code, `Invalid ${label}.`);
  }
  return num;
}

export function validateIsoDateString(raw: unknown, fieldLabel: string): string {
  if (typeof raw !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${fieldLabel} must be a valid YYYY-MM-DD date.`);
  }
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new AppError(400, 'VALIDATION_ERROR', `${fieldLabel} must be formatted as YYYY-MM-DD.`);
  }
  const year = Number.parseInt(match[1] ?? '0', 10);
  const month = Number.parseInt(match[2] ?? '0', 10);
  const day = Number.parseInt(match[3] ?? '0', 10);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', `${fieldLabel} is not a valid calendar date.`);
  }
  return trimmed;
}

export function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function classifyAcademicYearPeriod(
  isCurrent: boolean,
  startDate: string,
  endDate: string,
): AcademicYearPeriodStatus {
  if (isCurrent) {
    return 'current';
  }
  const today = getTodayIsoDate();
  if (startDate > today) {
    return 'upcoming';
  }
  if (endDate < today) {
    return 'past';
  }
  return 'inactive';
}

// ---------------------------------------------------------------------------
// Reference Metadata: Colleges & Year Levels
// ---------------------------------------------------------------------------

export async function listColleges(): Promise<CollegeRecord[]> {
  const res = await query<{
    id: number;
    name: string;
    code: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, name, code, description, is_active, created_at::text, updated_at::text
     FROM colleges
     ORDER BY is_active DESC, name ASC`,
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listYearLevels(): Promise<YearLevelRecord[]> {
  const res = await query<{
    id: number;
    name: string;
    sort_order: number;
  }>(
    `SELECT id, name, sort_order
     FROM year_levels
     ORDER BY sort_order ASC, id ASC`,
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    sortOrder: Number(row.sort_order),
  }));
}

// ---------------------------------------------------------------------------
// Academic Year Management
// ---------------------------------------------------------------------------

interface AcademicYearDbRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  student_assignment_count: string;
  report_count: string;
  created_at: string;
  updated_at: string;
}

function mapAcademicYearRow(row: AcademicYearDbRow): AcademicYearRecord {
  return {
    id: Number(row.id),
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    isCurrent: Boolean(row.is_current),
    periodStatus: classifyAcademicYearPeriod(Boolean(row.is_current), row.start_date, row.end_date),
    studentAssignmentCount: Number.parseInt(row.student_assignment_count ?? '0', 10) || 0,
    reportCount: Number.parseInt(row.report_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACADEMIC_YEAR_SELECT = `
  SELECT
    ay.id,
    ay.name,
    ay.start_date::text AS start_date,
    ay.end_date::text AS end_date,
    ay.is_current,
    (
      SELECT COUNT(*)::text
      FROM student_section_history ssh
      WHERE ssh.academic_year_id = ay.id
    ) AS student_assignment_count,
    (
      SELECT COUNT(*)::text
      FROM rss_reports rr
      WHERE rr.academic_year_id = ay.id
    ) AS report_count,
    ay.created_at::text AS created_at,
    ay.updated_at::text AS updated_at
  FROM academic_years ay
`;

export async function listAcademicYears(): Promise<AcademicYearRecord[]> {
  const res = await query<AcademicYearDbRow>(
    `${ACADEMIC_YEAR_SELECT}
     ORDER BY ay.is_current DESC, ay.start_date DESC, ay.id DESC`,
  );
  return res.rows.map(mapAcademicYearRow);
}

export async function createAcademicYear(input: {
  name: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AcademicYearRecord> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 20) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Academic year name must be 2–20 characters (e.g. 2026-2027).',
    );
  }

  const startDate = validateIsoDateString(input.startDate, 'Start date');
  const endDate = validateIsoDateString(input.endDate, 'End date');
  if (endDate <= startDate) {
    throw new AppError(
      400,
      'INVALID_DATE_RANGE',
      'Academic year end date must be strictly after the start date.',
    );
  }

  const isCurrent = Boolean(input.isCurrent);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(20260004)');

    const dup = await client.query<{ id: number }>(
      `SELECT id FROM academic_years WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'ACADEMIC_YEAR_EXISTS',
        `An academic year named "${name}" already exists.`,
      );
    }

    let previousCurrentId: number | null = null;
    if (isCurrent) {
      const prevRes = await client.query<{ id: number }>(
        `SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1 FOR UPDATE`,
      );
      previousCurrentId = prevRes.rows[0]?.id ? Number(prevRes.rows[0].id) : null;
      if (previousCurrentId !== null) {
        await client.query(
          `UPDATE academic_years
           SET is_current = FALSE, updated_at = NOW()
           WHERE is_current = TRUE`,
        );
      }
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO academic_years (name, start_date, end_date, is_current)
       VALUES ($1, $2::date, $3::date, $4)
       RETURNING id`,
      [name, startDate, endDate, isCurrent],
    );
    const createdId = Number(inserted.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'academic_year_created',
        subjectType: 'academic_years',
        subjectId: createdId,
        oldValues: previousCurrentId ? { previous_current_id: previousCurrentId } : null,
        newValues: {
          name,
          start_date: startDate,
          end_date: endDate,
          is_current: isCurrent,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AcademicYearDbRow>(
      `${ACADEMIC_YEAR_SELECT} WHERE ay.id = $1 LIMIT 1`,
      [createdId],
    );
    return mapAcademicYearRow(rowRes.rows[0]!);
  });
}

export async function updateAcademicYear(input: {
  academicYearId: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AcademicYearRecord> {
  const academicYearId = parsePositiveIntId(
    input.academicYearId,
    'INVALID_ACADEMIC_YEAR_ID',
    'academic year identifier',
  );
  const name = input.name.trim();
  if (name.length < 2 || name.length > 20) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Academic year name must be 2–20 characters (e.g. 2026-2027).',
    );
  }

  const startDate = validateIsoDateString(input.startDate, 'Start date');
  const endDate = validateIsoDateString(input.endDate, 'End date');
  if (endDate <= startDate) {
    throw new AppError(
      400,
      'INVALID_DATE_RANGE',
      'Academic year end date must be strictly after the start date.',
    );
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(20260004)');

    const existingRes = await client.query<{
      id: number;
      name: string;
      start_date: string;
      end_date: string;
      is_current: boolean;
    }>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, is_current
       FROM academic_years
       WHERE id = $1
       FOR UPDATE`,
      [academicYearId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year record not found.');
    }

    const dup = await client.query<{ id: number }>(
      `SELECT id FROM academic_years WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,
      [name, academicYearId],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'ACADEMIC_YEAR_EXISTS',
        `Another academic year named "${name}" already exists.`,
      );
    }

    const nextIsCurrent =
      typeof input.isCurrent === 'boolean' ? input.isCurrent : Boolean(existing.is_current);

    if (nextIsCurrent && !existing.is_current) {
      await client.query(
        `UPDATE academic_years
         SET is_current = FALSE, updated_at = NOW()
         WHERE is_current = TRUE AND id <> $1`,
        [academicYearId],
      );
    }

    await client.query(
      `UPDATE academic_years
       SET name = $1,
           start_date = $2::date,
           end_date = $3::date,
           is_current = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [name, startDate, endDate, nextIsCurrent, academicYearId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'academic_year_updated',
        subjectType: 'academic_years',
        subjectId: academicYearId,
        oldValues: {
          name: existing.name,
          start_date: existing.start_date,
          end_date: existing.end_date,
          is_current: existing.is_current,
        },
        newValues: {
          name,
          start_date: startDate,
          end_date: endDate,
          is_current: nextIsCurrent,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AcademicYearDbRow>(
      `${ACADEMIC_YEAR_SELECT} WHERE ay.id = $1 LIMIT 1`,
      [academicYearId],
    );
    return mapAcademicYearRow(rowRes.rows[0]!);
  });
}

export async function setCurrentAcademicYear(input: {
  academicYearId: number;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AcademicYearRecord> {
  const academicYearId = parsePositiveIntId(
    input.academicYearId,
    'INVALID_ACADEMIC_YEAR_ID',
    'academic year identifier',
  );

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(20260004)');

    const targetRes = await client.query<{
      id: number;
      name: string;
      is_current: boolean;
    }>(
      `SELECT id, name, is_current
       FROM academic_years
       WHERE id = $1
       FOR UPDATE`,
      [academicYearId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year record not found.');
    }

    const previousRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name
       FROM academic_years
       WHERE is_current = TRUE AND id <> $1
       FOR UPDATE`,
      [academicYearId],
    );
    const previous = previousRes.rows[0] ?? null;

    if (previous) {
      await client.query(
        `UPDATE academic_years
         SET is_current = FALSE, updated_at = NOW()
         WHERE is_current = TRUE AND id <> $1`,
        [academicYearId],
      );
    }

    if (!target.is_current) {
      await client.query(
        `UPDATE academic_years
         SET is_current = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [academicYearId],
      );
    }

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'academic_year_set_current',
        subjectType: 'academic_years',
        subjectId: academicYearId,
        oldValues: previous
          ? { previous_current_id: Number(previous.id), previous_current_name: previous.name }
          : { was_current: target.is_current },
        newValues: { current_id: academicYearId, current_name: target.name, is_current: true },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<AcademicYearDbRow>(
      `${ACADEMIC_YEAR_SELECT} WHERE ay.id = $1 LIMIT 1`,
      [academicYearId],
    );
    return mapAcademicYearRow(rowRes.rows[0]!);
  });
}

// ---------------------------------------------------------------------------
// Program Management
// ---------------------------------------------------------------------------

interface ProgramDbRow {
  id: number;
  college_id: number;
  college_name: string;
  college_code: string;
  code: string;
  name: string;
  is_active: boolean;
  section_count: string;
  created_at: string;
  updated_at: string;
}

function mapProgramRow(row: ProgramDbRow): ProgramRecord {
  return {
    id: Number(row.id),
    collegeId: Number(row.college_id),
    collegeName: row.college_name,
    collegeCode: row.college_code,
    code: row.code,
    name: row.name,
    isActive: Boolean(row.is_active),
    sectionCount: Number.parseInt(row.section_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PROGRAM_SELECT = `
  SELECT
    p.id,
    p.college_id,
    c.name AS college_name,
    c.code AS college_code,
    p.code,
    p.name,
    p.is_active,
    (
      SELECT COUNT(*)::text
      FROM sections s
      WHERE s.program_id = p.id
    ) AS section_count,
    p.created_at::text AS created_at,
    p.updated_at::text AS updated_at
  FROM programs p
  JOIN colleges c ON c.id = p.college_id
`;

export async function listPrograms(): Promise<ProgramRecord[]> {
  const res = await query<ProgramDbRow>(
    `${PROGRAM_SELECT}
     ORDER BY p.is_active DESC, c.name ASC, p.code ASC`,
  );
  return res.rows.map(mapProgramRow);
}

function normalizeProgramCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (code.length < 2 || code.length > 30) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Program code must be 2–30 characters.');
  }
  if (!/^[A-Z0-9][A-Z0-9\s\-_/]*$/.test(code)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Program code may contain letters, numbers, spaces, hyphens, underscores, or slashes.',
    );
  }
  return code;
}

export async function createProgram(input: {
  collegeId: number;
  code: string;
  name: string;
  isActive?: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ProgramRecord> {
  const collegeId = parsePositiveIntId(input.collegeId, 'INVALID_COLLEGE_ID', 'college');
  const code = normalizeProgramCode(input.code);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Program name must be 2–150 characters.');
  }
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : true;

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
      throw new AppError(400, 'COLLEGE_INACTIVE', 'Cannot assign a program to an inactive college.');
    }

    const dup = await client.query<{ id: number }>(
      `SELECT id
       FROM programs
       WHERE college_id = $1 AND UPPER(code) = UPPER($2)
       LIMIT 1`,
      [collegeId, code],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'PROGRAM_CODE_EXISTS',
        `Program code "${code}" already exists in ${college.name}.`,
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO programs (college_id, code, name, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [collegeId, code, name, isActive],
    );
    const createdId = Number(inserted.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'program_created',
        subjectType: 'programs',
        subjectId: createdId,
        newValues: {
          college_id: collegeId,
          code,
          name,
          is_active: isActive,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<ProgramDbRow>(`${PROGRAM_SELECT} WHERE p.id = $1 LIMIT 1`, [
      createdId,
    ]);
    return mapProgramRow(rowRes.rows[0]!);
  });
}

export async function updateProgram(input: {
  programId: number;
  collegeId: number;
  code: string;
  name: string;
  isActive: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ProgramRecord> {
  const programId = parsePositiveIntId(input.programId, 'INVALID_PROGRAM_ID', 'program identifier');
  const collegeId = parsePositiveIntId(input.collegeId, 'INVALID_COLLEGE_ID', 'college');
  const code = normalizeProgramCode(input.code);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Program name must be 2–150 characters.');
  }
  const isActive = Boolean(input.isActive);

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      college_id: number;
      code: string;
      name: string;
      is_active: boolean;
    }>(`SELECT id, college_id, code, name, is_active FROM programs WHERE id = $1 FOR UPDATE`, [
      programId,
    ]);
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program record not found.');
    }

    const collegeRes = await client.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM colleges WHERE id = $1 LIMIT 1`,
      [collegeId],
    );
    const college = collegeRes.rows[0];
    if (!college) {
      throw new AppError(404, 'COLLEGE_NOT_FOUND', 'Selected college does not exist.');
    }
    if (!college.is_active && isActive) {
      throw new AppError(400, 'COLLEGE_INACTIVE', 'Cannot activate a program under an inactive college.');
    }

    const dup = await client.query<{ id: number }>(
      `SELECT id
       FROM programs
       WHERE college_id = $1 AND UPPER(code) = UPPER($2) AND id <> $3
       LIMIT 1`,
      [collegeId, code, programId],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'PROGRAM_CODE_EXISTS',
        `Another program with code "${code}" already exists in ${college.name}.`,
      );
    }

    await client.query(
      `UPDATE programs
       SET college_id = $1,
           code = $2,
           name = $3,
           is_active = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [collegeId, code, name, isActive, programId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'program_updated',
        subjectType: 'programs',
        subjectId: programId,
        oldValues: {
          college_id: Number(existing.college_id),
          code: existing.code,
          name: existing.name,
          is_active: existing.is_active,
        },
        newValues: {
          college_id: collegeId,
          code,
          name,
          is_active: isActive,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<ProgramDbRow>(`${PROGRAM_SELECT} WHERE p.id = $1 LIMIT 1`, [
      programId,
    ]);
    return mapProgramRow(rowRes.rows[0]!);
  });
}

// ---------------------------------------------------------------------------
// Section Management
// ---------------------------------------------------------------------------

interface SectionDbRow {
  id: number;
  program_id: number;
  program_code: string;
  program_name: string;
  college_id: number;
  college_name: string;
  year_level_id: number;
  year_level_name: string;
  year_level_sort_order: number;
  name: string;
  is_active: boolean;
  current_student_count: string;
  created_at: string;
  updated_at: string;
}

function mapSectionRow(row: SectionDbRow): SectionRecord {
  return {
    id: Number(row.id),
    programId: Number(row.program_id),
    programCode: row.program_code,
    programName: row.program_name,
    collegeId: Number(row.college_id),
    collegeName: row.college_name,
    yearLevelId: Number(row.year_level_id),
    yearLevelName: row.year_level_name,
    yearLevelSortOrder: Number(row.year_level_sort_order),
    name: row.name,
    isActive: Boolean(row.is_active),
    currentStudentCount: Number.parseInt(row.current_student_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildSectionSelect(hasAcademicYearFilter: boolean): string {
  const countFilter = hasAcademicYearFilter
    ? 'AND ssh.academic_year_id = $1'
    : '';
  return `
    SELECT
      s.id,
      s.program_id,
      p.code AS program_code,
      p.name AS program_name,
      p.college_id,
      c.name AS college_name,
      s.year_level_id,
      yl.name AS year_level_name,
      yl.sort_order AS year_level_sort_order,
      s.name,
      s.is_active,
      (
        SELECT COUNT(*)::text
        FROM student_section_history ssh
        JOIN students st ON st.id = ssh.student_id
        JOIN users u ON u.id = st.user_id
        WHERE ssh.section_id = s.id
          AND ssh.is_current = TRUE
          AND u.deleted_at IS NULL
          ${countFilter}
      ) AS current_student_count,
      s.created_at::text AS created_at,
      s.updated_at::text AS updated_at
    FROM sections s
    JOIN programs p ON p.id = s.program_id
    JOIN colleges c ON c.id = p.college_id
    JOIN year_levels yl ON yl.id = s.year_level_id
  `;
}

export async function listSections(academicYearId?: number): Promise<SectionRecord[]> {
  if (academicYearId !== undefined) {
    const validAyId = parsePositiveIntId(
      academicYearId,
      'INVALID_ACADEMIC_YEAR_ID',
      'academic year identifier',
    );
    const res = await query<SectionDbRow>(
      `${buildSectionSelect(true)}
       ORDER BY s.is_active DESC, p.code ASC, yl.sort_order ASC, s.name ASC`,
      [validAyId],
    );
    return res.rows.map(mapSectionRow);
  }

  const res = await query<SectionDbRow>(
    `${buildSectionSelect(false)}
     ORDER BY s.is_active DESC, p.code ASC, yl.sort_order ASC, s.name ASC`,
  );
  return res.rows.map(mapSectionRow);
}

export async function createSection(input: {
  programId: number;
  yearLevelId: number;
  name: string;
  isActive?: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<SectionRecord> {
  const programId = parsePositiveIntId(input.programId, 'INVALID_PROGRAM_ID', 'program');
  const yearLevelId = parsePositiveIntId(input.yearLevelId, 'INVALID_YEAR_LEVEL_ID', 'year level');
  const name = input.name.trim();
  if (name.length < 1 || name.length > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Section name must be 1–50 characters.');
  }
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : true;

  return withTransaction(async (client) => {
    const programRes = await client.query<{ id: number; code: string; is_active: boolean }>(
      `SELECT id, code, is_active FROM programs WHERE id = $1 LIMIT 1`,
      [programId],
    );
    const program = programRes.rows[0];
    if (!program) {
      throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Selected program does not exist.');
    }
    if (!program.is_active) {
      throw new AppError(
        400,
        'PROGRAM_INACTIVE',
        'Cannot create a section under an inactive program.',
      );
    }

    const ylRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM year_levels WHERE id = $1 LIMIT 1`,
      [yearLevelId],
    );
    const yearLevel = ylRes.rows[0];
    if (!yearLevel) {
      throw new AppError(404, 'YEAR_LEVEL_NOT_FOUND', 'Selected year level does not exist.');
    }

    const dup = await client.query<{ id: number }>(
      `SELECT id
       FROM sections
       WHERE program_id = $1 AND year_level_id = $2 AND LOWER(name) = LOWER($3)
       LIMIT 1`,
      [programId, yearLevelId, name],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'SECTION_EXISTS',
        `Section "${name}" already exists for ${program.code} (${yearLevel.name}).`,
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO sections (program_id, year_level_id, name, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [programId, yearLevelId, name, isActive],
    );
    const createdId = Number(inserted.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'section_created',
        subjectType: 'sections',
        subjectId: createdId,
        newValues: {
          program_id: programId,
          year_level_id: yearLevelId,
          name,
          is_active: isActive,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<SectionDbRow>(
      `${buildSectionSelect(false)} WHERE s.id = $1 LIMIT 1`,
      [createdId],
    );
    return mapSectionRow(rowRes.rows[0]!);
  });
}

export async function updateSection(input: {
  sectionId: number;
  programId: number;
  yearLevelId: number;
  name: string;
  isActive: boolean;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<SectionRecord> {
  const sectionId = parsePositiveIntId(input.sectionId, 'INVALID_SECTION_ID', 'section identifier');
  const programId = parsePositiveIntId(input.programId, 'INVALID_PROGRAM_ID', 'program');
  const yearLevelId = parsePositiveIntId(input.yearLevelId, 'INVALID_YEAR_LEVEL_ID', 'year level');
  const name = input.name.trim();
  if (name.length < 1 || name.length > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Section name must be 1–50 characters.');
  }
  const isActive = Boolean(input.isActive);

  return withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      program_id: number;
      year_level_id: number;
      name: string;
      is_active: boolean;
    }>(
      `SELECT id, program_id, year_level_id, name, is_active
       FROM sections
       WHERE id = $1
       FOR UPDATE`,
      [sectionId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'SECTION_NOT_FOUND', 'Section record not found.');
    }

    const programRes = await client.query<{ id: number; code: string; is_active: boolean }>(
      `SELECT id, code, is_active FROM programs WHERE id = $1 LIMIT 1`,
      [programId],
    );
    const program = programRes.rows[0];
    if (!program) {
      throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Selected program does not exist.');
    }
    if (!program.is_active && isActive) {
      throw new AppError(
        400,
        'PROGRAM_INACTIVE',
        'Cannot activate a section belonging to an inactive program.',
      );
    }

    const ylRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM year_levels WHERE id = $1 LIMIT 1`,
      [yearLevelId],
    );
    const yearLevel = ylRes.rows[0];
    if (!yearLevel) {
      throw new AppError(404, 'YEAR_LEVEL_NOT_FOUND', 'Selected year level does not exist.');
    }

    const dup = await client.query<{ id: number }>(
      `SELECT id
       FROM sections
       WHERE program_id = $1 AND year_level_id = $2 AND LOWER(name) = LOWER($3) AND id <> $4
       LIMIT 1`,
      [programId, yearLevelId, name, sectionId],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        'SECTION_EXISTS',
        `Another section named "${name}" already exists for ${program.code} (${yearLevel.name}).`,
      );
    }

    await client.query(
      `UPDATE sections
       SET program_id = $1,
           year_level_id = $2,
           name = $3,
           is_active = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [programId, yearLevelId, name, isActive, sectionId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'section_updated',
        subjectType: 'sections',
        subjectId: sectionId,
        oldValues: {
          program_id: Number(existing.program_id),
          year_level_id: Number(existing.year_level_id),
          name: existing.name,
          is_active: existing.is_active,
        },
        newValues: {
          program_id: programId,
          year_level_id: yearLevelId,
          name,
          is_active: isActive,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    const rowRes = await client.query<SectionDbRow>(
      `${buildSectionSelect(false)} WHERE s.id = $1 LIMIT 1`,
      [sectionId],
    );
    return mapSectionRow(rowRes.rows[0]!);
  });
}

export async function listSectionStudents(
  sectionIdInput: number,
  academicYearId?: number,
): Promise<{
  section: SectionRecord;
  students: SectionStudentItem[];
}> {
  const sectionId = parsePositiveIntId(sectionIdInput, 'INVALID_SECTION_ID', 'section identifier');

  const sectionRes = await query<SectionDbRow>(
    `${buildSectionSelect(false)} WHERE s.id = $1 LIMIT 1`,
    [sectionId],
  );
  const sectionRow = sectionRes.rows[0];
  if (!sectionRow) {
    throw new AppError(404, 'SECTION_NOT_FOUND', 'Section record not found.');
  }

  const params: unknown[] = [sectionId];
  let ayCondition = '';
  if (academicYearId !== undefined) {
    const validAyId = parsePositiveIntId(
      academicYearId,
      'INVALID_ACADEMIC_YEAR_ID',
      'academic year identifier',
    );
    params.push(validAyId);
    ayCondition = 'AND ssh.academic_year_id = $2';
  }

  const studentsRes = await query<{
    student_id: number;
    user_id: number;
    student_number: string;
    full_name: string;
    email: string;
    account_status: SectionStudentItem['accountStatus'];
    registration_status: SectionStudentItem['registrationStatus'];
    academic_year_id: number;
    academic_year_name: string;
    enrolled_at: string;
  }>(
    `SELECT
       st.id AS student_id,
       u.id AS user_id,
       st.student_number,
       u.name AS full_name,
       u.email,
       u.account_status,
       st.registration_status,
       ay.id AS academic_year_id,
       ay.name AS academic_year_name,
       ssh.enrolled_at::text AS enrolled_at
     FROM student_section_history ssh
     JOIN students st ON st.id = ssh.student_id
     JOIN users u ON u.id = st.user_id
     JOIN academic_years ay ON ay.id = ssh.academic_year_id
     WHERE ssh.section_id = $1
       AND ssh.is_current = TRUE
       AND u.deleted_at IS NULL
       ${ayCondition}
     ORDER BY st.last_name ASC, st.first_name ASC, st.student_number ASC`,
    params,
  );

  return {
    section: mapSectionRow(sectionRow),
    students: studentsRes.rows.map((row) => ({
      studentId: Number(row.student_id),
      userId: Number(row.user_id),
      studentNumber: row.student_number,
      fullName: row.full_name,
      email: row.email,
      accountStatus: row.account_status,
      registrationStatus: row.registration_status,
      academicYearId: Number(row.academic_year_id),
      academicYearName: row.academic_year_name,
      enrolledAt: row.enrolled_at,
    })),
  };
}
