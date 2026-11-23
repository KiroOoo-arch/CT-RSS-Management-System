// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabasePool, query } from '../src/server/config/database.ts';
import { getIndividualReportPreview, getSectionReportPreview } from '../src/server/services/reportService.ts';

let yearLevelCounter = 0;

const tracked = {
  userIds: [] as number[],
  studentIds: [] as number[],
  sectionIds: [] as number[],
  academicYearIds: [] as number[],
  taskIds: [] as number[],
  applicationIds: [] as number[],
  attendanceIds: [] as number[],
  adjustmentIds: [] as number[],
  taskCategoryIds: [] as number[],
  programIds: [] as number[],
  collegeIds: [] as number[],
  yearLevelIds: [] as number[],
  taskSessionIds: [] as number[],
};

async function cleanup() {
  for (const id of tracked.adjustmentIds) {
    await query('DELETE FROM service_hour_adjustments WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.attendanceIds) {
    await query('DELETE FROM attendance WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.applicationIds) {
    await query('DELETE FROM task_applications WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.taskSessionIds) {
    await query('DELETE FROM task_sessions WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.taskIds) {
    await query('DELETE FROM tasks WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.studentIds) {
    await query('DELETE FROM student_section_history WHERE student_id = $1', [id]).catch(() => {});
    await query('DELETE FROM students WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.userIds) {
    await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.sectionIds) {
    await query('DELETE FROM sections WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.academicYearIds) {
    await query('DELETE FROM academic_years WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.taskCategoryIds) {
    await query('DELETE FROM task_categories WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.programIds) {
    await query('DELETE FROM programs WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.collegeIds) {
    await query('DELETE FROM colleges WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.yearLevelIds) {
    await query('DELETE FROM year_levels WHERE id = $1', [id]).catch(() => {});
  }
}

test.after(async () => {
  await cleanup();
  await closeDatabasePool();
});

// Shared fixture setup - creates all necessary records once
let fx: {
  sectionId: number;
  academicYearId: number;
  studentId: number;
  applicationId: number;
  inRangeAttendanceId: number;
  outRangeAttendanceId: number;
  inRangeAdjustmentId: number;
  outRangeAdjustmentId: number;
  userId: number;
};

async function setupFixtures() {
  const suffix = Date.now();

  // College
  const collegeRes = await query<{ id: number }>(
    `INSERT INTO colleges (name, code) VALUES ($1, $2) RETURNING id`,
    [`TC ${suffix}`, `C${suffix}`],
  );
  const collegeId = collegeRes.rows[0].id;
  tracked.collegeIds.push(collegeId);

  // Program
  const progRes = await query<{ id: number }>(
    `INSERT INTO programs (college_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [collegeId, `P${suffix}`, `TP ${suffix}`],
  );
  const programId = progRes.rows[0].id;
  tracked.programIds.push(programId);

  // Year level
  const ylRes = await query<{ id: number }>(
    `INSERT INTO year_levels (name, sort_order) VALUES ($1, $2) RETURNING id`,
    [`TY ${suffix}`, ++yearLevelCounter + 32700],
  );
  const yearLevelId = ylRes.rows[0].id;
  tracked.yearLevelIds.push(yearLevelId);

  // Section
  const secRes = await query<{ id: number }>(
    `INSERT INTO sections (program_id, year_level_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [programId, yearLevelId, `TS ${suffix}`],
  );
  const sectionId = secRes.rows[0].id;
  tracked.sectionIds.push(sectionId);

  // Academic year
  const ayRes = await query<{ id: number }>(
    `INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`TA ${suffix}`, '2025-01-01', '2025-12-31', false],
  );
  const academicYearId = ayRes.rows[0].id;
  tracked.academicYearIds.push(academicYearId);

  // User + student
  const userRes = await query<{ id: number }>(
    `INSERT INTO users (name, email, password, account_status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`TS ${suffix}`, `t${suffix}@e.com`, 'hash', 'active'],
  );
  const userId = userRes.rows[0].id;
  tracked.userIds.push(userId);

  const stuRes = await query<{ id: number }>(
    `INSERT INTO students (user_id, student_number, first_name, last_name, registration_status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, `T${suffix}`, 'Test', 'Student', 'approved'],
  );
  const studentId = stuRes.rows[0].id;
  tracked.studentIds.push(studentId);

  // Two section-history rows (transfer within same AY)
  await query(
    `INSERT INTO student_section_history (student_id, section_id, academic_year_id, enrolled_at, is_current) VALUES ($1, $2, $3, $4, $5)`,
    [studentId, sectionId, academicYearId, '2025-01-15', false],
  );
  await query(
    `INSERT INTO student_section_history (student_id, section_id, academic_year_id, enrolled_at, is_current) VALUES ($1, $2, $3, $4, $5)`,
    [studentId, sectionId, academicYearId, '2025-06-01', true],
  );

  // Task category
  const tcRes = await query<{ id: number }>(
    `INSERT INTO task_categories (name) VALUES ($1) RETURNING id`,
    [`TCat ${suffix}`],
  );
  const taskCategoryId = tcRes.rows[0].id;
  tracked.taskCategoryIds.push(taskCategoryId);

  // Task
  const taskRes = await query<{ id: number }>(
    `INSERT INTO tasks (title, description, category_id, college_id, created_by, status, required_hours) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [`TT ${suffix}`, 'Test task', taskCategoryId, collegeId, userId, 'published', 10],
  );
  const taskId = taskRes.rows[0].id;
  tracked.taskIds.push(taskId);

  // Task sessions (needed for attendance FK - one per attendance record)
  const ts1Res = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [taskId, 'Test Session 1', '2025-03-15', '09:00', '12:00', 'Test Location'],
  );
  const taskSessionId1 = ts1Res.rows[0].id;
  tracked.taskSessionIds.push(taskSessionId1);

  const ts2Res = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [taskId, 'Test Session 2', '2025-08-01', '09:00', '12:00', 'Test Location'],
  );
  const taskSessionId2 = ts2Res.rows[0].id;
  tracked.taskSessionIds.push(taskSessionId2);

  const ts3Res = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [taskId, 'Test Session 3', '2025-03-20', '09:00', '12:00', 'Test Location'],
  );
  const taskSessionId3 = ts3Res.rows[0].id;
  tracked.taskSessionIds.push(taskSessionId3);

  // Task application (approved)
  const appRes = await query<{ id: number }>(
    `INSERT INTO task_applications (student_id, task_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [studentId, taskId, 'approved'],
  );
  const applicationId = appRes.rows[0].id;
  tracked.applicationIds.push(applicationId);

  // In-range verified attendance (2025-03-15)
  const att1Res = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [applicationId, taskSessionId1, '2025-03-15', 5, 5, 'verified'],
  );
  tracked.attendanceIds.push(att1Res.rows[0].id);

  // Out-of-range verified attendance (2025-08-01)
  const att2Res = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [applicationId, taskSessionId2, '2025-08-01', 3, 3, 'verified'],
  );
  tracked.attendanceIds.push(att2Res.rows[0].id);

  // Pending attendance (should be excluded)
  const att3Res = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [applicationId, taskSessionId3, '2025-03-20', 2, 2, 'pending'],
  );
  tracked.attendanceIds.push(att3Res.rows[0].id);

  // In-range approved adjustment (2025-03-20)
  const adj1Res = await query<{ id: number }>(
    `INSERT INTO service_hour_adjustments (application_id, requested_by, adjustment_hours, reason, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [applicationId, userId, 1.5, 'In-range adj', 'approved', '2025-03-20T10:00:00Z'],
  );
  tracked.adjustmentIds.push(adj1Res.rows[0].id);

  // Out-of-range approved adjustment (2025-08-15)
  const adj2Res = await query<{ id: number }>(
    `INSERT INTO service_hour_adjustments (application_id, requested_by, adjustment_hours, reason, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [applicationId, userId, 2.0, 'Out-of-range adj', 'approved', '2025-08-15T10:00:00Z'],
  );
  tracked.adjustmentIds.push(adj2Res.rows[0].id);

  // Pending adjustment (should be excluded)
  const adj3Res = await query<{ id: number }>(
    `INSERT INTO service_hour_adjustments (application_id, requested_by, adjustment_hours, reason, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [applicationId, userId, 0.5, 'Pending adj', 'pending'],
  );
  tracked.adjustmentIds.push(adj3Res.rows[0].id);

  return { sectionId, academicYearId, studentId, applicationId };
}

test('credited-hours: test database guard active', async () => {
  const res = await query<{ db: string }>('SELECT current_database() AS db');
  assert.equal(res.rows[0]?.db, 'ct_rss_test');
});

test('credited-hours: section report does not double-count transferred student', async () => {
  const fx = await setupFixtures();

  const preview = await getSectionReportPreview({
    sectionId: fx.sectionId,
    academicYearId: fx.academicYearId,
  });

  // Student has 2 section-history rows but should be counted once.
  // In-range verified attendance: 5 (verified) + 3 (out-of-range, but section report has no date filter by default)
  // Actually, section report has no default date filter, so all verified attendance counts.
  // Verified: 5 + 3 = 8, Approved adjustments: 1.5 + 2.0 = 3.5
  // Total: 8 + 3.5 = 11.5 (if not double-counted)
  // If double-counted (2 section history rows): 23
  assert.equal(preview.metrics.totalCreditedHours, 11.5,
    `Expected 11.5 (no double-count) but got ${preview.metrics.totalCreditedHours}`);
});

test('credited-hours: date-filtered individual report excludes out-of-range attendance', async () => {
  const fx = await setupFixtures();

  const preview = await getIndividualReportPreview({
    studentId: fx.studentId,
    dateFrom: '2025-03-01',
    dateTo: '2025-03-31',
  });

  // In-range: 5 (att) + 1.5 (adj) = 6.5
  // Out-of-range attendance (3) and pending attendance (2) excluded
  // Out-of-range adjustment (2.0) and pending adjustment (0.5) excluded
  assert.equal(preview.totals.totalCreditedHours, 6.5,
    `Expected 6.5 but got ${preview.totals.totalCreditedHours}`);
});

test('credited-hours: date-filtered individual report excludes out-of-range adjustments', async () => {
  const fx = await setupFixtures();

  const preview = await getIndividualReportPreview({
    studentId: fx.studentId,
    dateFrom: '2025-03-01',
    dateTo: '2025-03-31',
  });

  // Approved adjustments in range: only 1.5
  assert.equal(preview.totals.approvedAdjustmentHours, 1.5,
    `Expected 1.5 but got ${preview.totals.approvedAdjustmentHours}`);
});

test('credited-hours: per-submission hours respect date filters', async () => {
  const fx = await setupFixtures();

  const preview = await getIndividualReportPreview({
    studentId: fx.studentId,
    dateFrom: '2025-03-01',
    dateTo: '2025-03-31',
  });

  // Per-submission hours should match total for in-range records
  if (preview.includedSubmissions && preview.includedSubmissions.length > 0) {
    const sub = preview.includedSubmissions[0];
    assert.equal(Number(sub.verifiedHours), 6.5,
      `Expected per-submission verifiedHours 6.5 but got ${sub.verifiedHours}`);
  }
});

test('credited-hours: pending/rejected excluded from totals', async () => {
  const fx = await setupFixtures();

  const preview = await getIndividualReportPreview({
    studentId: fx.studentId,
  });

  // All verified attendance: 5 + 3 = 8
  // Pending attendance (2) excluded from verified
  // All approved adjustments: 1.5 + 2.0 = 3.5
  // Pending adjustment (0.5) excluded
  // Total: 8 + 3.5 = 11.5
  assert.equal(preview.totals.verifiedAttendanceHours, 8,
    `Expected verifiedAttendanceHours 8 but got ${preview.totals.verifiedAttendanceHours}`);
  assert.equal(preview.totals.approvedAdjustmentHours, 3.5,
    `Expected approvedAdjustmentHours 3.5 but got ${preview.totals.approvedAdjustmentHours}`);
  assert.equal(preview.totals.totalCreditedHours, 11.5,
    `Expected totalCreditedHours 11.5 but got ${preview.totals.totalCreditedHours}`);
});

test('credited-hours: section report date-filters approved adjustments', async () => {
  const fx = await setupFixtures();

  // Date-filtered section report: only March 2025
  const preview = await getSectionReportPreview({
    sectionId: fx.sectionId,
    academicYearId: fx.academicYearId,
    dateFrom: '2025-03-01',
    dateTo: '2025-03-31',
  });

  // In-range approved adjustments: only 1.5
  // Out-of-range approved adjustment (2.0, approved_at 2025-08-15) excluded
  // Pending adjustment (0.5) excluded
  assert.equal(preview.metrics.approvedAdjustmentsHours, 1.5,
    `Expected approvedAdjustmentsHours 1.5 but got ${preview.metrics.approvedAdjustmentsHours}`);
});

test('credited-hours: section report per-submission hours respect date filters', async () => {
  const fx = await setupFixtures();

  const preview = await getSectionReportPreview({
    sectionId: fx.sectionId,
    academicYearId: fx.academicYearId,
    dateFrom: '2025-03-01',
    dateTo: '2025-03-31',
  });

  // Per-submission hours should reflect only in-range data
  // In-range: 5 (attendance) + 1.5 (adjustment) = 6.5
  if (preview.includedSubmissions && preview.includedSubmissions.length > 0) {
    const sub = preview.includedSubmissions[0];
    assert.equal(Number(sub.verifiedHours), 6.5,
      `Expected per-submission verifiedHours 6.5 but got ${sub.verifiedHours}`);
  }

  // Total credited hours should also be 6.5
  assert.equal(preview.metrics.totalCreditedHours, 6.5,
    `Expected totalCreditedHours 6.5 but got ${preview.metrics.totalCreditedHours}`);
});
