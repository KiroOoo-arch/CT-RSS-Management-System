import { query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type {
  AccomplishmentDetailRecord,
  AccomplishmentRecord,
  AccomplishmentReviewRecord,
  AccomplishmentStatus,
  AccomplishmentSubmissionRecord,
  EvidenceImageCategory,
  EvidenceImageRecord,
} from '../types/api.ts';
import {
  deleteEvidenceFile,
  readStoredFileBuffer,
  removeEvidenceDirectoryIfEmpty,
  saveEvidenceImageBase64,
} from '../utils/fileStorage.ts';
import { validateIsoDateString } from './academicService.ts';
import { recordAuditLog } from './auditService.ts';
import { createNotification, notifyActiveCoordinators } from './notificationService.ts';

const VALID_IMAGE_CATEGORIES: ReadonlySet<EvidenceImageCategory> = new Set([
  'before',
  'during',
  'after',
  'other',
]);

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

function normalizeOptionalText(value: unknown, maxLen: number, label: string): string | null {
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

interface AccomplishmentDbRow {
  id: number;
  application_id: number;
  task_id: number;
  task_title: string;
  category_name: string;
  student_id: number;
  student_number: string;
  student_name: string;
  section_label: string | null;
  status: AccomplishmentStatus;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  coordinator_remarks: string | null;
  latest_version_number: string;
  submission_count: string;
  latest_activity_date: string | null;
  latest_submitted_at: string | null;
  evidence_count: string;
  verified_hours_for_task: string;
  created_at: string;
  updated_at: string;
}

function mapAccomplishmentRow(row: AccomplishmentDbRow): AccomplishmentRecord {
  return {
    id: Number(row.id),
    applicationId: Number(row.application_id),
    taskId: Number(row.task_id),
    taskTitle: row.task_title,
    categoryName: row.category_name,
    studentId: Number(row.student_id),
    studentNumber: row.student_number,
    studentName: row.student_name,
    sectionLabel: row.section_label,
    status: row.status,
    reviewedBy: row.reviewed_by !== null ? Number(row.reviewed_by) : null,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    coordinatorRemarks: row.coordinator_remarks,
    latestVersionNumber: Number.parseInt(row.latest_version_number ?? '0', 10) || 0,
    submissionCount: Number.parseInt(row.submission_count ?? '0', 10) || 0,
    latestActivityDate: row.latest_activity_date,
    latestSubmittedAt: row.latest_submitted_at,
    evidenceCount: Number.parseInt(row.evidence_count ?? '0', 10) || 0,
    verifiedHoursForTask: Math.round((Number(row.verified_hours_for_task) || 0) * 100) / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACCOMPLISHMENT_SELECT = `
  SELECT
    acc.id,
    acc.application_id,
    t.id AS task_id,
    t.title AS task_title,
    tc.name AS category_name,
    s.id AS student_id,
    s.student_number,
    u.name AS student_name,
    CONCAT_WS(' ', p.code, yl.name, sec.name) AS section_label,
    acc.status,
    acc.reviewed_by,
    rev_u.name AS reviewed_by_name,
    acc.reviewed_at::text AS reviewed_at,
    acc.coordinator_remarks,
    COALESCE((
      SELECT MAX(sub.version_number)
      FROM accomplishment_submissions sub
      WHERE sub.accomplishment_id = acc.id
    ), 0)::text AS latest_version_number,
    (
      SELECT COUNT(*)::text
      FROM accomplishment_submissions sub
      WHERE sub.accomplishment_id = acc.id
    ) AS submission_count,
    (
      SELECT sub.activity_date::text
      FROM accomplishment_submissions sub
      WHERE sub.accomplishment_id = acc.id
      ORDER BY sub.version_number DESC
      LIMIT 1
    ) AS latest_activity_date,
    (
      SELECT sub.submitted_at::text
      FROM accomplishment_submissions sub
      WHERE sub.accomplishment_id = acc.id
      ORDER BY sub.version_number DESC
      LIMIT 1
    ) AS latest_submitted_at,
    (
      SELECT COUNT(*)::text
      FROM evidence_images ev
      JOIN accomplishment_submissions sub ON sub.id = ev.submission_id
      WHERE sub.accomplishment_id = acc.id
    ) AS evidence_count,
    (
      COALESCE((
        SELECT SUM(att.verified_hours)
        FROM attendance att
        WHERE att.application_id = acc.application_id
          AND att.verification_status = 'verified'
      ), 0)
      + COALESCE((
        SELECT SUM(adj.adjustment_hours)
        FROM service_hour_adjustments adj
        WHERE adj.application_id = acc.application_id
          AND adj.status = 'approved'
      ), 0)
    )::text AS verified_hours_for_task,
    acc.created_at::text AS created_at,
    acc.updated_at::text AS updated_at
  FROM accomplishments acc
  JOIN task_applications ta ON ta.id = acc.application_id
  JOIN tasks t ON t.id = ta.task_id
  JOIN task_categories tc ON tc.id = t.category_id
  JOIN students s ON s.id = ta.student_id
  JOIN users u ON u.id = s.user_id
  LEFT JOIN users rev_u ON rev_u.id = acc.reviewed_by
  LEFT JOIN student_section_history ssh ON ssh.student_id = s.id AND ssh.is_current = TRUE
  LEFT JOIN sections sec ON sec.id = ssh.section_id
  LEFT JOIN programs p ON p.id = sec.program_id
  LEFT JOIN year_levels yl ON yl.id = sec.year_level_id
`;

export async function listAccomplishments(input: {
  studentId?: number;
  taskId?: number;
  status?: string;
  search?: string;
}): Promise<AccomplishmentRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.studentId !== undefined) {
    params.push(parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier'));
    conditions.push(`s.id = $${params.length}`);
  }
  if (input.taskId !== undefined) {
    params.push(parsePositiveInt(input.taskId, 'INVALID_TASK_ID', 'task identifier'));
    conditions.push(`t.id = $${params.length}`);
  }
  const status = input.status?.trim().toLowerCase();
  if (
    status &&
    status !== 'all' &&
    status !== 'draft' &&
    status !== 'submitted' &&
    status !== 'revision_required' &&
    status !== 'approved' &&
    status !== 'rejected'
  ) {
    throw new AppError(400, 'INVALID_ACCOMPLISHMENT_STATUS', 'Invalid accomplishment status filter.');
  }
  if (
    status === 'draft' ||
    status === 'submitted' ||
    status === 'revision_required' ||
    status === 'approved' ||
    status === 'rejected'
  ) {
    params.push(status);
    conditions.push(`acc.status = $${params.length}`);
  }
  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim()}%`);
    const ref = `$${params.length}`;
    conditions.push(
      `(u.name ILIKE ${ref} OR s.student_number ILIKE ${ref} OR t.title ILIKE ${ref} OR tc.name ILIKE ${ref})`,
    );
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query<AccomplishmentDbRow>(
    `${ACCOMPLISHMENT_SELECT}
     ${whereSql}
     ORDER BY CASE WHEN acc.status = 'submitted' THEN 0 WHEN acc.status = 'revision_required' THEN 1 ELSE 2 END,
              acc.updated_at DESC,
              acc.id DESC
     LIMIT 200`,
    params,
  );
  return res.rows.map(mapAccomplishmentRow);
}

export async function getAccomplishmentDetail(
  accomplishmentIdInput: number,
  studentIdScope?: number,
): Promise<AccomplishmentDetailRecord> {
  const accomplishmentId = parsePositiveInt(
    accomplishmentIdInput,
    'INVALID_ACCOMPLISHMENT_ID',
    'accomplishment identifier',
  );

  const accRes = await query<AccomplishmentDbRow>(
    `${ACCOMPLISHMENT_SELECT} WHERE acc.id = $1 LIMIT 1`,
    [accomplishmentId],
  );
  const accRow = accRes.rows[0];
  if (!accRow) {
    throw new AppError(404, 'ACCOMPLISHMENT_NOT_FOUND', 'Accomplishment record not found.');
  }
  if (studentIdScope !== undefined && Number(accRow.student_id) !== studentIdScope) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Students can only inspect their own accomplishment submissions.',
    );
  }

  const subRes = await query<{
    id: number;
    accomplishment_id: number;
    submitted_by: number;
    submitted_by_name: string;
    version_number: number;
    activity_date: string;
    accomplishment_description: string;
    student_remarks: string | null;
    status: 'submitted' | 'approved' | 'revision_required' | 'rejected';
    submitted_at: string | null;
    created_at: string;
  }>(
    `SELECT
       sub.id,
       sub.accomplishment_id,
       sub.submitted_by,
       u.name AS submitted_by_name,
       sub.version_number,
       sub.activity_date::text AS activity_date,
       sub.accomplishment_description,
       sub.student_remarks,
       sub.status,
       sub.submitted_at::text AS submitted_at,
       sub.created_at::text AS created_at
     FROM accomplishment_submissions sub
     JOIN users u ON u.id = sub.submitted_by
     WHERE sub.accomplishment_id = $1
     ORDER BY sub.version_number DESC`,
    [accomplishmentId],
  );

  const submissionIds = subRes.rows.map((s) => Number(s.id));
  const evidenceBySub = new Map<number, EvidenceImageRecord[]>();
  const reviewsBySub = new Map<number, AccomplishmentReviewRecord[]>();

  if (submissionIds.length > 0) {
    const [evRes, revRes] = await Promise.all([
      query<{
        id: number;
        submission_id: number;
        uploaded_by: number;
        original_filename: string;
        mime_type: string;
        file_size: string;
        image_category: EvidenceImageCategory;
        caption: string | null;
        display_order: number;
        created_at: string;
      }>(
        `SELECT
           id,
           submission_id,
           uploaded_by,
           original_filename,
           mime_type,
           file_size::text AS file_size,
           image_category,
           caption,
           display_order,
           created_at::text AS created_at
         FROM evidence_images
         WHERE submission_id = ANY($1::bigint[])
         ORDER BY display_order ASC, id ASC`,
        [submissionIds],
      ),
      query<{
        id: number;
        submission_id: number;
        reviewed_by: number;
        reviewed_by_name: string;
        decision: 'approved' | 'revision_required' | 'rejected';
        remarks: string | null;
        reviewed_at: string;
      }>(
        `SELECT
           rev.id,
           rev.submission_id,
           rev.reviewed_by,
           u.name AS reviewed_by_name,
           rev.decision,
           rev.remarks,
           rev.reviewed_at::text AS reviewed_at
         FROM accomplishment_reviews rev
         JOIN users u ON u.id = rev.reviewed_by
         WHERE rev.submission_id = ANY($1::bigint[])
         ORDER BY rev.reviewed_at DESC, rev.id DESC`,
        [submissionIds],
      ),
    ]);

    for (const ev of evRes.rows) {
      const subId = Number(ev.submission_id);
      const arr = evidenceBySub.get(subId) ?? [];
      arr.push({
        id: Number(ev.id),
        submissionId: subId,
        uploadedBy: Number(ev.uploaded_by),
        originalFilename: ev.original_filename,
        mimeType: ev.mime_type,
        fileSize: Number.parseInt(ev.file_size, 10) || 0,
        imageCategory: ev.image_category,
        caption: ev.caption,
        displayOrder: Number(ev.display_order),
        createdAt: ev.created_at,
        downloadUrl: `/api/v1/evidence/${Number(ev.id)}/file`,
      });
      evidenceBySub.set(subId, arr);
    }

    for (const rv of revRes.rows) {
      const subId = Number(rv.submission_id);
      const arr = reviewsBySub.get(subId) ?? [];
      arr.push({
        id: Number(rv.id),
        submissionId: subId,
        reviewedBy: Number(rv.reviewed_by),
        reviewedByName: rv.reviewed_by_name,
        decision: rv.decision,
        remarks: rv.remarks,
        reviewedAt: rv.reviewed_at,
      });
      reviewsBySub.set(subId, arr);
    }
  }

  const submissions: AccomplishmentSubmissionRecord[] = subRes.rows.map((s) => {
    const subId = Number(s.id);
    return {
      id: subId,
      accomplishmentId: Number(s.accomplishment_id),
      submittedBy: Number(s.submitted_by),
      submittedByName: s.submitted_by_name,
      versionNumber: Number(s.version_number),
      activityDate: s.activity_date,
      accomplishmentDescription: s.accomplishment_description,
      studentRemarks: s.student_remarks,
      status: s.status,
      submittedAt: s.submitted_at,
      createdAt: s.created_at,
      evidenceImages: evidenceBySub.get(subId) ?? [],
      reviews: reviewsBySub.get(subId) ?? [],
    };
  });

  return {
    ...mapAccomplishmentRow(accRow),
    submissions,
  };
}

export async function initializeStudentAccomplishmentDraft(input: {
  applicationId: number;
  studentId: number;
  actorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AccomplishmentDetailRecord> {
  const applicationId = parsePositiveInt(
    input.applicationId,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');

  const accomplishmentId = await withTransaction(async (client) => {
    const appRes = await client.query<{
      id: number;
      student_id: number;
      status: string;
    }>(
      `SELECT id, student_id, status FROM task_applications WHERE id = $1 FOR UPDATE`,
      [applicationId],
    );
    const appRow = appRes.rows[0];
    if (!appRow) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Task application record not found.');
    }
    if (Number(appRow.student_id) !== studentId) {
      throw new AppError(403, 'FORBIDDEN', 'You can only draft accomplishments for your own tasks.');
    }
    if (appRow.status !== 'approved') {
      throw new AppError(
        400,
        'APPLICATION_NOT_APPROVED',
        'Accomplishments can only be drafted or submitted for approved task participations.',
      );
    }

    const existingRes = await client.query<{ id: number }>(
      `SELECT id FROM accomplishments WHERE application_id = $1 LIMIT 1`,
      [applicationId],
    );
    if (existingRes.rows[0]) {
      return Number(existingRes.rows[0].id);
    }

    const insRes = await client.query<{ id: number }>(
      `INSERT INTO accomplishments (application_id, status)
       VALUES ($1, 'draft')
       RETURNING id`,
      [applicationId],
    );
    const accId = Number(insRes.rows[0]?.id);

    await recordAuditLog(
      {
        userId: input.actorUserId,
        action: 'accomplishment_draft_initialized',
        subjectType: 'accomplishments',
        subjectId: accId,
        newValues: { application_id: applicationId, status: 'draft' },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return accId;
  });

  return getAccomplishmentDetail(accomplishmentId, studentId);
}

export interface EvidenceUploadInput {
  originalFilename: string;
  mimeType: string;
  dataBase64: string;
  imageCategory: EvidenceImageCategory;
  caption?: string;
}

export async function cleanupWrittenEvidence(writtenPaths: string[]): Promise<void> {
  for (const writtenPath of writtenPaths) {
    try {
      await deleteEvidenceFile(writtenPath);
    } catch (cleanupErr) {
      console.warn('[ACCOMPLISHMENT_CLEANUP] Failed to remove evidence file after rollback:', cleanupErr, {
        storagePath: writtenPath,
      });
    }
  }
  if (writtenPaths.length > 0) {
    const relativeDir = writtenPaths[0].split('/').slice(0, -1).join('/');
    if (relativeDir) {
      try {
        await removeEvidenceDirectoryIfEmpty(relativeDir);
      } catch (cleanupErr) {
        console.warn('[ACCOMPLISHMENT_CLEANUP] Failed to remove evidence directory after rollback:', cleanupErr, {
          directory: relativeDir,
        });
      }
    }
  }
}

export async function submitStudentAccomplishmentVersion(input: {
  applicationId: number;
  studentId: number;
  actorUserId: number;
  studentName: string;
  studentNumber: string;
  activityDate: string;
  accomplishmentDescription: string;
  studentRemarks?: string;
  evidenceImages: EvidenceUploadInput[];
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AccomplishmentDetailRecord> {
  const applicationId = parsePositiveInt(
    input.applicationId,
    'INVALID_APPLICATION_ID',
    'application identifier',
  );
  const studentId = parsePositiveInt(input.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const activityDate = validateIsoDateString(input.activityDate, 'Activity date');
  const accomplishmentDescription = normalizeRequiredText(
    input.accomplishmentDescription,
    10,
    4000,
    'Accomplishment description',
  );
  const studentRemarks = normalizeOptionalText(input.studentRemarks, 1000, 'Student remarks');

  if (!Array.isArray(input.evidenceImages) || input.evidenceImages.length === 0) {
    throw new AppError(
      400,
      'EVIDENCE_REQUIRED',
      'Upload at least one categorized evidence photo (before, during, after, or other).',
    );
  }
  if (input.evidenceImages.length > 6) {
    throw new AppError(
      400,
      'TOO_MANY_IMAGES',
      'Maximum of 6 evidence photos may be attached per submission version.',
    );
  }

  for (const img of input.evidenceImages) {
    if (!VALID_IMAGE_CATEGORIES.has(img.imageCategory)) {
      throw new AppError(
        400,
        'INVALID_IMAGE_CATEGORY',
        'Image category must be before, during, after, or other.',
      );
    }
  }

  const writtenPaths: string[] = [];
  let accomplishmentId!: number;
  try {
    accomplishmentId = await withTransaction(async (client) => {
    const appRes = await client.query<{
      id: number;
      student_id: number;
      status: string;
      task_title: string;
      activity_start: string | null;
      activity_end: string | null;
    }>(
      `SELECT ta.id, ta.student_id, ta.status, t.title AS task_title,
              t.activity_start, t.activity_end
       FROM task_applications ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.id = $1
       FOR UPDATE OF ta`,
      [applicationId],
    );
    const appRow = appRes.rows[0];
    if (!appRow) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Task application record not found.');
    }
    if (Number(appRow.student_id) !== studentId) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'You can only submit accomplishments for your own task applications.',
      );
    }
    if (appRow.status !== 'approved') {
      throw new AppError(
        400,
        'APPLICATION_NOT_APPROVED',
        'Accomplishments can only be submitted for approved task participations.',
      );
    }

    // Activity-date validation against task activity period and future-date restriction.
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (activityDate > todayUtc) {
      throw new AppError(
        400,
        'INVALID_ACTIVITY_DATE',
        'Activity date cannot be in the future.',
      );
    }

    if (appRow.activity_start) {
      const activityStartUtc = new Date(appRow.activity_start).toISOString().slice(0, 10);
      if (activityDate < activityStartUtc) {
        throw new AppError(
          400,
          'INVALID_ACTIVITY_DATE',
          `Activity date cannot be before the task activity start date (${activityStartUtc}).`,
        );
      }
    }

    if (appRow.activity_end) {
      const activityEndUtc = new Date(appRow.activity_end).toISOString().slice(0, 10);
      if (activityDate > activityEndUtc) {
        throw new AppError(
          400,
          'INVALID_ACTIVITY_DATE',
          `Activity date cannot be after the task activity end date (${activityEndUtc}).`,
        );
      }
    }

    let accRowRes = await client.query<{
      id: number;
      status: AccomplishmentStatus;
    }>(
      `SELECT id, status FROM accomplishments WHERE application_id = $1 FOR UPDATE`,
      [applicationId],
    );

    let accId: number;
    let prevStatus: AccomplishmentStatus | null = null;
    if (accRowRes.rows[0]) {
      accId = Number(accRowRes.rows[0].id);
      prevStatus = accRowRes.rows[0].status;
      if (prevStatus === 'submitted' || prevStatus === 'approved' || prevStatus === 'rejected') {
        throw new AppError(
          409,
          'SUBMISSION_LOCKED',
          `Cannot submit a new version while accomplishment status is "${prevStatus}".`,
        );
      }
    } else {
      const insAcc = await client.query<{ id: number }>(
        `INSERT INTO accomplishments (application_id, status)
         VALUES ($1, 'draft')
         RETURNING id`,
        [applicationId],
      );
      accId = Number(insAcc.rows[0]?.id);
      prevStatus = 'draft';
    }

    const verRes = await client.query<{ max_ver: number }>(
      `SELECT COALESCE(MAX(version_number), 0)::int AS max_ver
       FROM accomplishment_submissions
       WHERE accomplishment_id = $1`,
      [accId],
    );
    const nextVersion = (Number(verRes.rows[0]?.max_ver ?? 0) || 0) + 1;

    const subIns = await client.query<{ id: number }>(
      `INSERT INTO accomplishment_submissions (
         accomplishment_id,
         submitted_by,
         version_number,
         activity_date,
         accomplishment_description,
         student_remarks,
         status,
         submitted_at
       )
       VALUES ($1, $2, $3, $4::date, $5, $6, 'submitted', NOW())
       RETURNING id`,
      [
        accId,
        input.actorUserId,
        nextVersion,
        activityDate,
        accomplishmentDescription,
        studentRemarks,
      ],
    );
    const submissionId = Number(subIns.rows[0]?.id);

    let orderIndex = 1;
    for (const img of input.evidenceImages) {
      const saved = await saveEvidenceImageBase64({
        submissionId,
        originalFilename: img.originalFilename,
        mimeType: img.mimeType,
        dataBase64: img.dataBase64,
      });
      writtenPaths.push(saved.storagePath);
      const caption = normalizeOptionalText(img.caption, 500, 'Image caption');
      await client.query(
        `INSERT INTO evidence_images (
           submission_id,
           uploaded_by,
           original_filename,
           storage_path,
           mime_type,
           file_size,
           image_category,
           caption,
           display_order
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          submissionId,
          input.actorUserId,
          saved.originalFilename,
          saved.storagePath,
          saved.mimeType,
          saved.fileSize,
          img.imageCategory,
          caption,
          orderIndex++,
        ],
      );
    }

    await client.query(
      `UPDATE accomplishments
       SET status = 'submitted',
           updated_at = NOW()
       WHERE id = $1`,
      [accId],
    );

    await notifyActiveCoordinators(
      {
        title:
          nextVersion > 1
            ? 'Revised Accomplishment Submitted'
            : 'New Accomplishment Submission',
        message: `${input.studentName} (${input.studentNumber}) submitted accomplishment v${nextVersion} for "${appRow.task_title}".`,
        notificationType: 'accomplishment_submitted',
        relatedType: 'accomplishment_submissions',
        relatedId: submissionId,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.actorUserId,
        action: nextVersion > 1 ? 'accomplishment_resubmitted' : 'accomplishment_submitted',
        subjectType: 'accomplishment_submissions',
        subjectId: submissionId,
        oldValues: { status: prevStatus },
        newValues: {
          accomplishment_id: accId,
          version_number: nextVersion,
          activity_date: activityDate,
          evidence_count: input.evidenceImages.length,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return accId;
  });
  } catch (err) {
    await cleanupWrittenEvidence(writtenPaths);
    throw err;
  }

  return getAccomplishmentDetail(accomplishmentId, studentId);
}

