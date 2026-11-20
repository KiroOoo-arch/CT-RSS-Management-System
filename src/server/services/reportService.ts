import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AttendanceRecord,
  IndividualReportPreview,
  ReportStatus,
  ReportTemplateConfig,
  ReportTemplateRecord,
  ReportType,
  RssReportRecord,
  SectionReportPreview,
} from '../types/api.ts';
import {
  DEFAULT_TEMPLATE_CONFIG,
  readStoredFileBuffer,
  readTemplateConfigFile,
  saveGeneratedReportPdf,
  saveTemplateConfigFile,
} from '../utils/fileStorage.ts';
import {
  buildIndividualReportPdfBuffer,
  buildSectionReportPdfBuffer,
} from '../utils/pdfReportBuilder.ts';
import { validateIsoDateString } from './academicService.ts';
import { recordAuditLog } from './auditService.ts';
import { createNotification } from './notificationService.ts';

function parsePositiveInt(value: unknown, code: string, label: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, code, `Invalid ${label}.`);
  }
  return num;
}

function normalizeRequiredText(
  value: unknown,
  minLen: number,
  maxLen: number,
  label: string,
): string {
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be between ${minLen} and ${maxLen} characters.`,
    );
  }
  return trimmed;
}

function sanitizeTemplateConfig(raw: unknown): ReportTemplateConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReportTemplateConfig>;
  return {
    reportType:
      input.reportType === 'individual' || input.reportType === 'section'
        ? input.reportType
        : 'both',
    subtitle:
      typeof input.subtitle === 'string' && input.subtitle.trim()
        ? input.subtitle.trim().slice(0, 200)
        : DEFAULT_TEMPLATE_CONFIG.subtitle,
    headerNote:
      typeof input.headerNote === 'string' && input.headerNote.trim()
        ? input.headerNote.trim().slice(0, 200)
        : DEFAULT_TEMPLATE_CONFIG.headerNote,
    footerNote:
      typeof input.footerNote === 'string' && input.footerNote.trim()
        ? input.footerNote.trim().slice(0, 300)
        : DEFAULT_TEMPLATE_CONFIG.footerNote,
    signatoryTitle:
      typeof input.signatoryTitle === 'string' && input.signatoryTitle.trim()
        ? input.signatoryTitle.trim().slice(0, 120)
        : DEFAULT_TEMPLATE_CONFIG.signatoryTitle,
    includeSections: {
      attendanceSummary: Boolean(
        input.includeSections?.attendanceSummary ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.attendanceSummary,
      ),
      serviceHoursBreakdown: Boolean(
        input.includeSections?.serviceHoursBreakdown ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.serviceHoursBreakdown,
      ),
      accomplishmentNarrative: Boolean(
        input.includeSections?.accomplishmentNarrative ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.accomplishmentNarrative,
      ),
      evidenceCountSummary: Boolean(
        input.includeSections?.evidenceCountSummary ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.evidenceCountSummary,
      ),
      sectionComparison: Boolean(
        input.includeSections?.sectionComparison ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.sectionComparison,
      ),
    },
  };
}

interface TemplateDbRow {
  id: number;
  college_id: number;
  college_code: string;
  college_name: string;
  template_name: string;
  template_version: string;
  storage_path: string;
  is_active: boolean;
  uploaded_by: number;
  uploaded_by_name: string;
  report_usage_count: string;
  created_at: string;
  updated_at: string;
}

async function mapTemplateRow(row: TemplateDbRow): Promise<ReportTemplateRecord> {
  const config = await readTemplateConfigFile(row.storage_path);
  return {
    id: Number(row.id),
    collegeId: Number(row.college_id),
    collegeCode: row.college_code,
    collegeName: row.college_name,
    templateName: row.template_name,
    templateVersion: row.template_version,
    storagePath: row.storage_path,
    isActive: Boolean(row.is_active),
    uploadedBy: Number(row.uploaded_by),
    uploadedByName: row.uploaded_by_name,
    config,
    reportUsageCount: Number.parseInt(row.report_usage_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TEMPLATE_SELECT = `
  SELECT
    rt.id,
    rt.college_id,
    c.code AS college_code,
    c.name AS college_name,
    rt.template_name,
    rt.template_version,
    rt.storage_path,
    rt.is_active,
    rt.uploaded_by,
    u.name AS uploaded_by_name,
    (
      SELECT COUNT(*)::text
      FROM rss_reports rr
      WHERE rr.template_id = rt.id
    ) AS report_usage_count,
    rt.created_at::text AS created_at,
    rt.updated_at::text AS updated_at
  FROM report_templates rt
  JOIN colleges c ON c.id = rt.college_id
  JOIN users u ON u.id = rt.uploaded_by
`;

export async function listReportTemplates(collegeId?: number): Promise<ReportTemplateRecord[]> {
  const params: unknown[] = [];
  let whereSql = '';
  if (collegeId !== undefined) {
    params.push(parsePositiveInt(collegeId, 'INVALID_COLLEGE_ID', 'college identifier'));
    whereSql = `WHERE rt.college_id = $1`;
  }

  const res = await query<TemplateDbRow>(
    `${TEMPLATE_SELECT}
     ${whereSql}
     ORDER BY rt.is_active DESC, rt.created_at DESC, rt.id DESC`,
    params,
  );
  return Promise.all(res.rows.map(mapTemplateRow));
}

export async function createReportTemplate(input: {
  collegeId: number;
  templateName: string;
  templateVersion: string;
  isActive?: boolean;
  config?: unknown;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ReportTemplateRecord> {
  const collegeId = parsePositiveInt(input.collegeId, 'INVALID_COLLEGE_ID', 'college identifier');
  const templateName = normalizeRequiredText(input.templateName, 3, 150, 'Template name');
  const templateVersion = normalizeRequiredText(input.templateVersion, 1, 30, 'Template version');
  const isActive = input.isActive !== false;
  const config = sanitizeTemplateConfig(input.config);

  const collegeRes = await query<{ id: number; name: string }>(
    `SELECT id, name FROM colleges WHERE id = $1 LIMIT 1`,
    [collegeId],
  );
  if (collegeRes.rows.length === 0) {
    throw new AppError(404, 'COLLEGE_NOT_FOUND', 'College record not found.');
  }

  const dupRes = await query<{ id: number }>(
    `SELECT id
     FROM report_templates
     WHERE college_id = $1
       AND LOWER(template_name) = LOWER($2)
       AND LOWER(template_version) = LOWER($3)
     LIMIT 1`,
    [collegeId, templateName, templateVersion],
  );
  if (dupRes.rows.length > 0) {
    throw new AppError(
      409,
      'DUPLICATE_TEMPLATE_VERSION',
      `Template "${templateName}" version "${templateVersion}" already exists for this college.`,
    );
  }

  const storagePath = await saveTemplateConfigFile({
    collegeId,
    templateName,
    templateVersion,
    config,
  });

  const templateId = await withTransaction(async (client) => {
    if (isActive) {
      await client.query(
        `UPDATE report_templates
         SET is_active = FALSE, updated_at = NOW()
         WHERE college_id = $1 AND is_active = TRUE`,
        [collegeId],
      );
    }

    const insRes = await client.query<{ id: number }>(
      `INSERT INTO report_templates (
         college_id,
         template_name,
         template_version,
         storage_path,
         is_active,
         uploaded_by
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [collegeId, templateName, templateVersion, storagePath, isActive, input.coordinatorUserId],
    );
    const id = Number(insRes.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'report_template_created',
        subjectType: 'report_templates',
        subjectId: id,
        newValues: {
          college_id: collegeId,
          template_name: templateName,
          template_version: templateVersion,
          is_active: isActive,
          storage_path: storagePath,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return id;
  });

  const res = await query<TemplateDbRow>(`${TEMPLATE_SELECT} WHERE rt.id = $1 LIMIT 1`, [templateId]);
  return mapTemplateRow(res.rows[0]!);
}

