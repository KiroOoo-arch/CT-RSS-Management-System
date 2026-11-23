// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabasePool, query } from '../src/server/config/database.ts';
import { submitStudentAccomplishmentVersion } from '../src/server/services/accomplishmentService.ts';
import { AppError } from '../src/server/middleware/errorHandler.ts';

const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFf4NwAAAAASUVORK5CYII=';

const tracked = {
  userIds: [] as number[],
  studentIds: [] as number[],
  sectionIds: [] as number[],
  academicYearIds: [] as number[],
  taskIds: [] as number[],
  applicationIds: [] as number[],
  collegeIds: [] as number[],
  programIds: [] as number[],
  yearLevelIds: [] as number[],
  taskCategoryIds: [] as number[],
  accomplishmentIds: [] as number[],
  submissionIds: [] as number[],
};

async function cleanup() {
  for (const id of tracked.submissionIds) {
    await query('DELETE FROM evidence_images WHERE submission_id = $1', [id]).catch(() => {});
    await query('DELETE FROM accomplishment_submissions WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.accomplishmentIds) {
    await query('DELETE FROM accomplishments WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.applicationIds) {
    await query('DELETE FROM task_applications WHERE id = $1', [id]).catch(() => {});
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

// Helper to create a task with specific activity boundaries
async function createTaskWithBoundaries(opts: {
  activityStart: string | null;
  activityEnd: string | null;
  suffix: number;
}): Promise<{ taskId: number; applicationId: number; studentId: number; userId: number }> {
  const suffix = opts.suffix;

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
    [`TY ${suffix}`, 32000 + (suffix % 700)],
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

  // Task category
  const tcRes = await query<{ id: number }>(
    `INSERT INTO task_categories (name) VALUES ($1) RETURNING id`,
    [`TCat ${suffix}`],
  );
  const taskCategoryId = tcRes.rows[0].id;
  tracked.taskCategoryIds.push(taskCategoryId);

  // Task with activity boundaries
  const taskRes = await query<{ id: number }>(
    `INSERT INTO tasks (title, description, category_id, college_id, created_by, status, required_hours, activity_start, activity_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [`TT ${suffix}`, 'Test task', taskCategoryId, collegeId, userId, 'published', 10, opts.activityStart, opts.activityEnd],
  );
  const taskId = taskRes.rows[0].id;
  tracked.taskIds.push(taskId);

  // Task application (approved)
  const appRes = await query<{ id: number }>(
    `INSERT INTO task_applications (student_id, task_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [studentId, taskId, 'approved'],
  );
  const applicationId = appRes.rows[0].id;
  tracked.applicationIds.push(applicationId);

  return { taskId, applicationId, studentId, userId };
}

function makeEvidence() {
  return [{
    originalFilename: 'evidence.png',
    mimeType: 'image/png',
    dataBase64: VALID_PNG_BASE64,
    imageCategory: 'during' as const,
  }];
}

async function countSubmissions(applicationId: number): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM accomplishment_submissions sub JOIN accomplishments acc ON acc.id = sub.accomplishment_id WHERE acc.application_id = $1`,
    [applicationId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

test('accomplishment-date: test database guard active', async () => {
  const res = await query<{ db: string }>('SELECT current_database() AS db');
  assert.equal(res.rows[0]?.db, 'ct_rss_test');
});

// A. Valid dates
test('accomplishment-date: activity date equal to activity_start is accepted', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: '2026-09-10T00:00:00Z',
    activityEnd: '2026-09-12T23:59:59Z',
    suffix: Date.now() % 100000,
  });

  const result = await submitStudentAccomplishmentVersion({
    applicationId: fx.applicationId,
    studentId: fx.studentId,
    actorUserId: fx.userId,
    studentName: 'Test Student',
    studentNumber: 'T123',
    activityDate: '2026-09-10',
    accomplishmentDescription: 'Test accomplishment with boundary date.',
    evidenceImages: makeEvidence(),
  });

  assert.ok(result, 'Submission should succeed');
});

test('accomplishment-date: activity date equal to activity_end is accepted', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: '2026-09-10T00:00:00Z',
    activityEnd: '2026-09-12T23:59:59Z',
    suffix: (Date.now() + 1) % 100000,
  });

  const result = await submitStudentAccomplishmentVersion({
    applicationId: fx.applicationId,
    studentId: fx.studentId,
    actorUserId: fx.userId,
    studentName: 'Test Student',
    studentNumber: 'T123',
    activityDate: '2026-09-12',
    accomplishmentDescription: 'Test accomplishment with end boundary date.',
    evidenceImages: makeEvidence(),
  });

  assert.ok(result, 'Submission should succeed');
});

test('accomplishment-date: activity date today within boundaries is accepted', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fx = await createTaskWithBoundaries({
    activityStart: '2020-01-01T00:00:00Z',
    activityEnd: '2030-12-31T23:59:59Z',
    suffix: (Date.now() + 2) % 100000,
  });

  const result = await submitStudentAccomplishmentVersion({
    applicationId: fx.applicationId,
    studentId: fx.studentId,
    actorUserId: fx.userId,
    studentName: 'Test Student',
    studentNumber: 'T123',
    activityDate: today,
    accomplishmentDescription: 'Test accomplishment with today date.',
    evidenceImages: makeEvidence(),
  });

  assert.ok(result, 'Submission should succeed');
});

// B. Invalid boundaries
test('accomplishment-date: activity date before activity_start is rejected', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: '2026-09-10T00:00:00Z',
    activityEnd: '2026-09-12T23:59:59Z',
    suffix: (Date.now() + 3) % 100000,
  });

  const beforeCount = await countSubmissions(fx.applicationId);

  try {
    await submitStudentAccomplishmentVersion({
      applicationId: fx.applicationId,
      studentId: fx.studentId,
      actorUserId: fx.userId,
      studentName: 'Test Student',
      studentNumber: 'T123',
      activityDate: '2026-09-09',
      accomplishmentDescription: 'Test accomplishment before start.',
      evidenceImages: makeEvidence(),
    });
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.equal(err?.code, 'INVALID_ACTIVITY_DATE');
  }

  const afterCount = await countSubmissions(fx.applicationId);
  assert.equal(afterCount, beforeCount, 'No submission should be created');
});

test('accomplishment-date: activity date after activity_end is rejected', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: '2026-09-10T00:00:00Z',
    activityEnd: '2026-09-12T23:59:59Z',
    suffix: (Date.now() + 4) % 100000,
  });

  const beforeCount = await countSubmissions(fx.applicationId);

  try {
    await submitStudentAccomplishmentVersion({
      applicationId: fx.applicationId,
      studentId: fx.studentId,
      actorUserId: fx.userId,
      studentName: 'Test Student',
      studentNumber: 'T123',
      activityDate: '2026-09-13',
      accomplishmentDescription: 'Test accomplishment after end.',
      evidenceImages: makeEvidence(),
    });
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.equal(err?.code, 'INVALID_ACTIVITY_DATE');
  }

  const afterCount = await countSubmissions(fx.applicationId);
  assert.equal(afterCount, beforeCount, 'No submission should be created');
});

test('accomplishment-date: future date (tomorrow) is rejected', async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const fx = await createTaskWithBoundaries({
    activityStart: '2020-01-01T00:00:00Z',
    activityEnd: '2030-12-31T23:59:59Z',
    suffix: (Date.now() + 5) % 100000,
  });

  const beforeCount = await countSubmissions(fx.applicationId);

  try {
    await submitStudentAccomplishmentVersion({
      applicationId: fx.applicationId,
      studentId: fx.studentId,
      actorUserId: fx.userId,
      studentName: 'Test Student',
      studentNumber: 'T123',
      activityDate: tomorrowStr,
      accomplishmentDescription: 'Test accomplishment with future date.',
      evidenceImages: makeEvidence(),
    });
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.equal(err?.code, 'INVALID_ACTIVITY_DATE');
  }

  const afterCount = await countSubmissions(fx.applicationId);
  assert.equal(afterCount, beforeCount, 'No submission should be created');
});

// C. NULL boundaries
test('accomplishment-date: NULL activity_start permits valid date', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: null,
    activityEnd: '2030-12-31T23:59:59Z',
    suffix: (Date.now() + 6) % 100000,
  });

  const result = await submitStudentAccomplishmentVersion({
    applicationId: fx.applicationId,
    studentId: fx.studentId,
    actorUserId: fx.userId,
    studentName: 'Test Student',
    studentNumber: 'T123',
    activityDate: '2020-01-01',
    accomplishmentDescription: 'Test accomplishment with null start boundary.',
    evidenceImages: makeEvidence(),
  });

  assert.ok(result, 'Submission should succeed with null activity_start');
});

test('accomplishment-date: NULL activity_end permits valid date', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: '2020-01-01T00:00:00Z',
    activityEnd: null,
    suffix: (Date.now() + 7) % 100000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const result = await submitStudentAccomplishmentVersion({
    applicationId: fx.applicationId,
    studentId: fx.studentId,
    actorUserId: fx.userId,
    studentName: 'Test Student',
    studentNumber: 'T123',
    activityDate: today,
    accomplishmentDescription: 'Test accomplishment with null end boundary.',
    evidenceImages: makeEvidence(),
  });

  assert.ok(result, 'Submission should succeed with null activity_end');
});

// D. Invalid calendar date
test('accomplishment-date: invalid calendar date (2026-02-30) is rejected', async () => {
  const fx = await createTaskWithBoundaries({
    activityStart: '2020-01-01T00:00:00Z',
    activityEnd: '2030-12-31T23:59:59Z',
    suffix: (Date.now() + 8) % 100000,
  });

  const beforeCount = await countSubmissions(fx.applicationId);

  try {
    await submitStudentAccomplishmentVersion({
      applicationId: fx.applicationId,
      studentId: fx.studentId,
      actorUserId: fx.userId,
      studentName: 'Test Student',
      studentNumber: 'T123',
      activityDate: '2026-02-30',
      accomplishmentDescription: 'Test accomplishment with invalid date.',
      evidenceImages: makeEvidence(),
    });
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.equal(err?.code, 'VALIDATION_ERROR');
  }

  const afterCount = await countSubmissions(fx.applicationId);
  assert.equal(afterCount, beforeCount, 'No submission should be created');
});