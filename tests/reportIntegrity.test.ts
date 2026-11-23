// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabasePool, query } from '../src/server/config/database.ts';
import { getSectionReportPreview } from '../src/server/services/reportService.ts';
import { getServiceHoursSummary } from '../src/server/services/attendanceService.ts';

const tracked = {
  sectionIds: [] as number[],
  programIds: [] as number[],
  collegeIds: [] as number[],
  yearLevelIds: [] as number[],
  academicYearIds: [] as number[],
  studentIds: [] as number[],
  userIds: [] as number[],
};

async function cleanup() {
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

test('report-integrity: test database guard active', async () => {
  const res = await query<{ db: string }>('SELECT current_database() AS db');
  assert.equal(res.rows[0]?.db, 'ct_rss_test');
});

// A. Empty section report
test('report-integrity: empty section report returns zero counts and totals', async () => {
  const suffix = Date.now() % 100000;

  // Create minimal fixtures: college, program, year level, section
  const collegeRes = await query<{ id: number }>(
    `INSERT INTO colleges (name, code) VALUES ($1, $2) RETURNING id`,
    [`Empty College ${suffix}`, `EC${suffix}`],
  );
  const collegeId = collegeRes.rows[0].id;
  tracked.collegeIds.push(collegeId);

  const progRes = await query<{ id: number }>(
    `INSERT INTO programs (college_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [collegeId, `EP${suffix}`, `Empty Program ${suffix}`],
  );
  const programId = progRes.rows[0].id;
  tracked.programIds.push(programId);

  const ylRes = await query<{ id: number }>(
    `INSERT INTO year_levels (name, sort_order) VALUES ($1, $2) RETURNING id`,
    [`EY ${suffix}`, 32000 + (suffix % 700)],
  );
  const yearLevelId = ylRes.rows[0].id;
  tracked.yearLevelIds.push(yearLevelId);

  const secRes = await query<{ id: number }>(
    `INSERT INTO sections (program_id, year_level_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [programId, yearLevelId, `Empty Section ${suffix}`],
  );
  const sectionId = secRes.rows[0].id;
  tracked.sectionIds.push(sectionId);

  // Create academic year
  const ayRes = await query<{ id: number }>(
    `INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`Empty AY ${suffix}`, '2025-01-01', '2025-12-31', false],
  );
  const academicYearId = ayRes.rows[0].id;
  tracked.academicYearIds.push(academicYearId);

  // Generate section report preview for empty section
  const preview = await getSectionReportPreview({
    sectionId,
    academicYearId,
  });

  // Assert zero counts and totals
  assert.equal(preview.metrics.enrolledStudentCount, 0, 'enrolledStudentCount should be 0');
  assert.equal(preview.metrics.totalApplications, 0, 'totalApplications should be 0');
  assert.equal(preview.metrics.approvedApplications, 0, 'approvedApplications should be 0');
  assert.equal(preview.metrics.pendingApplications, 0, 'pendingApplications should be 0');
  assert.equal(preview.metrics.verifiedAttendanceEntries, 0, 'verifiedAttendanceEntries should be 0');
  assert.equal(preview.metrics.verifiedServiceHours, 0, 'verifiedServiceHours should be 0');
  assert.equal(preview.metrics.approvedAdjustmentsHours, 0, 'approvedAdjustmentsHours should be 0');
  assert.equal(preview.metrics.totalCreditedHours, 0, 'totalCreditedHours should be 0');
  assert.equal(preview.metrics.approvedAccomplishmentsCount, 0, 'approvedAccomplishmentsCount should be 0');
  assert.deepEqual(preview.includedSubmissions, [], 'includedSubmissions should be empty');
});

// D. Transferred student ledger behavior
test('report-integrity: transferred student ledger uses is_current (no duplicate hours)', async () => {
  const suffix = (Date.now() + 1) % 100000;

  // Create college, program, year level, section
  const collegeRes = await query<{ id: number }>(
    `INSERT INTO colleges (name, code) VALUES ($1, $2) RETURNING id`,
    [`Ledger College ${suffix}`, `LC${suffix}`],
  );
  const collegeId = collegeRes.rows[0].id;
  tracked.collegeIds.push(collegeId);

  const progRes = await query<{ id: number }>(
    `INSERT INTO programs (college_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [collegeId, `LP${suffix}`, `Ledger Program ${suffix}`],
  );
  const programId = progRes.rows[0].id;
  tracked.programIds.push(programId);

  const ylRes = await query<{ id: number }>(
    `INSERT INTO year_levels (name, sort_order) VALUES ($1, $2) RETURNING id`,
    [`LY ${suffix}`, 32000 + (suffix % 700) + 1],
  );
  const yearLevelId = ylRes.rows[0].id;
  tracked.yearLevelIds.push(yearLevelId);

  const secRes = await query<{ id: number }>(
    `INSERT INTO sections (program_id, year_level_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [programId, yearLevelId, `Ledger Section ${suffix}`],
  );
  const sectionId = secRes.rows[0].id;
  tracked.sectionIds.push(sectionId);

  // Academic year
  const ayRes = await query<{ id: number }>(
    `INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`Ledger AY ${suffix}`, '2025-01-01', '2025-12-31', false],
  );
  const academicYearId = ayRes.rows[0].id;
  tracked.academicYearIds.push(academicYearId);

  // User + student
  const userRes = await query<{ id: number }>(
    `INSERT INTO users (name, email, password, account_status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`Ledger Student ${suffix}`, `ls${suffix}@e.com`, 'hash', 'active'],
  );
  const userId = userRes.rows[0].id;
  tracked.userIds.push(userId);

  const stuRes = await query<{ id: number }>(
    `INSERT INTO students (user_id, student_number, first_name, last_name, registration_status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, `LS${suffix}`, 'Ledger', 'Student', 'approved'],
  );
  const studentId = stuRes.rows[0].id;
  tracked.studentIds.push(studentId);

  // Two section-history rows: old (not current) and new (current) in same AY
  await query(
    `INSERT INTO student_section_history (student_id, section_id, academic_year_id, enrolled_at, is_current) VALUES ($1, $2, $3, $4, $5)`,
    [studentId, sectionId, academicYearId, '2025-01-15', false],
  );
  await query(
    `INSERT INTO student_section_history (student_id, section_id, academic_year_id, enrolled_at, is_current) VALUES ($1, $2, $3, $4, $5)`,
    [studentId, sectionId, academicYearId, '2025-06-01', true],
  );

  // Query ledger for this student
  const summary = await getServiceHoursSummary({ studentId, academicYearId });

  // The ledger should return exactly one row for this student (is_current = TRUE)
  const students = summary.students ?? [];
  assert.equal(students.length, 1, 'Should return exactly one row per student');
  assert.equal(students[0].studentNumber, 'LS' + suffix, 'Should be the correct student');
});