export async function reviewAccomplishmentSubmission(input: {
  submissionId: number;
  decision: 'approved' | 'revision_required' | 'rejected';
  remarks?: string;
  coordinatorUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AccomplishmentDetailRecord> {
  const submissionId = parsePositiveInt(
    input.submissionId,
    'INVALID_SUBMISSION_ID',
    'submission identifier',
  );
  if (
    input.decision !== 'approved' &&
    input.decision !== 'revision_required' &&
    input.decision !== 'rejected'
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Decision must be approved, revision_required, or rejected.',
    );
  }
  const remarks = normalizeOptionalText(input.remarks, 1500, 'Coordinator remarks');
  if ((input.decision === 'revision_required' || input.decision === 'rejected') && !remarks) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Coordinator remarks are required when requesting revisions or rejecting a submission.',
    );
  }

  const accomplishmentId = await withTransaction(async (client) => {
    const subRes = await client.query<{
      id: number;
      accomplishment_id: number;
      version_number: number;
      status: string;
      acc_status: AccomplishmentStatus;
      student_user_id: number;
      task_title: string;
    }>(
      `SELECT
         sub.id,
         sub.accomplishment_id,
         sub.version_number,
         sub.status,
         acc.status AS acc_status,
         s.user_id AS student_user_id,
         t.title AS task_title
       FROM accomplishment_submissions sub
       JOIN accomplishments acc ON acc.id = sub.accomplishment_id
       JOIN task_applications ta ON ta.id = acc.application_id
       JOIN tasks t ON t.id = ta.task_id
       JOIN students s ON s.id = ta.student_id
       WHERE sub.id = $1
       FOR UPDATE OF sub, acc`,
      [submissionId],
    );
    const subRow = subRes.rows[0];
    if (!subRow) {
      throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Accomplishment submission not found.');
    }
    if (subRow.status !== 'submitted') {
      throw new AppError(
        409,
        'SUBMISSION_ALREADY_REVIEWED',
        `Submission v${subRow.version_number} has already been reviewed (${subRow.status}).`,
      );
    }

    await client.query(
      `UPDATE accomplishment_submissions
       SET status = $1
       WHERE id = $2`,
      [input.decision, submissionId],
    );

    await client.query(
      `INSERT INTO accomplishment_reviews (submission_id, reviewed_by, decision, remarks, reviewed_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [submissionId, input.coordinatorUserId, input.decision, remarks],
    );

    await client.query(
      `UPDATE accomplishments
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           coordinator_remarks = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [input.decision, input.coordinatorUserId, remarks, Number(subRow.accomplishment_id)],
    );

    await createNotification(
      {
        userId: Number(subRow.student_user_id),
        title:
          input.decision === 'approved'
            ? 'Accomplishment Submission Approved'
            : input.decision === 'revision_required'
              ? 'Accomplishment Revision Requested'
              : 'Accomplishment Submission Rejected',
        message:
          input.decision === 'approved'
            ? `Your accomplishment submission v${subRow.version_number} for "${subRow.task_title}" was approved.`
            : input.decision === 'revision_required'
              ? `Revision is requested on accomplishment v${subRow.version_number} for "${subRow.task_title}". Remarks: ${remarks}`
              : `Your accomplishment submission v${subRow.version_number} for "${subRow.task_title}" was rejected. Remarks: ${remarks}`,
        notificationType: `accomplishment_${input.decision}`,
        relatedType: 'accomplishment_submissions',
        relatedId: submissionId,
      },
      client,
    );

    await recordAuditLog(
      {
        userId: input.coordinatorUserId,
        action: `accomplishment_${input.decision}`,
        subjectType: 'accomplishment_submissions',
        subjectId: submissionId,
        oldValues: { status: subRow.status },
        newValues: {
          accomplishment_id: Number(subRow.accomplishment_id),
          version_number: Number(subRow.version_number),
          decision: input.decision,
          remarks,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return Number(subRow.accomplishment_id);
  });

  return getAccomplishmentDetail(accomplishmentId);
}

export async function getAuthorizedEvidenceFile(input: {
  imageId: number;
  isCoordinator: boolean;
  studentId: number | null;
}): Promise<{
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}> {
  const imageId = parsePositiveInt(input.imageId, 'INVALID_EVIDENCE_ID', 'evidence image identifier');

  const res = await query<{
    id: number;
    storage_path: string;
    mime_type: string;
    original_filename: string;
    owner_student_id: number;
  }>(
    `SELECT
       ev.id,
       ev.storage_path,
       ev.mime_type,
       ev.original_filename,
       ta.student_id AS owner_student_id
     FROM evidence_images ev
     JOIN accomplishment_submissions sub ON sub.id = ev.submission_id
     JOIN accomplishments acc ON acc.id = sub.accomplishment_id
     JOIN task_applications ta ON ta.id = acc.application_id
     WHERE ev.id = $1
     LIMIT 1`,
    [imageId],
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError(404, 'EVIDENCE_NOT_FOUND', 'Evidence image record not found.');
  }

  if (!input.isCoordinator) {
    if (!input.studentId || Number(row.owner_student_id) !== input.studentId) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'You do not have permission to view this private accomplishment evidence image.',
      );
    }
  }

  const buffer = await readStoredFileBuffer(row.storage_path);
  return {
    buffer,
    mimeType: row.mime_type,
    originalFilename: row.original_filename,
  };
}
