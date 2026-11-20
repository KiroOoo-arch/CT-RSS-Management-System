import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AccountStatus,
  RegistrationStatus,
  StudentDetailRecord,
  StudentDirectoryRecord,
  StudentListResponse,
  StudentSectionSnapshot,
} from '../types/api.ts';
import { hashPassword, validatePasswordStrength } from '../utils/password.ts';
import { getTodayIsoDate, validateIsoDateString } from './academicService.ts';
import { recordAuditLog } from './auditService.ts';

const VALID_SEX_MAP = new Map<string, string>([
  ['male', 'Male'],
  ['female', 'Female'],
  ['other', 'Other'],
  ['prefer not to say', 'Prefer not to say'],
]);

function parsePositiveInt(value: unknown, code: string, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, code, `Invalid ${label}.`);
  }
  return num;
}

function normalizeOptionalText(value: unknown, maxLength: number, fieldLabel: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${fieldLabel} must be text.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${fieldLabel} must not exceed ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function normalizeSex(value: unknown): string | null {
  const text = normalizeOptionalText(value, 20, 'Sex');
  if (!text) {
    return null;
  }
  const matched = VALID_SEX_MAP.get(text.toLowerCase());
  if (!matched) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Sex must be one of: Male, Female, Other, Prefer not to say.',
    );
  }
  return matched;
}

function normalizeBirthDate(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const iso = validateIsoDateString(value, 'Birth date');
  if (iso > getTodayIsoDate()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Birth date cannot be in the future.');
  }
  return iso;
}

interface StudentDirectoryDbRow {
  student_id: number;
  user_id: number;
  student_number: string;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  email: string;
  sex: string | null;
  birth_date: string | null;
  contact_number: string | null;
  account_status: AccountStatus;
  registration_status: RegistrationStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  history_id: number | null;
  section_id: number | null;
  section_name: string | null;
  program_id: number | null;
  program_code: string | null;
  program_name: string | null;
  year_level_id: number | null;
  year_level_name: string | null;
  academic_year_id: number | null;
  academic_year_name: string | null;
  enrolled_at: string | null;
}