export async function updateReportTemplate(input: {
  templateId: number;
  templateName?: string;
  isActive?: boolean;
  config?: unknown;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ReportTemplateRecord> {
  const templateId = parsePositiveInt(
    input.templateId,
    'INVALID_TEMPLATE_ID',
    'report template identifier',
  );

  await withTransaction(async (client) => {
    const existingRes = await client.query<{
      id: number;
      college_id: number;
      template_name: string;
      template_version: string;
      storage_path: string;
      is_active: boolean;
    }>(
      `SELECT id, college_id, template_name, template_version, storage_path, is_active
       FROM report_templates
       WHERE id = $1
       FOR UPDATE`,
      [templateId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Report template record not found.');
    }

    const nextName =
      input.templateName !== undefined
        ? normalizeRequiredText(input.templateName, 3, 150, 'Template name')
        : existing.template_name;
    const nextIsActive =
      input.isActive !== undefined ? Boolean(input.isActive) : Boolean(existing.is_active);

    let nextStoragePath = existing.storage_path;
    if (input.config !== undefined) {
      const nextConfig = sanitizeTemplateConfig(input.config);
      nextStoragePath = await saveTemplateConfigFile({
        collegeId: Number(existing.college_id),
        templateName: nextName,
        templateVersion: existing.template_version,
        config: nextConfig,
      });
    }

    if (nextIsActive && !existing.is_active) {
      await client.query(
        `UPDATE report_templates
         SET is_active = FALSE, updated_at = NOW()
         WHERE college_id = $1 AND id <> $2 AND is_active = TRUE`,
        [existing.college_id, templateId],
      );
    }

    await client.query(
      `UPDATE report_templates
       SET template_name = $1,
           storage_path = $2,
           is_active = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [nextName, nextStoragePath, nextIsActive, templateId],
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'report_template_updated',
        subjectType: 'report_templates',
        subjectId: templateId,
        oldValues: {
          template_name: existing.template_name,
          is_active: existing.is_active,
          storage_path: existing.storage_path,
        },
        newValues: {
          template_name: nextName,
          is_active: nextIsActive,
          storage_path: nextStoragePath,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );
  });

  const res = await query<TemplateDbRow>(`${TEMPLATE_SELECT} WHERE rt.id = $1 LIMIT 1`, [templateId]);
  return mapTemplateRow(res.rows[0]!);
}

interface ReportDbRow {
  id: number;
  college_id: number;
  college_name: string;
  template_id: number;
  template_name: string;
  template_version: string;
  report_type: ReportType;
  accomplishment_submission_id: number | null;
  student_id: number | null;
  student_number: string | null;
  student_name: string | null;
  section_id: number | null;
  section_label: string | null;
  academic_year_id: number | null;
  academic_year_name: string | null;
  version: number;
  file_path: string;
  file_hash: string | null;
  status: ReportStatus;
  generated_by: number;
  generated_by_name: string;
  generated_at: string;
  item_count: string;
  created_at: string;
}

function mapReportRow(row: ReportDbRow): RssReportRecord {
  return {
    id: Number(row.id),
    collegeId: Number(row.college_id),
    collegeName: row.college_name,
    templateId: Number(row.template_id),
    templateName: row.template_name,
    templateVersion: row.template_version,
    reportType: row.report_type,
    accomplishmentSubmissionId:
      row.accomplishment_submission_id !== null ? Number(row.accomplishment_submission_id) : null,
    studentId: row.student_id !== null ? Number(row.student_id) : null,
    studentNumber: row.student_number,
    studentName: row.student_name,
    sectionId: row.section_id !== null ? Number(row.section_id) : null,
    sectionLabel: row.section_label,
    academicYearId: row.academic_year_id !== null ? Number(row.academic_year_id) : null,
    academicYearName: row.academic_year_name,
    version: Number(row.version),
    filePath: row.file_path,
    fileHash: row.file_hash,
    status: row.status,
    generatedBy: Number(row.generated_by),
    generatedByName: row.generated_by_name,
    generatedAt: row.generated_at,
    itemCount: Number.parseInt(row.item_count ?? '0', 10) || 0,
    createdAt: row.created_at,
    downloadUrl: `/api/v1/reports/${Number(row.id)}/download`,
  };
}

const RSS_REPORTS_SELECT = `
  SELECT
    rr.id,
    rr.college_id,
    c.name AS college_name,
    rr.template_id,
    rt.template_name,
    rt.template_version,
    rr.report_type,
    rr.accomplishment_submission_id,
    s.id AS student_id,
    s.student_number,
    stu_u.name AS student_name,
    rr.section_id,
    CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
    rr.academic_year_id,
    ay.name AS academic_year_name,
    rr.version,
    rr.file_path,
    rr.file_hash,
    rr.status,
    rr.generated_by,
    gen_u.name AS generated_by_name,
    rr.generated_at::text AS generated_at,
    (
      SELECT COUNT(*)::text
      FROM report_items ri
      WHERE ri.report_id = rr.id
    ) AS item_count,
    rr.created_at::text AS created_at
  FROM rss_reports rr
  JOIN colleges c ON c.id = rr.college_id
  JOIN report_templates rt ON rt.id = rr.template_id
  JOIN users gen_u ON gen_u.id = rr.generated_by
  LEFT JOIN accomplishment_submissions sub ON sub.id = rr.accomplishment_submission_id
  LEFT JOIN accomplishments acc ON acc.id = sub.accomplishment_id
  LEFT JOIN task_applications ta ON ta.id = acc.application_id
  LEFT JOIN students s ON s.id = ta.student_id
  LEFT JOIN users stu_u ON stu_u.id = s.user_id
  LEFT JOIN sections sec ON sec.id = rr.section_id
  LEFT JOIN programs p ON p.id = sec.program_id
  LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
  LEFT JOIN academic_years ay ON ay.id = rr.academic_year_id
`;

export async function listRssReports(input: {
  reportType?: ReportType;
  studentId?: number;
  sectionId?: number;
  academicYearId?: number;
}): Promise<RssReportRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.reportType === 'individual' || input.reportType === 'section') {
    params.push(input.reportType);
    conditions.push(`rr.report_type = $${params.length}`);
  }
  if (input.studentId !== undefined) {
    params.push(parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier'));
    conditions.push(`s.id = $${params.length}`);
  }
  if (input.sectionId !== undefined) {
    params.push(parsePositiveInt(input.sectionId, 'INVALID_SECTION_ID', 'section identifier'));
    conditions.push(`rr.section_id = $${params.length}`);
  }
  if (input.academicYearId !== undefined) {
    params.push(
      parsePositiveInt(input.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    );
    conditions.push(`rr.academic_year_id = $${params.length}`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query<ReportDbRow>(
    `${RSS_REPORTS_SELECT}
     ${whereSql}
     ORDER BY rr.generated_at DESC, rr.id DESC
     LIMIT 200`,
    params,
  );
  return res.rows.map(mapReportRow);
}

export async function getIndividualReportPreview(input: {
  studentId: number;
  academicYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<IndividualReportPreview> {
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const dateFrom = input.dateFrom ? validateIsoDateString(input.dateFrom, 'Date from') : null;
  const dateTo = input.dateTo ? validateIsoDateString(input.dateTo, 'Date to') : null;

  if (dateFrom && dateTo && dateTo < dateFrom) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'End date cannot precede start date.');
  }

  let effectiveStart = dateFrom;
  let effectiveEnd = dateTo;
  let ayName: string | null = null;
  if (input.academicYearId !== undefined) {
    const ayId = parsePositiveInt(
      input.academicYearId,
      'INVALID_ACADEMIC_YEAR_ID',
      'academic year identifier',
    );
    const ayRes = await query<{ name: string; start_date: string; end_date: string }>(
      `SELECT name, start_date::text AS start_date, end_date::text AS end_date
       FROM academic_years WHERE id = $1 LIMIT 1`,
      [ayId],
    );
    const ayRow = ayRes.rows[0];
    if (!ayRow) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year record not found.');
    }
    ayName = ayRow.name;
    effectiveStart = effectiveStart ?? ayRow.start_date;
    effectiveEnd = effectiveEnd ?? ayRow.end_date;
  }

  const stuRes = await query<{
    student_id: number;
    student_number: string;
    full_name: string;
    email: string;
    section_label: string | null;
    current_ay_name: string | null;
  }>(
    `SELECT
       s.id AS student_id,
       s.student_number,
       u.name AS full_name,
       u.email,
       CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
       ay.name AS current_ay_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
     LEFT JOIN sections sec ON sec.id = ssh.section_id
     LEFT JOIN programs p ON p.id = sec.program_id
     LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
     LEFT JOIN academic_years ay ON ay.id = ssh.academic_year_id
     WHERE s.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [studentId],
  );
  const stu = stuRes.rows[0];
  if (!stu) {
    throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student record not found.');
  }

  const attParams: unknown[] = [studentId];
  const attFilters: string[] = [];
  if (effectiveStart) {
    attParams.push(effectiveStart);
    attFilters.push(`att.attendance_date >= $${attParams.length}::date`);
  }
  if (effectiveEnd) {
    attParams.push(effectiveEnd);
    attFilters.push(`att.attendance_date <= $${attParams.length}::date`);
  }
  const attExtraSql = attFilters.length > 0 ? `AND ${attFilters.join(' AND ')}` : '';

  const attRes = await query<{
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
    verification_status: 'pending' | 'verified' | 'rejected';
    verified_by: number | null;
    verified_by_name: string | null;
    verified_at: string | null;
    remarks: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
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
       NULL::text AS section_label,
       att.attendance_date::text AS attendance_date,
       att.check_in::text AS check_in,
       att.check_out::text AS check_out,
       att.recorded_hours::text AS recorded_hours,
       att.verified_hours::text AS verified_hours,
       att.verification_status,
       att.verified_by,
       ver_u.name AS verified_by_name,
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
     LEFT JOIN users ver_u ON ver_u.id = att.verified_by
     WHERE ta.student_id = $1
       ${attExtraSql}
     ORDER BY att.attendance_date DESC, att.id DESC`,
    attParams,
  );

  const attendanceSummary: AttendanceRecord[] = attRes.rows.map((r) => ({
    id: Number(r.id),
    applicationId: Number(r.application_id),
    taskId: Number(r.task_id),
    taskTitle: r.task_title,
    taskSessionId: Number(r.task_session_id),
    sessionTitle: r.session_title,
    sessionDate: r.session_date,
    sessionStartTime: r.session_start_time,
    sessionEndTime: r.session_end_time,
    sessionLocation: r.session_location,
    studentId: Number(r.student_id),
    studentNumber: r.student_number,
    studentName: r.student_name,
    sectionLabel: r.section_label,
    attendanceDate: r.attendance_date,
    checkIn: r.check_in,
    checkOut: r.check_out,
    recordedHours: Number(r.recorded_hours),
    verifiedHours: Number(r.verified_hours),
    verificationStatus: r.verification_status,
    verifiedBy: r.verified_by !== null ? Number(r.verified_by) : null,
    verifiedByName: r.verified_by_name,
    verifiedAt: r.verified_at,
    remarks: r.remarks,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const subParams: unknown[] = [studentId];
  const subFilters: string[] = [];
  if (effectiveStart) {
    subParams.push(effectiveStart);
    subFilters.push(`sub.activity_date >= $${subParams.length}::date`);
  }
  if (effectiveEnd) {
    subParams.push(effectiveEnd);
    subFilters.push(`sub.activity_date <= $${subParams.length}::date`);
  }
  const subExtraSql = subFilters.length > 0 ? `AND ${subFilters.join(' AND ')}` : '';

  const [adjRes, appCountRes, subRes] = await Promise.all([
    query<{ sum_adj: string }>(
      `SELECT COALESCE(SUM(adj.adjustment_hours), 0)::text AS sum_adj
       FROM service_hour_adjustments adj
       JOIN task_applications ta ON ta.id = adj.application_id
       WHERE ta.student_id = $1 AND adj.status = 'approved'`,
      [studentId],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM task_applications
       WHERE student_id = $1 AND status = 'approved'`,
      [studentId],
    ),
    query<{
      submission_id: number;
      version_number: number;
      task_title: string;
      category_name: string;
      activity_date: string;
      accomplishment_description: string;
      evidence_count: string;
      verified_hours: string;
      reviewed_at: string | null;
    }>(
      `SELECT
         sub.id AS submission_id,
         sub.version_number,
         t.title AS task_title,
         tc.name AS category_name,
         sub.activity_date::text AS activity_date,
         sub.accomplishment_description,
         (
           SELECT COUNT(*)::text FROM evidence_images ev WHERE ev.submission_id = sub.id
         ) AS evidence_count,
         (
           COALESCE((
             SELECT SUM(att.verified_hours)
             FROM attendance att
             WHERE att.application_id = ta.id AND att.verification_status = 'verified'
           ), 0)
           + COALESCE((
             SELECT SUM(adj.adjustment_hours)
             FROM service_hour_adjustments adj
             WHERE adj.application_id = ta.id AND adj.status = 'approved'
           ), 0)
         )::text AS verified_hours,
         acc.reviewed_at::text AS reviewed_at
       FROM accomplishment_submissions sub
       JOIN accomplishments acc ON acc.id = sub.accomplishment_id
       JOIN task_applications ta ON ta.id = acc.application_id
       JOIN tasks t ON t.id = ta.task_id
       JOIN task_categories tc ON tc.id = t.category_id
       WHERE ta.student_id = $1
         AND sub.status = 'approved'
         ${subExtraSql}
       ORDER BY sub.activity_date DESC, sub.id DESC`,
      subParams,
    ),
  ]);

  const verifiedAttHours = attendanceSummary
    .filter((a) => a.verificationStatus === 'verified')
    .reduce((sum, a) => sum + a.verifiedHours, 0);
  const approvedAdjHours = Number(adjRes.rows[0]?.sum_adj ?? '0') || 0;

  return {
    student: {
      studentId: Number(stu.student_id),
      studentNumber: stu.student_number,
      fullName: stu.full_name,
      email: stu.email,
      sectionLabel: stu.section_label,
      academicYearName: ayName ?? stu.current_ay_name,
    },
    totals: {
      verifiedAttendanceHours: Math.round(verifiedAttHours * 100) / 100,
      approvedAdjustmentHours: Math.round(approvedAdjHours * 100) / 100,
      totalCreditedHours: Math.round((verifiedAttHours + approvedAdjHours) * 100) / 100,
      approvedApplicationsCount: Number.parseInt(appCountRes.rows[0]?.count ?? '0', 10) || 0,
      verifiedAttendanceCount: attendanceSummary.filter((a) => a.verificationStatus === 'verified')
        .length,
      approvedAccomplishmentsCount: subRes.rows.length,
    },
    includedSubmissions: subRes.rows.map((r) => ({
      submissionId: Number(r.submission_id),
      versionNumber: Number(r.version_number),
      taskTitle: r.task_title,
      categoryName: r.category_name,
      activityDate: r.activity_date,
      accomplishmentDescription: r.accomplishment_description,
      evidenceCount: Number.parseInt(r.evidence_count ?? '0', 10) || 0,
      verifiedHours: Math.round((Number(r.verified_hours) || 0) * 100) / 100,
      reviewedAt: r.reviewed_at,
    })),
    attendanceSummary,
  };
}

export async function generateIndividualReportPdf(input: {
  studentId: number;
  templateId?: number;
  academicYearId?: number;
  dateFrom?: string;
  dateTo?: string;
  coordinatorUserId: number;
  coordinatorName: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RssReportRecord> {
  const preview = await getIndividualReportPreview({
    studentId: input.studentId,
    academicYearId: input.academicYearId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });

  if (preview.includedSubmissions.length === 0) {
    throw new AppError(
      400,
      'NO_APPROVED_SUBMISSIONS',
      'Individual RSS PDF generation requires at least one approved accomplishment submission matching the selected filters.',
    );
  }

  const templateRow = await resolveTemplateForGeneration(input.templateId);
  const templateConfig = await readTemplateConfigFile(templateRow.storage_path);
  const primarySubmissionId = preview.includedSubmissions[0]!.submissionId;

  const verRes = await query<{ max_ver: number }>(
    `SELECT COALESCE(MAX(version), 0)::int AS max_ver
     FROM rss_reports
     WHERE report_type = 'individual'
       AND accomplishment_submission_id IN (
         SELECT sub.id
         FROM accomplishment_submissions sub
         JOIN accomplishments acc ON acc.id = sub.accomplishment_id
         JOIN task_applications ta ON ta.id = acc.application_id
         WHERE ta.student_id = $1
       )`,
    [input.studentId],
  );
  const nextVersion = (Number(verRes.rows[0]?.max_ver ?? 0) || 0) + 1;
  const generatedAtIso = new Date().toISOString();

  const pdfBuffer = await buildIndividualReportPdfBuffer({
    collegeName: templateRow.college_name,
    templateName: templateRow.template_name,
    templateVersion: templateRow.template_version,
    config: templateConfig,
    version: nextVersion,
    generatedByName: input.coordinatorName,
    generatedAtIso,
    preview,
  });

  const savedFile = await saveGeneratedReportPdf({
    reportType: 'individual',
    referenceCode: `${preview.student.studentNumber}_v${nextVersion}`,
    buffer: pdfBuffer,
  });

  const reportId = await withTransaction(async (client) => {
    const stuUserRes = await client.query<{ user_id: number }>(
      `SELECT user_id FROM students WHERE id = $1 LIMIT 1`,
      [input.studentId],
    );
    const stuUserId = stuUserRes.rows[0]?.user_id ? Number(stuUserRes.rows[0].user_id) : null;

    const insRes = await client.query<{ id: number }>(
      `INSERT INTO rss_reports (
         college_id,
         template_id,
         report_type,
         accomplishment_submission_id,
         academic_year_id,
         version,
         file_path,
         file_hash,
         status,
         generated_by,
         generated_at
       )
       VALUES ($1, $2, 'individual', $3, $4, $5, $6, $7, 'generated', $8, $9::timestamptz)
       RETURNING id`,
      [
        templateRow.college_id,
        templateRow.id,
        primarySubmissionId,
        input.academicYearId ?? null,
        nextVersion,
        savedFile.storagePath,
        savedFile.fileHash,
        input.coordinatorUserId,
        generatedAtIso,
      ],
    );
    const id = Number(insRes.rows[0]?.id);

    for (const sub of preview.includedSubmissions) {
      await client.query(
        `INSERT INTO report_items (report_id, submission_id)
         VALUES ($1, $2)
         ON CONFLICT (report_id, submission_id) DO NOTHING`,
        [id, sub.submissionId],
      );
    }

    if (stuUserId) {
      await createNotification(
        {
          userId: stuUserId,
          title: 'Individual RSS Report Generated',
          message: `Official Individual RSS Report v${nextVersion} has been generated (${preview.totals.totalCreditedHours.toFixed(2)} credited hours) and is ready in My RSS Reports.`,
          notificationType: 'report_generated',
          relatedType: 'rss_reports',
          relatedId: id,
        },
        client,
      );
    }

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'individual_rss_report_generated',
        subjectType: 'rss_reports',
        subjectId: id,
        newValues: {
          student_id: input.studentId,
          template_id: Number(templateRow.id),
          version: nextVersion,
          included_submissions: preview.includedSubmissions.length,
          file_hash: savedFile.fileHash,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return id;
  });

  const rowRes = await query<ReportDbRow>(`${RSS_REPORTS_SELECT} WHERE rr.id = $1 LIMIT 1`, [reportId]);
  return mapReportRow(rowRes.rows[0]!);
}

export async function getSectionReportPreview(input: {
  sectionId: number;
  academicYearId?: number;
  dateFrom?: string;
  dateTo?: string;
  includeComparison?: boolean;
}): Promise<SectionReportPreview> {
  const sectionId = parsePositiveInt(input.sectionId, 'INVALID_SECTION_ID', 'section identifier');
  const dateFrom = input.dateFrom ? validateIsoDateString(input.dateFrom, 'Date from') : null;
  const dateTo = input.dateTo ? validateIsoDateString(input.dateTo, 'Date to') : null;

  if (dateFrom && dateTo && dateTo < dateFrom) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'End date cannot precede start date.');
  }

  const secRes = await query<{
    id: number;
    name: string;
    program_code: string;
    program_name: string;
    year_level_name: string;
    college_id: number;
    college_name: string;
  }>(
    `SELECT
       sec.id,
       sec.name,
       p.code AS program_code,
       p.name AS program_name,
       yl.name AS year_level_name,
       c.id AS college_id,
       c.name AS college_name
     FROM sections sec
     JOIN programs p ON p.id = sec.program_id
     JOIN colleges c ON c.id = p.college_id
     JOIN year_levels yl ON yl.id = sec.year_level_id
     WHERE sec.id = $1
     LIMIT 1`,
    [sectionId],
  );
  const sec = secRes.rows[0];
  if (!sec) {
    throw new AppError(404, 'SECTION_NOT_FOUND', 'Section record not found.');
  }

  let effectiveStart = dateFrom;
  let effectiveEnd = dateTo;
  let ayRecord: { id: number; name: string } | null = null;

  if (input.academicYearId !== undefined) {
    const ayId = parsePositiveInt(
      input.academicYearId,
      'INVALID_ACADEMIC_YEAR_ID',
      'academic year identifier',
    );
    const ayRes = await query<{ id: number; name: string; start_date: string; end_date: string }>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date
       FROM academic_years WHERE id = $1 LIMIT 1`,
      [ayId],
    );
    const ay = ayRes.rows[0];
    if (!ay) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year record not found.');
    }
    ayRecord = { id: Number(ay.id), name: ay.name };
    effectiveStart = effectiveStart ?? ay.start_date;
    effectiveEnd = effectiveEnd ?? ay.end_date;
  }

  const studentScopeSql =
    ayRecord !== null
      ? `ssh.section_id = $1 AND ssh.academic_year_id = $2`
      : `ssh.section_id = $1 AND ssh.is_current = TRUE`;
  const scopeParams: unknown[] = ayRecord !== null ? [sectionId, ayRecord.id] : [sectionId];

  const attScopeParams: unknown[] = [...scopeParams];
  const attDateFilters: string[] = [];
  if (effectiveStart) {
    attScopeParams.push(effectiveStart);
    attDateFilters.push(`AND att.attendance_date >= $${attScopeParams.length}::date`);
  }
  if (effectiveEnd) {
    attScopeParams.push(effectiveEnd);
    attDateFilters.push(`AND att.attendance_date <= $${attScopeParams.length}::date`);
  }

  const subScopeParams: unknown[] = [...scopeParams];
  const subDateFilters: string[] = [];
  if (effectiveStart) {
    subScopeParams.push(effectiveStart);
    subDateFilters.push(`AND sub.activity_date >= $${subScopeParams.length}::date`);
  }
  if (effectiveEnd) {
    subScopeParams.push(effectiveEnd);
    subDateFilters.push(`AND sub.activity_date <= $${subScopeParams.length}::date`);
  }

  const [enrolledRes, appRes, attRes, adjRes, subRes] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(DISTINCT ssh.student_id)::text AS count
       FROM student_section_history ssh
       JOIN students s ON s.id = ssh.student_id
       WHERE ${studentScopeSql} AND s.registration_status = 'approved'`,
      scopeParams,
    ),
    query<{ total: string; approved: string; pending: string }>(
      `SELECT
         COUNT(DISTINCT ta.id)::text AS total,
         COUNT(DISTINCT ta.id) FILTER (WHERE ta.status = 'approved')::text AS approved,
         COUNT(DISTINCT ta.id) FILTER (WHERE ta.status = 'pending')::text AS pending
       FROM task_applications ta
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id
       WHERE ${studentScopeSql}`,
      scopeParams,
    ),
    query<{ entries: string; hours: string }>(
      `SELECT
         COUNT(DISTINCT att.id)::text AS entries,
         COALESCE(SUM(att.verified_hours), 0)::text AS hours
       FROM attendance att
       JOIN task_applications ta ON ta.id = att.application_id
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id
       WHERE ${studentScopeSql}
         AND att.verification_status = 'verified'
         ${attDateFilters.join('\n         ')}`,
      attScopeParams,
    ),
    query<{ hours: string }>(
      `SELECT COALESCE(SUM(adj.adjustment_hours), 0)::text AS hours
       FROM service_hour_adjustments adj
       JOIN task_applications ta ON ta.id = adj.application_id
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id
       WHERE ${studentScopeSql}
         AND adj.status = 'approved'`,
      scopeParams,
    ),
    query<{
      submission_id: number;
      student_number: string;
      student_name: string;
      task_title: string;
      version_number: number;
      activity_date: string;
      verified_hours: string;
    }>(
      `SELECT DISTINCT ON (sub.id)
         sub.id AS submission_id,
         s.student_number,
         u.name AS student_name,
         t.title AS task_title,
         sub.version_number,
         sub.activity_date::text AS activity_date,
         (
           COALESCE((
             SELECT SUM(att.verified_hours)
             FROM attendance att
             WHERE att.application_id = ta.id AND att.verification_status = 'verified'
           ), 0)
           + COALESCE((
             SELECT SUM(adj.adjustment_hours)
             FROM service_hour_adjustments adj
             WHERE adj.application_id = ta.id AND adj.status = 'approved'
           ), 0)
         )::text AS verified_hours
       FROM accomplishment_submissions sub
       JOIN accomplishments acc ON acc.id = sub.accomplishment_id
       JOIN task_applications ta ON ta.id = acc.application_id
       JOIN tasks t ON t.id = ta.task_id
       JOIN students s ON s.id = ta.student_id
       JOIN users u ON u.id = s.user_id
       JOIN student_section_history ssh ON ssh.student_id = s.id
       WHERE ${studentScopeSql}
         AND sub.status = 'approved'
         ${subDateFilters.join('\n         ')}
       ORDER BY sub.id DESC`,
      subScopeParams,
    ),
  ]);

  const verifiedAttHours = Number(attRes.rows[0]?.hours ?? '0') || 0;
  const approvedAdjHours = Number(adjRes.rows[0]?.hours ?? '0') || 0;

  let sectionComparison: SectionReportPreview['sectionComparison'] = [];
  if (input.includeComparison) {
    const compRes = await query<{
      section_id: number;
      section_label: string;
      enrolled_count: string;
      approved_apps: string;
      verified_att_hours: string;
      approved_adj_hours: string;
      approved_acc: string;
    }>(
      `SELECT
         s2.id AS section_id,
         CONCAT_WS(' ', p2.code, yl2.name, s2.name) AS section_label,
         (
           SELECT COUNT(DISTINCT ssh2.student_id)::text
           FROM student_section_history ssh2
           WHERE ssh2.section_id = s2.id AND ssh2.is_current = TRUE
         ) AS enrolled_count,
         (
           SELECT COUNT(DISTINCT ta2.id)::text
           FROM task_applications ta2
           JOIN student_section_history ssh2 ON ssh2.student_id = ta2.student_id AND ssh2.is_current = TRUE
           WHERE ssh2.section_id = s2.id AND ta2.status = 'approved'
         ) AS approved_apps,
         COALESCE((
           SELECT SUM(att2.verified_hours)
           FROM attendance att2
           JOIN task_applications ta2 ON ta2.id = att2.application_id
           JOIN student_section_history ssh2 ON ssh2.student_id = ta2.student_id AND ssh2.is_current = TRUE
           WHERE ssh2.section_id = s2.id AND att2.verification_status = 'verified'
         ), 0)::text AS verified_att_hours,
         COALESCE((
           SELECT SUM(adj2.adjustment_hours)
           FROM service_hour_adjustments adj2
           JOIN task_applications ta2 ON ta2.id = adj2.application_id
           JOIN student_section_history ssh2 ON ssh2.student_id = ta2.student_id AND ssh2.is_current = TRUE
           WHERE ssh2.section_id = s2.id AND adj2.status = 'approved'
         ), 0)::text AS approved_adj_hours,
         (
           SELECT COUNT(DISTINCT sub2.id)::text
           FROM accomplishment_submissions sub2
           JOIN accomplishments acc2 ON acc2.id = sub2.accomplishment_id
           JOIN task_applications ta2 ON ta2.id = acc2.application_id
           JOIN student_section_history ssh2 ON ssh2.student_id = ta2.student_id AND ssh2.is_current = TRUE
           WHERE ssh2.section_id = s2.id AND sub2.status = 'approved'
         ) AS approved_acc
       FROM sections s2
       JOIN programs p2 ON p2.id = s2.program_id
       JOIN year_levels yl2 ON yl2.id = s2.year_level_id
       WHERE p2.college_id = $1 AND s2.is_active = TRUE
       ORDER BY section_label ASC`,
      [sec.college_id],
    );
    sectionComparison = compRes.rows.map((c) => {
      const h = (Number(c.verified_att_hours) || 0) + (Number(c.approved_adj_hours) || 0);
      return {
        sectionId: Number(c.section_id),
        sectionLabel: c.section_label,
        enrolledStudentCount: Number.parseInt(c.enrolled_count ?? '0', 10) || 0,
        approvedParticipations: Number.parseInt(c.approved_apps ?? '0', 10) || 0,
        totalCreditedHours: Math.round(h * 100) / 100,
        approvedAccomplishmentsCount: Number.parseInt(c.approved_acc ?? '0', 10) || 0,
      };
    });
  }

  return {
    section: {
      sectionId: Number(sec.id),
      sectionLabel: `${sec.program_code} ${sec.year_level_name} ${sec.name}`,
      programCode: sec.program_code,
      programName: sec.program_name,
      yearLevelName: sec.year_level_name,
      collegeName: sec.college_name,
    },
    academicYear: ayRecord,
    metrics: {
      enrolledStudentCount: Number.parseInt(enrolledRes.rows[0]?.count ?? '0', 10) || 0,
      totalApplications: Number.parseInt(appRes.rows[0]?.total ?? '0', 10) || 0,
      approvedApplications: Number.parseInt(appRes.rows[0]?.approved ?? '0', 10) || 0,
      pendingApplications: Number.parseInt(appRes.rows[0]?.pending ?? '0', 10) || 0,
      verifiedAttendanceEntries: Number.parseInt(attRes.rows[0]?.entries ?? '0', 10) || 0,
      verifiedServiceHours: Math.round(verifiedAttHours * 100) / 100,
      approvedAdjustmentsHours: Math.round(approvedAdjHours * 100) / 100,
      totalCreditedHours: Math.round((verifiedAttHours + approvedAdjHours) * 100) / 100,
      approvedAccomplishmentsCount: subRes.rows.length,
    },
    totals: {
      enrolledStudentCount: Number.parseInt(enrolledRes.rows[0]?.count ?? '0', 10) || 0,
      totalApplications: Number.parseInt(appRes.rows[0]?.total ?? '0', 10) || 0,
      approvedApplications: Number.parseInt(appRes.rows[0]?.approved ?? '0', 10) || 0,
      pendingApplications: Number.parseInt(appRes.rows[0]?.pending ?? '0', 10) || 0,
      verifiedAttendanceEntries: Number.parseInt(attRes.rows[0]?.entries ?? '0', 10) || 0,
      verifiedServiceHours: Math.round(verifiedAttHours * 100) / 100,
      approvedAdjustmentsHours: Math.round(approvedAdjHours * 100) / 100,
      totalCreditedHours: Math.round((verifiedAttHours + approvedAdjHours) * 100) / 100,
      approvedAccomplishmentsCount: subRes.rows.length,
    },
    includedSubmissions: subRes.rows.map((r) => ({
      submissionId: Number(r.submission_id),
      studentNumber: r.student_number,
      studentName: r.student_name,
      taskTitle: r.task_title,
      versionNumber: Number(r.version_number),
      activityDate: r.activity_date,
      verifiedHours: Math.round((Number(r.verified_hours) || 0) * 100) / 100,
    })),
    sectionComparison,
  };
}

export async function generateSectionReportPdf(input: {
  sectionId: number;
  academicYearId?: number;
  templateId?: number;
  dateFrom?: string;
  dateTo?: string;
  coordinatorUserId: number;
  coordinatorName: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RssReportRecord> {
  const preview = await getSectionReportPreview({
    sectionId: input.sectionId,
    academicYearId: input.academicYearId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    includeComparison: true,
  });

  const templateRow = await resolveTemplateForGeneration(input.templateId);
  const templateConfig = await readTemplateConfigFile(templateRow.storage_path);

  const verRes = await query<{ max_ver: number }>(
    `SELECT COALESCE(MAX(version), 0)::int AS max_ver
     FROM rss_reports
     WHERE report_type = 'section'
       AND section_id = $1
       AND ($2::bigint IS NULL OR academic_year_id = $2::bigint)`,
    [input.sectionId, input.academicYearId ?? null],
  );
  const nextVersion = (Number(verRes.rows[0]?.max_ver ?? 0) || 0) + 1;
  const generatedAtIso = new Date().toISOString();

  const pdfBuffer = await buildSectionReportPdfBuffer({
    collegeName: templateRow.college_name,
    templateName: templateRow.template_name,
    templateVersion: templateRow.template_version,
    config: templateConfig,
    version: nextVersion,
    generatedByName: input.coordinatorName,
    generatedAtIso,
    preview,
  });

  const savedFile = await saveGeneratedReportPdf({
    reportType: 'section',
    referenceCode: `section_${input.sectionId}_v${nextVersion}`,
    buffer: pdfBuffer,
  });

  const reportId = await withTransaction(async (client) => {
    const insRes = await client.query<{ id: number }>(
      `INSERT INTO rss_reports (
         college_id,
         template_id,
         report_type,
         section_id,
         academic_year_id,
         version,
         file_path,
         file_hash,
         status,
         generated_by,
         generated_at
       )
       VALUES ($1, $2, 'section', $3, $4, $5, $6, $7, 'generated', $8, $9::timestamptz)
       RETURNING id`,
      [
        templateRow.college_id,
        templateRow.id,
        input.sectionId,
        input.academicYearId ?? null,
        nextVersion,
        savedFile.storagePath,
        savedFile.fileHash,
        input.coordinatorUserId,
        generatedAtIso,
      ],
    );
    const id = Number(insRes.rows[0]?.id);

    for (const sub of preview.includedSubmissions) {
      await client.query(
        `INSERT INTO report_items (report_id, submission_id)
         VALUES ($1, $2)
         ON CONFLICT (report_id, submission_id) DO NOTHING`,
        [id, sub.submissionId],
      );
    }

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'section_rss_report_generated',
        subjectType: 'rss_reports',
        subjectId: id,
        newValues: {
          section_id: input.sectionId,
          academic_year_id: input.academicYearId ?? null,
          template_id: Number(templateRow.id),
          version: nextVersion,
          included_submissions: preview.includedSubmissions.length,
          file_hash: savedFile.fileHash,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return id;
  });

  const rowRes = await query<ReportDbRow>(`${RSS_REPORTS_SELECT} WHERE rr.id = $1 LIMIT 1`, [reportId]);
  return mapReportRow(rowRes.rows[0]!);
}

export async function updateRssReportStatus(input: {
  reportId: number;
  status: ReportStatus;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RssReportRecord> {
  const reportId = parsePositiveInt(input.reportId, 'INVALID_REPORT_ID', 'report identifier');
  if (input.status !== 'generated' && input.status !== 'approved' && input.status !== 'archived') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Report status must be generated, approved, or archived.');
  }

  await withTransaction(async (client) => {
    const existingRes = await client.query<{ id: number; status: ReportStatus }>(
      `SELECT id, status FROM rss_reports WHERE id = $1 FOR UPDATE`,
      [reportId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'REPORT_NOT_FOUND', 'RSS report record not found.');
    }

    await client.query(`UPDATE rss_reports SET status = $1 WHERE id = $2`, [input.status, reportId]);

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: 'rss_report_status_updated',
        subjectType: 'rss_reports',
        subjectId: reportId,
        oldValues: { status: existing.status },
        newValues: { status: input.status },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );
  });

  const rowRes = await query<ReportDbRow>(`${RSS_REPORTS_SELECT} WHERE rr.id = $1 LIMIT 1`, [reportId]);
  return mapReportRow(rowRes.rows[0]!);
}

export async function getAuthorizedReportFile(input: {
  reportId: number;
  isCoordinator: boolean;
  studentId: number | null;
  sectionRepAssignedSectionId: number | null;
}): Promise<{ buffer: Buffer; filename: string }> {
  const reportId = parsePositiveInt(input.reportId, 'INVALID_REPORT_ID', 'report identifier');

  const res = await query<{
    id: number;
    report_type: ReportType;
    file_path: string;
    version: number;
    section_id: number | null;
    owner_student_id: number | null;
    student_number: string | null;
  }>(
    `SELECT
       rr.id,
       rr.report_type,
       rr.file_path,
       rr.version,
       rr.section_id,
       ta.student_id AS owner_student_id,
       s.student_number
     FROM rss_reports rr
     LEFT JOIN accomplishment_submissions sub ON sub.id = rr.accomplishment_submission_id
     LEFT JOIN accomplishments acc ON acc.id = sub.accomplishment_id
     LEFT JOIN task_applications ta ON ta.id = acc.application_id
     LEFT JOIN students s ON s.id = ta.student_id
     WHERE rr.id = $1
     LIMIT 1`,
    [reportId],
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError(404, 'REPORT_NOT_FOUND', 'RSS report record not found.');
  }

  if (!input.isCoordinator) {
    if (row.report_type === 'individual') {
      if (!input.studentId || Number(row.owner_student_id) !== input.studentId) {
        throw new AppError(403, 'FORBIDDEN', 'You can only download your own individual RSS reports.');
      }
    } else if (row.report_type === 'section') {
      if (
        !input.sectionRepAssignedSectionId ||
        Number(row.section_id) !== input.sectionRepAssignedSectionId
      ) {
        throw new AppError(403, 'FORBIDDEN', 'You do not have permission to download this section report.');
      }
    }
  }

  const buffer = await readStoredFileBuffer(row.file_path);
  const label =
    row.report_type === 'individual'
      ? `CT-RSS-Individual-${row.student_number ?? row.id}-v${row.version}.pdf`
      : `CT-RSS-Section-${row.section_id ?? row.id}-v${row.version}.pdf`;
  return { buffer, filename: label };
}

async function resolveTemplateForGeneration(templateId?: number): Promise<{
  id: number;
  college_id: number;
  college_name: string;
  template_name: string;
  template_version: string;
  storage_path: string;
}> {
  if (templateId !== undefined) {
    const validId = parsePositiveInt(templateId, 'INVALID_TEMPLATE_ID', 'template identifier');
    const res = await query<{
      id: number;
      college_id: number;
      college_name: string;
      template_name: string;
      template_version: string;
      storage_path: string;
    }>(
      `SELECT rt.id, rt.college_id, c.name AS college_name, rt.template_name, rt.template_version, rt.storage_path
       FROM report_templates rt
       JOIN colleges c ON c.id = rt.college_id
       WHERE rt.id = $1
       LIMIT 1`,
      [validId],
    );
    if (!res.rows[0]) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Selected report template was not found.');
    }
    return res.rows[0];
  }

  const activeRes = await query<{
    id: number;
    college_id: number;
    college_name: string;
    template_name: string;
    template_version: string;
    storage_path: string;
  }>(
    `SELECT rt.id, rt.college_id, c.name AS college_name, rt.template_name, rt.template_version, rt.storage_path
     FROM report_templates rt
     JOIN colleges c ON c.id = rt.college_id
     WHERE rt.is_active = TRUE
     ORDER BY rt.updated_at DESC, rt.id DESC
     LIMIT 1`,
  );
  if (!activeRes.rows[0]) {
    throw new AppError(
      400,
      'NO_ACTIVE_REPORT_TEMPLATE',
      'No active report template exists. Create and activate a college report template in Report Templates first.',
    );
  }
  return activeRes.rows[0];
}