function mapStudentDirectoryRow(row: StudentDirectoryDbRow): StudentDirectoryRecord {
  const currentSection: StudentSectionSnapshot | null =
    row.history_id !== null &&
    row.section_id !== null &&
    row.section_name !== null &&
    row.program_id !== null &&
    row.program_code !== null &&
    row.program_name !== null &&
    row.year_level_id !== null &&
    row.year_level_name !== null &&
    row.academic_year_id !== null &&
    row.academic_year_name !== null &&
    row.enrolled_at !== null
      ? {
          historyId: Number(row.history_id),
          sectionId: Number(row.section_id),
          sectionName: row.section_name,
          programId: Number(row.program_id),
          programCode: row.program_code,
          programName: row.program_name,
          yearLevelId: Number(row.year_level_id),
          yearLevelName: row.year_level_name,
          academicYearId: Number(row.academic_year_id),
          academicYearName: row.academic_year_name,
          enrolledAt: row.enrolled_at,
          endedAt: null,
          isCurrent: true,
        }
      : null;

  return {
    studentId: Number(row.student_id),
    userId: Number(row.user_id),
    studentNumber: row.student_number,
    fullName: row.full_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    suffix: row.suffix,
    email: row.email,
    sex: row.sex,
    birthDate: row.birth_date,
    contactNumber: row.contact_number,
    accountStatus: row.account_status,
    registrationStatus: row.registration_status,
    currentSection,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STUDENT_DIRECTORY_BASE = `
  FROM students st
  JOIN users u ON u.id = st.user_id
  LEFT JOIN student_section_history ssh
    ON ssh.student_id = st.id AND ssh.is_current = TRUE
  LEFT JOIN sections sec ON sec.id = ssh.section_id
  LEFT JOIN programs p ON p.id = sec.program_id
  LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
  LEFT JOIN academic_years ay ON ay.id = ssh.academic_year_id
`;

const STUDENT_DIRECTORY_COLUMNS = `
  st.id AS student_id,
  u.id AS user_id,
  st.student_number,
  u.name AS full_name,
  st.first_name,
  st.middle_name,
  st.last_name,
  st.suffix,
  u.email,
  st.sex,
  st.birth_date::text AS birth_date,
  st.contact_number,
  u.account_status,
  st.registration_status,
  st.reviewed_by,
  st.reviewed_at::text AS reviewed_at,
  st.created_at::text AS created_at,
  st.updated_at::text AS updated_at,
  ssh.id AS history_id,
  sec.id AS section_id,
  sec.name AS section_name,
  p.id AS program_id,
  p.code AS program_code,
  p.name AS program_name,
  yl.id AS year_level_id,
  yl.name AS year_level_name,
  ay.id AS academic_year_id,
  ay.name AS academic_year_name,
  ssh.enrolled_at::text AS enrolled_at
`;

export interface ListStudentsFilters {
  search?: string;
  programId?: number;
  yearLevelId?: number;
  sectionId?: number;
  academicYearId?: number;
  accountStatus?: string;
  registrationStatus?: string;
  page?: number;
  pageSize?: number;
}

export async function listStudents(filters: ListStudentsFilters): Promise<StudentListResponse> {
  const conditions: string[] = ['u.deleted_at IS NULL'];
  const params: unknown[] = [];

  const pushParam = (val: unknown): string => {
    params.push(val);
    return `$${params.length}`;
  };

  if (filters.search && filters.search.trim().length > 0) {
    const pattern = `%${filters.search.trim()}%`;
    const pRef = pushParam(pattern);
    conditions.push(
      `(st.student_number ILIKE ${pRef} OR u.name ILIKE ${pRef} OR u.email ILIKE ${pRef} OR st.first_name ILIKE ${pRef} OR st.last_name ILIKE ${pRef})`,
    );
  }

  if (filters.programId !== undefined) {
    const pRef = pushParam(parsePositiveInt(filters.programId, 'INVALID_PROGRAM_ID', 'program'));
    conditions.push(`p.id = ${pRef}`);
  }

  if (filters.yearLevelId !== undefined) {
    const pRef = pushParam(
      parsePositiveInt(filters.yearLevelId, 'INVALID_YEAR_LEVEL_ID', 'year level'),
    );
    conditions.push(`yl.id = ${pRef}`);
  }

  if (filters.sectionId !== undefined) {
    const pRef = pushParam(parsePositiveInt(filters.sectionId, 'INVALID_SECTION_ID', 'section'));
    conditions.push(`sec.id = ${pRef}`);
  }

  if (filters.academicYearId !== undefined) {
    const pRef = pushParam(
      parsePositiveInt(filters.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year'),
    );
    conditions.push(`ay.id = ${pRef}`);
  }

  if (filters.accountStatus && filters.accountStatus !== 'all') {
    const normalized = filters.accountStatus.trim().toLowerCase();
    if (!['pending', 'active', 'suspended', 'deactivated'].includes(normalized)) {
      throw new AppError(400, 'INVALID_ACCOUNT_STATUS', 'Invalid account status filter.');
    }
    const pRef = pushParam(normalized);
    conditions.push(`u.account_status = ${pRef}`);
  }

  if (filters.registrationStatus && filters.registrationStatus !== 'all') {
    const normalized = filters.registrationStatus.trim().toLowerCase();
    if (!['pending', 'approved', 'rejected'].includes(normalized)) {
      throw new AppError(400, 'INVALID_REGISTRATION_STATUS', 'Invalid registration status filter.');
    }
    const pRef = pushParam(normalized);
    conditions.push(`st.registration_status = ${pRef}`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const pageSize = Math.min(Math.max(filters.pageSize ?? 15, 1), 100);
  const requestedPage = Math.max(filters.page ?? 1, 1);

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${STUDENT_DIRECTORY_BASE} ${whereClause}`,
    params,
  );
  const total = Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const limitRef = `$${params.length + 1}`;
  const offsetRef = `$${params.length + 2}`;

  const rowsRes = await query<StudentDirectoryDbRow>(
    `SELECT ${STUDENT_DIRECTORY_COLUMNS}
     ${STUDENT_DIRECTORY_BASE}
     ${whereClause}
     ORDER BY st.created_at DESC, st.id DESC
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    [...params, pageSize, offset],
  );

  return {
    students: rowsRes.rows.map(mapStudentDirectoryRow),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getStudentDetail(studentIdInput: number): Promise<StudentDetailRecord> {
  const studentId = parsePositiveInt(studentIdInput, 'INVALID_STUDENT_ID', 'student identifier');

  const studentRes = await query<StudentDirectoryDbRow>(
    `SELECT ${STUDENT_DIRECTORY_COLUMNS}
     ${STUDENT_DIRECTORY_BASE}
     WHERE st.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [studentId],
  );
  const studentRow = studentRes.rows[0];
  if (!studentRow) {
    throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student record not found.');
  }

  const historyRes = await query<{
    id: number;
    section_id: number;
    section_name: string;
    program_id: number;
    program_code: string;
    program_name: string;
    year_level_id: number;
    year_level_name: string;
    academic_year_id: number;
    academic_year_name: string;
    enrolled_at: string;
    ended_at: string | null;
    is_current: boolean;
  }>(
    `SELECT
       ssh.id,
       sec.id AS section_id,
       sec.name AS section_name,
       p.id AS program_id,
       p.code AS program_code,
       p.name AS program_name,
       yl.id AS year_level_id,
       yl.name AS year_level_name,
       ay.id AS academic_year_id,
       ay.name AS academic_year_name,
       ssh.enrolled_at::text AS enrolled_at,
       ssh.ended_at::text AS ended_at,
       ssh.is_current
     FROM student_section_history ssh
     JOIN sections sec ON sec.id = ssh.section_id
     JOIN programs p ON p.id = sec.program_id
     JOIN year_levels yl ON yl.id = sec.year_level_id
     JOIN academic_years ay ON ay.id = ssh.academic_year_id
     WHERE ssh.student_id = $1
     ORDER BY ssh.is_current DESC, ssh.enrolled_at DESC, ssh.id DESC`,
    [studentId],
  );

  const base = mapStudentDirectoryRow(studentRow);
  return {
    ...base,
    reviewedBy: studentRow.reviewed_by ? Number(studentRow.reviewed_by) : null,
    reviewedAt: studentRow.reviewed_at,
    sectionHistory: historyRes.rows.map((h) => ({
      historyId: Number(h.id),
      sectionId: Number(h.section_id),
      sectionName: h.section_name,
      programId: Number(h.program_id),
      programCode: h.program_code,
      programName: h.program_name,
      yearLevelId: Number(h.year_level_id),
      yearLevelName: h.year_level_name,
      academicYearId: Number(h.academic_year_id),
      academicYearName: h.academic_year_name,
      enrolledAt: h.enrolled_at,
      endedAt: h.ended_at,
      isCurrent: Boolean(h.is_current),
    })),
  };
}

export async function createStudentByCoordinator(input: {
  studentNumber: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  sex?: string | null;
  birthDate?: string | null;
  contactNumber?: string | null;
  email: string;
  password: string;
  accountStatus?: 'active' | 'pending';
  sectionId?: number | null;
  academicYearId?: number | null;
  enrolledAt?: string | null;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<StudentDetailRecord> {
  const studentNumber = input.studentNumber.trim();
  const firstName = input.firstName.trim();
  const middleName = normalizeOptionalText(input.middleName, 150, 'Middle name');
  const lastName = input.lastName.trim();
  const suffix = normalizeOptionalText(input.suffix, 30, 'Suffix');
  const sex = normalizeSex(input.sex);
  const birthDate = normalizeBirthDate(input.birthDate);
  const contactNumber = normalizeOptionalText(input.contactNumber, 50, 'Contact number');
  const email = input.email.trim().toLowerCase();
  const accountStatus: 'active' | 'pending' =
    input.accountStatus === 'pending' ? 'pending' : 'active';
  const registrationStatus: RegistrationStatus =
    accountStatus === 'active' ? 'approved' : 'pending';

  if (studentNumber.length < 3 || studentNumber.length > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Student number must be 3–50 characters.');
  }
  if (!firstName || firstName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'First name is required (max 150 characters).');
  }
  if (!lastName || lastName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Last name is required (max 150 characters).');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please enter a valid email address.');
  }

  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) {
    throw new AppError(400, 'WEAK_PASSWORD', passwordError);
  }

  const hasSection = input.sectionId !== undefined && input.sectionId !== null;
  const sectionId = hasSection
    ? parsePositiveInt(input.sectionId, 'INVALID_SECTION_ID', 'section')
    : null;
  let academicYearId: number | null = null;
  let enrolledAt: string | null = null;

  if (sectionId !== null) {
    if (input.academicYearId === undefined || input.academicYearId === null) {
      throw new AppError(
        400,
        'ACADEMIC_YEAR_REQUIRED',
        'An academic year is required when assigning a student to a section.',
      );
    }
    academicYearId = parsePositiveInt(
      input.academicYearId,
      'INVALID_ACADEMIC_YEAR_ID',
      'academic year',
    );
    enrolledAt =
      input.enrolledAt && input.enrolledAt.trim().length > 0
        ? validateIsoDateString(input.enrolledAt, 'Enrollment date')
        : getTodayIsoDate();
  }

  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ').slice(0, 150);
  const passwordHash = await hashPassword(input.password);

  const createdStudentId = await withTransaction(async (client) => {
    const emailDup = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (emailDup.rows.length > 0) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email address already exists.');
    }

    const studentDup = await client.query<{ id: number }>(
      `SELECT id FROM students WHERE LOWER(student_number) = LOWER($1) LIMIT 1`,
      [studentNumber],
    );
    if (studentDup.rows.length > 0) {
      throw new AppError(
        409,
        'STUDENT_NUMBER_EXISTS',
        `Student number "${studentNumber}" is already registered.`,
      );
    }

    const roleRes = await client.query<{ id: number }>(
      `SELECT id FROM roles WHERE name = 'Student' LIMIT 1`,
    );
    const studentRoleId = roleRes.rows[0]?.id;
    if (!studentRoleId) {
      throw new AppError(500, 'ROLES_NOT_SEEDED', 'Student role is missing in roles table.');
    }

    if (sectionId !== null && academicYearId !== null) {
      const secRes = await client.query<{
        id: number;
        section_active: boolean;
        program_active: boolean;
      }>(
        `SELECT s.id, s.is_active AS section_active, p.is_active AS program_active
         FROM sections s
         JOIN programs p ON p.id = s.program_id
         WHERE s.id = $1
         LIMIT 1`,
        [sectionId],
      );
      const sec = secRes.rows[0];
      if (!sec) {
        throw new AppError(404, 'SECTION_NOT_FOUND', 'Selected section does not exist.');
      }
      if (!sec.section_active || !sec.program_active) {
        throw new AppError(
          400,
          'SECTION_INACTIVE',
          'Cannot assign a student to an inactive section or inactive program.',
        );
      }

      const ayRes = await client.query<{ id: number }>(
        `SELECT id FROM academic_years WHERE id = $1 LIMIT 1`,
        [academicYearId],
      );
      if (ayRes.rows.length === 0) {
        throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Selected academic year does not exist.');
      }
    }

    const userInsert = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password, account_status, email_verified_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $4::varchar = 'active' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [fullName, email, passwordHash, accountStatus],
    );
    const userId = Number(userInsert.rows[0]?.id);

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [userId, studentRoleId, input.coordinatorUserId],
    );

    const studentInsert = await client.query<{ id: number }>(
      `INSERT INTO students (
         user_id,
         student_number,
         first_name,
         middle_name,
         last_name,
         suffix,
         sex,
         birth_date,
         contact_number,
         registration_status,
         reviewed_by,
         reviewed_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10,
         CASE WHEN $10::varchar = 'approved' THEN $11::bigint ELSE NULL END,
         CASE WHEN $10::varchar = 'approved' THEN NOW() ELSE NULL END
       )
       RETURNING id`,
      [
        userId,
        studentNumber,
        firstName,
        middleName,
        lastName,
        suffix,
        sex,
        birthDate,
        contactNumber,
        registrationStatus,
        input.coordinatorUserId,
      ],
    );
    const studentId = Number(studentInsert.rows[0]?.id);

    if (sectionId !== null && academicYearId !== null && enrolledAt !== null) {
      await client.query(
        `INSERT INTO student_section_history (
           student_id,
           section_id,
           academic_year_id,
           enrolled_at,
           ended_at,
           is_current
         )
         VALUES ($1, $2, $3, $4::date, NULL, TRUE)`,
        [studentId, sectionId, academicYearId, enrolledAt],
      );

      await recordAuditLog(
        {
          userId: input.coordinatorUserId,
          action: 'student_section_assigned',
          subjectType: 'student_section_history',
          subjectId: studentId,
          newValues: {
            student_id: studentId,
            section_id: sectionId,
            academic_year_id: academicYearId,
            enrolled_at: enrolledAt,
          },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        client,
      );
    }

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'student_created',
        subjectType: 'students',
        subjectId: studentId,
        newValues: {
          user_id: userId,
          student_number: studentNumber,
          name: fullName,
          email,
          account_status: accountStatus,
          registration_status: registrationStatus,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return studentId;
  });

  return getStudentDetail(createdStudentId);
}

export async function updateStudentByCoordinator(input: {
  studentId: number;
  studentNumber: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  sex?: string | null;
  birthDate?: string | null;
  contactNumber?: string | null;
  email: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<StudentDetailRecord> {
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const studentNumber = input.studentNumber.trim();
  const firstName = input.firstName.trim();
  const middleName = normalizeOptionalText(input.middleName, 150, 'Middle name');
  const lastName = input.lastName.trim();
  const suffix = normalizeOptionalText(input.suffix, 30, 'Suffix');
  const sex = normalizeSex(input.sex);
  const birthDate = normalizeBirthDate(input.birthDate);
  const contactNumber = normalizeOptionalText(input.contactNumber, 50, 'Contact number');
  const email = input.email.trim().toLowerCase();

  if (studentNumber.length < 3 || studentNumber.length > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Student number must be 3–50 characters.');
  }
  if (!firstName || firstName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'First name is required (max 150 characters).');
  }
  if (!lastName || lastName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Last name is required (max 150 characters).');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please enter a valid email address.');
  }

  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ').slice(0, 150);

  await withTransaction(async (client) => {
    const existingRes = await client.query<{
      student_id: number;
      user_id: number;
      student_number: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      suffix: string | null;
      sex: string | null;
      birth_date: string | null;
      contact_number: string | null;
      email: string;
      name: string;
    }>(
      `SELECT
         st.id AS student_id,
         u.id AS user_id,
         st.student_number,
         st.first_name,
         st.middle_name,
         st.last_name,
         st.suffix,
         st.sex,
         st.birth_date::text AS birth_date,
         st.contact_number,
         u.email,
         u.name
       FROM students st
       JOIN users u ON u.id = st.user_id
       WHERE st.id = $1 AND u.deleted_at IS NULL
       FOR UPDATE OF st, u`,
      [studentId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student record not found.');
    }

    const emailDup = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,
      [email, Number(existing.user_id)],
    );
    if (emailDup.rows.length > 0) {
      throw new AppError(409, 'EMAIL_EXISTS', 'Another account already uses this email address.');
    }

    const studentDup = await client.query<{ id: number }>(
      `SELECT id FROM students WHERE LOWER(student_number) = LOWER($1) AND id <> $2 LIMIT 1`,
      [studentNumber, studentId],
    );
    if (studentDup.rows.length > 0) {
      throw new AppError(
        409,
        'STUDENT_NUMBER_EXISTS',
        `Student number "${studentNumber}" is already assigned to another student.`,
      );
    }

    await client.query(
      `UPDATE users
       SET name = $1,
           email = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [fullName, email, Number(existing.user_id)],
    );

    await client.query(
      `UPDATE students
       SET student_number = $1,
           first_name = $2,
           middle_name = $3,
           last_name = $4,
           suffix = $5,
           sex = $6,
           birth_date = $7::date,
           contact_number = $8,
           updated_at = NOW()
       WHERE id = $9`,
      [
        studentNumber,
        firstName,
        middleName,
        lastName,
        suffix,
        sex,
        birthDate,
        contactNumber,
        studentId,
      ],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'student_updated',
        subjectType: 'students',
        subjectId: studentId,
        oldValues: {
          student_number: existing.student_number,
          name: existing.name,
          email: existing.email,
          sex: existing.sex,
          birth_date: existing.birth_date,
          contact_number: existing.contact_number,
        },
        newValues: {
          student_number: studentNumber,
          name: fullName,
          email,
          sex,
          birth_date: birthDate,
          contact_number: contactNumber,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );
  });

  return getStudentDetail(studentId);
}

export async function assignOrTransferStudentSection(input: {
  studentId: number;
  sectionId: number;
  academicYearId: number;
  effectiveDate?: string | null;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<StudentDetailRecord> {
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const sectionId = parsePositiveInt(input.sectionId, 'INVALID_SECTION_ID', 'section');
  const academicYearId = parsePositiveInt(
    input.academicYearId,
    'INVALID_ACADEMIC_YEAR_ID',
    'academic year',
  );
  const effectiveDate =
    input.effectiveDate && input.effectiveDate.trim().length > 0
      ? validateIsoDateString(input.effectiveDate, 'Effective date')
      : getTodayIsoDate();

  await withTransaction(async (client) => {
    const studentRes = await client.query<{ id: number }>(
      `SELECT st.id
       FROM students st
       JOIN users u ON u.id = st.user_id
       WHERE st.id = $1 AND u.deleted_at IS NULL
       FOR UPDATE OF st`,
      [studentId],
    );
    if (studentRes.rows.length === 0) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student record not found.');
    }

    const secRes = await client.query<{
      id: number;
      name: string;
      section_active: boolean;
      program_active: boolean;
      program_code: string;
      year_level_name: string;
    }>(
      `SELECT
         s.id,
         s.name,
         s.is_active AS section_active,
         p.is_active AS program_active,
         p.code AS program_code,
         yl.name AS year_level_name
       FROM sections s
       JOIN programs p ON p.id = s.program_id
       JOIN year_levels yl ON yl.id = s.year_level_id
       WHERE s.id = $1
       LIMIT 1`,
      [sectionId],
    );
    const targetSection = secRes.rows[0];
    if (!targetSection) {
      throw new AppError(404, 'SECTION_NOT_FOUND', 'Target section does not exist.');
    }
    if (!targetSection.section_active || !targetSection.program_active) {
      throw new AppError(
        400,
        'SECTION_INACTIVE',
        'Cannot assign or transfer a student into an inactive section or inactive program.',
      );
    }

    const ayRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM academic_years WHERE id = $1 LIMIT 1`,
      [academicYearId],
    );
    const targetAy = ayRes.rows[0];
    if (!targetAy) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Selected academic year does not exist.');
    }

    const currentRes = await client.query<{
      id: number;
      section_id: number;
      academic_year_id: number;
      enrolled_at: string;
    }>(
      `SELECT id, section_id, academic_year_id, enrolled_at::text AS enrolled_at
       FROM student_section_history
       WHERE student_id = $1 AND is_current = TRUE
       FOR UPDATE`,
      [studentId],
    );
    const current = currentRes.rows[0] ?? null;

    if (
      current &&
      Number(current.section_id) === sectionId &&
      Number(current.academic_year_id) === academicYearId
    ) {
      throw new AppError(
        409,
        'ALREADY_ASSIGNED',
        'Student is already currently assigned to this section for the selected academic year.',
      );
    }

    if (current) {
      if (effectiveDate < current.enrolled_at) {
        throw new AppError(
          400,
          'INVALID_EFFECTIVE_DATE',
          `Transfer date (${effectiveDate}) cannot be earlier than the current section enrollment date (${current.enrolled_at}).`,
        );
      }

      await client.query(
        `UPDATE student_section_history
         SET is_current = FALSE,
             ended_at = $1::date,
             updated_at = NOW()
         WHERE id = $2`,
        [effectiveDate, Number(current.id)],
      );
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO student_section_history (
         student_id,
         section_id,
         academic_year_id,
         enrolled_at,
         ended_at,
         is_current
       )
       VALUES ($1, $2, $3, $4::date, NULL, TRUE)
       RETURNING id`,
      [studentId, sectionId, academicYearId, effectiveDate],
    );
    const newHistoryId = Number(inserted.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: current ? 'student_section_transferred' : 'student_section_assigned',
        subjectType: 'student_section_history',
        subjectId: newHistoryId,
        oldValues: current
          ? {
              previous_history_id: Number(current.id),
              previous_section_id: Number(current.section_id),
              previous_academic_year_id: Number(current.academic_year_id),
            }
          : null,
        newValues: {
          student_id: studentId,
          section_id: sectionId,
          section_label: `${targetSection.program_code} · ${targetSection.year_level_name} · ${targetSection.name}`,
          academic_year_id: academicYearId,
          academic_year_name: targetAy.name,
          enrolled_at: effectiveDate,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );
  });

  return getStudentDetail(studentId);
}
