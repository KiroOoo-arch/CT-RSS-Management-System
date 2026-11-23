// MUST be the first import: validates .env.test in this test file's own process
// before any server, database, dotenv, or test utility module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server.ts';
import { closeDatabasePool, query } from '../src/server/config/database.ts';
import { hashPassword } from '../src/server/utils/password.ts';
import { apiFetch, loginAs, type ApiClientSession } from './testUtils.ts';

type ApiResponse = Awaited<ReturnType<typeof apiFetch>>;

interface TrackedStudentFixture {
  studentNumber: string;
  email: string;
  studentId: number | null;
  userId: number | null;
}

function toPositiveSafeId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function trackId(list: number[], id: number): void {
  if (!list.includes(id)) {
    list.push(id);
  }
}

function readId(res: ApiResponse, label: string, ...keys: string[]): number {
  let node: unknown = res.json;
  for (const key of keys) {
    node = (node as Record<string, unknown> | null | undefined)?.[key];
  }
  const id = toPositiveSafeId(node);
  assert.ok(
    id !== null,
    `${label}: expected a positive identifier at ${keys.join('.')}; ` +
      `status=${res.status} body=${res.bodyText.slice(0, 500)}`,
  );
  return id;
}

function expectStatus(res: ApiResponse, status: number, label: string): void {
  assert.equal(
    res.status,
    status,
    `${label}: expected HTTP ${status}, received ${res.status}. ` +
      `Body: ${res.bodyText.slice(0, 500)}`,
  );
}

function expectError(
  res: ApiResponse,
  status: number,
  codes: string | string[],
  label: string,
): void {
  expectStatus(res, status, label);
  const accepted = Array.isArray(codes) ? codes : [codes];
  const actual = String(res.json?.error?.code ?? '');
  assert.ok(
    accepted.includes(actual),
    `${label}: expected error code ${accepted.join('|')}, received "${actual}". ` +
      `Body: ${res.bodyText.slice(0, 500)}`,
  );
}

/** Recover a fixture created by this run using its unique test identifiers. */
async function recoverStudentFixture(fixture: {
  studentNumber: string;
  email: string;
}): Promise<{ studentId: number; userId: number } | null> {
  const result = await query<{ student_id: number; user_id: number }>(
    `SELECT st.id AS student_id, st.user_id
     FROM students st
     JOIN users u ON u.id = st.user_id
     WHERE st.student_number = $1 AND LOWER(u.email) = LOWER($2)
     LIMIT 1`,
    [fixture.studentNumber, fixture.email],
  );
  const row = result.rows[0];
  const studentId = toPositiveSafeId(row?.student_id);
  const userId = toPositiveSafeId(row?.user_id);
  return studentId !== null && userId !== null ? { studentId, userId } : null;
}

test.after(async () => {
  // Report pool shutdown failures instead of swallowing them.
  try {
    await closeDatabasePool();
  } catch (error) {
    console.error('[CLEANUP_FAILURE] closeDatabasePool() failed:', error);
    throw error;
  }
});

test('Task Management, Targeting, Capacity, and Sessions Automated Test Suite', async () => {
  const app = await createApp({ enableVite: false });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  assert.ok(address && typeof address === 'object', 'Ephemeral test server failed to bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  // Declared here so the teardown diagnostics can reference it after the try block.
  const coordEmail = `coord_tm_${uniqueSuffix}@ctrss.test`;

  const tracked = {
    userIds: [] as number[],
    studentIds: [] as number[],
    taskCategoryIds: [] as number[],
    taskIds: [] as number[],
    sessionIds: [] as number[],
    applicationIds: [] as number[],
    attendanceIds: [] as number[],
    academicYearIds: [] as number[],
    programIds: [] as number[],
    sectionIds: [] as number[],
  };

  const studentFixtures: TrackedStudentFixture[] = [];
  let isolationVerified = false;
  let testError: unknown = null;
  let cleanupError: unknown = null;

  /**
   * Track a student fixture before any later assertion can throw.
   * Only positive safe integers enter the bigint cleanup arrays.
   */
  const registerStudentFixture = async (
    fixture: TrackedStudentFixture,
    responseJson: Record<string, any> | null,
  ): Promise<{ studentId: number; userId: number }> => {
    const studentId = toPositiveSafeId(responseJson?.data?.student?.studentId);
    const userId = toPositiveSafeId(responseJson?.data?.student?.userId);

    if (studentId !== null && userId !== null) {
      fixture.studentId = studentId;
      fixture.userId = userId;
      trackId(tracked.studentIds, studentId);
      trackId(tracked.userIds, userId);
      return { studentId, userId };
    }

    const recovered = await recoverStudentFixture(fixture);
    if (!recovered) {
      throw new Error(
        `[CLEANUP_FAILURE] Student 201 response lacked data.student.studentId/userId and ` +
          `the fixture could not be recovered: studentNumber=${fixture.studentNumber} ` +
          `email=${fixture.email}`,
      );
    }

    fixture.studentId = recovered.studentId;
    fixture.userId = recovered.userId;
    trackId(tracked.studentIds, recovered.studentId);
    trackId(tracked.userIds, recovered.userId);

    throw new Error(
      `Student creation returned 201 without the expected data.student.studentId/userId. ` +
        `Fixture recovered for cleanup: studentNumber=${fixture.studentNumber}`,
    );
  };

  try {
    // -------------------------------------------------------------------------
    // 0. Runtime isolation gate: verify the live connection before ANY fixture
    // -------------------------------------------------------------------------
    const identityRes = await query<{ current_database: string }>(
      'SELECT current_database() AS current_database',
    );
    const connectedDatabase = String(identityRes.rows[0]?.current_database ?? '');
    assert.equal(
      connectedDatabase,
      'ct_rss_test',
      'Test isolation check failed: refusing to create fixtures outside ct_rss_test.',
    );
    isolationVerified = true;

    // -------------------------------------------------------------------------
    // 1. Resolve seeded prerequisites and create test-only academic fixtures
    // -------------------------------------------------------------------------
    const seededCollegeRes = await query<{ id: number }>(
      `SELECT id FROM colleges WHERE code = 'CT' AND is_active = TRUE LIMIT 1`,
    );
    const collegeId = toPositiveSafeId(seededCollegeRes.rows[0]?.id);
    assert.ok(
      collegeId !== null,
      'Seeded active College of Technology (code CT) is required in ct_rss_test.',
    );

    const seededYearLevelRes = await query<{ id: number }>(
      `SELECT id FROM year_levels ORDER BY id LIMIT 1`,
    );
    const yearLevelId = toPositiveSafeId(seededYearLevelRes.rows[0]?.id);
    assert.ok(yearLevelId !== null, 'At least one seeded year level is required in ct_rss_test.');

    // Compact unique identifiers: academic_years.name is limited to 20 characters.
    const academicSuffix = `${Date.now().toString(36).slice(-8)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const academicYearName = `TM AY ${academicSuffix}`;
    const programCode = `TMP${academicSuffix.toUpperCase()}`;
    const programName = `TM Program ${uniqueSuffix}`;
    const sectionAName = `TM Section A ${uniqueSuffix}`;
    const sectionBName = `TM Section B ${uniqueSuffix}`;

    const academicYearInsert = await query<{ id: number }>(
      `INSERT INTO academic_years (name, start_date, end_date, is_current)
       VALUES ($1, $2::date, $3::date, FALSE)
       RETURNING id`,
      [academicYearName, '2026-06-01', '2027-05-31'],
    );
    const academicYearId = toPositiveSafeId(academicYearInsert.rows[0]?.id);
    assert.ok(academicYearId !== null, 'Test academic year must be created');
    trackId(tracked.academicYearIds, academicYearId);

    const programInsert = await query<{ id: number }>(
      `INSERT INTO programs (college_id, code, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [collegeId, programCode, programName],
    );
    const programId = toPositiveSafeId(programInsert.rows[0]?.id);
    assert.ok(programId !== null, 'Test program must be created');
    trackId(tracked.programIds, programId);

    const sectionAInsert = await query<{ id: number }>(
      `INSERT INTO sections (program_id, year_level_id, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [programId, yearLevelId, sectionAName],
    );
    const sectionA = toPositiveSafeId(sectionAInsert.rows[0]?.id);
    assert.ok(sectionA !== null, 'Test Section A must be created');
    trackId(tracked.sectionIds, sectionA);

    const sectionBInsert = await query<{ id: number }>(
      `INSERT INTO sections (program_id, year_level_id, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [programId, yearLevelId, sectionBName],
    );
    const sectionB = toPositiveSafeId(sectionBInsert.rows[0]?.id);
    assert.ok(sectionB !== null, 'Test Section B must be created');
    trackId(tracked.sectionIds, sectionB);

    // -------------------------------------------------------------------------
    // 2. Fixture: coordinator account
    // -------------------------------------------------------------------------
    const coordPassword = 'CoordPassword#2026!';
    const coordHash = await hashPassword(coordPassword);

    const coordInsertRes = await query<{ id: number }>(
      `INSERT INTO users (name, email, password, account_status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [`QA TM Coordinator ${uniqueSuffix}`, coordEmail, coordHash],
    );
    const coordUserId = toPositiveSafeId(coordInsertRes.rows[0]?.id);
    assert.ok(coordUserId !== null, 'Coordinator user must be created');
    trackId(tracked.userIds, coordUserId);

    await query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       SELECT $1, id, $1 FROM roles WHERE name = 'RSS Coordinator' LIMIT 1`,
      [coordUserId],
    );

    const coordLogin = await loginAs(baseUrl, coordEmail, coordPassword);
    assert.equal(coordLogin.status, 200, 'Coordinator login');
    assert.equal(coordLogin.json?.data?.user?.primaryRole, 'RSS Coordinator');
    const coordSession: ApiClientSession = coordLogin.session;
    assert.ok(coordSession.csrfToken.length > 10, 'Coordinator must receive a valid CSRF token');

    // -------------------------------------------------------------------------
    // 3. Fixtures: three students (stu1/stu2 share section A, stu3 is outside)
    // -------------------------------------------------------------------------
    const createStudent = async (input: {
      studentNumber: string;
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      sectionId: number | null;
      label: string;
    }): Promise<{ studentId: number; userId: number; session: ApiClientSession }> => {
      const body: Record<string, unknown> = {
        studentNumber: input.studentNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        password: input.password,
        accountStatus: 'active',
      };
      if (input.sectionId !== null) {
        body.sectionId = input.sectionId;
        body.academicYearId = academicYearId;
      }

      const res = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
        method: 'POST',
        session: coordSession,
        body,
      });
      expectStatus(res, 201, `${input.label} creation`);
      const fixture: TrackedStudentFixture = {
        studentNumber: input.studentNumber,
        email: input.email,
        studentId: null,
        userId: null,
      };
      studentFixtures.push(fixture);
      const ids = await registerStudentFixture(fixture, res.json);

      const login = await loginAs(baseUrl, input.email, input.password);
      assert.equal(login.status, 200, `${input.label} login`);
      return { ...ids, session: login.session };
    };

    const stuPassword = 'StudentPass#2026!';
    const stu1 = await createStudent({
      studentNumber: `TM-${uniqueSuffix}-1`,
      firstName: 'TargetFirst',
      lastName: 'TargetLast',
      email: `stu1_tm_${uniqueSuffix}@ctrss.test`,
      password: stuPassword,
      sectionId: sectionA,
      label: 'Student 1 (target section)',
    });
    const stu2 = await createStudent({
      studentNumber: `TM-${uniqueSuffix}-2`,
      firstName: 'SecondFirst',
      lastName: 'SecondLast',
      email: `stu2_tm_${uniqueSuffix}@ctrss.test`,
      password: stuPassword,
      sectionId: sectionA,
      label: 'Student 2 (target section)',
    });
    const stu3 = await createStudent({
      studentNumber: `TM-${uniqueSuffix}-3`,
      firstName: 'OutsideFirst',
      lastName: 'OutsideLast',
      email: `stu3_tm_${uniqueSuffix}@ctrss.test`,
      password: stuPassword,
      sectionId: sectionB,
      label: 'Student 3 (outside target)',
    });

    // -------------------------------------------------------------------------
    // 4. Category scenarios
    // -------------------------------------------------------------------------
    const catAName = `TM Category A ${uniqueSuffix}`;
    const catBName = `TM Category B ${uniqueSuffix}`;

    const listBeforeRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      session: coordSession,
    });
    expectStatus(listBeforeRes, 200, 'Category list');
    assert.ok(Array.isArray(listBeforeRes.json?.data?.categories), 'Category list must be an array');

    const createCatA = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      method: 'POST',
      session: coordSession,
      body: { name: catAName, description: 'Category A for task management tests', isActive: true },
    });
    expectStatus(createCatA, 201, 'Create category A');
    const catAId = readId(createCatA, 'Create category A', 'data', 'category', 'id');
    trackId(tracked.taskCategoryIds, catAId);
    assert.equal(createCatA.json?.data?.category?.name, catAName);
    assert.equal(createCatA.json?.data?.category?.isActive, true);

    const createCatB = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      method: 'POST',
      session: coordSession,
      body: { name: catBName, description: 'Category B for task management tests', isActive: true },
    });
    expectStatus(createCatB, 201, 'Create category B');
    const catBId = readId(createCatB, 'Create category B', 'data', 'category', 'id');
    trackId(tracked.taskCategoryIds, catBId);

    // Ordering: both categories active; the implementation orders is_active DESC, name ASC.
    const orderedRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      session: coordSession,
    });
    expectStatus(orderedRes, 200, 'Category ordering list');
    const orderedCategories: Array<{ id: number; name: string; isActive: boolean }> =
      orderedRes.json?.data?.categories ?? [];
    const indexA = orderedCategories.findIndex((item) => Number(item.id) === catAId);
    const indexB = orderedCategories.findIndex((item) => Number(item.id) === catBId);
    assert.ok(indexA >= 0 && indexB >= 0, 'Both test categories must be listed');
    assert.ok(
      indexA < indexB,
      'Active categories must be ordered by name ascending (Category A before Category B)',
    );

    const activeOnlyRes = await apiFetch(
      baseUrl,
      '/api/v1/coordinator/task-categories?activeOnly=true',
      { session: coordSession },
    );
    expectStatus(activeOnlyRes, 200, 'Active-only category list');
    const activeOnlyCategories: Array<{ isActive: boolean }> =
      activeOnlyRes.json?.data?.categories ?? [];
    assert.ok(
      activeOnlyCategories.every((item) => item.isActive === true),
      'activeOnly=true must return only active categories',
    );

    // Invalid category names.
    const invalidCatNameRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      method: 'POST',
      session: coordSession,
      body: { name: 'A', description: 'too short', isActive: true },
    });
    expectError(invalidCatNameRes, 400, 'VALIDATION_ERROR', 'Reject one-character category name');

    const emptyCatNameRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      method: 'POST',
      session: coordSession,
      body: { name: '   ', description: 'blank', isActive: true },
    });
    expectError(emptyCatNameRes, 400, 'VALIDATION_ERROR', 'Reject blank category name');

    // Duplicate category name, including a different letter case.
    const duplicateCatRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      method: 'POST',
      session: coordSession,
      body: { name: catAName.toUpperCase(), isActive: true },
    });
    expectError(duplicateCatRes, 409, 'TASK_CATEGORY_EXISTS', 'Reject case-insensitive duplicate');

    // Update category B name + description.
    const updatedCatBName = `${catBName} Updated`;
    const updateCatBRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catBId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          name: updatedCatBName,
          description: 'Updated category B description',
          isActive: true,
        },
      },
    );
    expectStatus(updateCatBRes, 200, 'Update category B');
    assert.equal(updateCatBRes.json?.data?.category?.name, updatedCatBName);
    assert.equal(updateCatBRes.json?.data?.category?.description, 'Updated category B description');

    const duplicateUpdateRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catBId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { name: catAName, description: 'duplicate attempt', isActive: true },
      },
    );
    expectError(duplicateUpdateRes, 409, 'TASK_CATEGORY_EXISTS', 'Reject duplicate category update');

    // Deactivate and reactivate category A.
    const deactivateARes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catAId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { name: catAName, description: 'Temporarily inactive', isActive: false },
      },
    );
    expectStatus(deactivateARes, 200, 'Deactivate category A');
    assert.equal(deactivateARes.json?.data?.category?.isActive, false);

    const activeOnlyAfterDeactivate = await apiFetch(
      baseUrl,
      '/api/v1/coordinator/task-categories?activeOnly=true',
      { session: coordSession },
    );
    expectStatus(activeOnlyAfterDeactivate, 200, 'Active-only list after deactivation');
    assert.ok(
      !(activeOnlyAfterDeactivate.json?.data?.categories ?? []).some(
        (item: { id: number }) => Number(item.id) === catAId,
      ),
      'Deactivated category A must be absent from the active-only list',
    );

    const reactivateARes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catAId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { name: catAName, description: 'Reactivated', isActive: true },
      },
    );
    expectStatus(reactivateARes, 200, 'Reactivate category A');
    assert.equal(reactivateARes.json?.data?.category?.isActive, true);

    // -------------------------------------------------------------------------
    // 5. Task fixtures (5 tasks)
    // -------------------------------------------------------------------------
    const taskAllTitle = `TM All Task ${uniqueSuffix}`;
    const createAllRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catAId,
        title: taskAllTitle,
        description: 'All-students task used for edit and visibility scenarios',
        location: 'Main Hall',
        visibility: 'all_students',
        capacity: 10,
        requiredHours: 8,
        status: 'draft',
      },
    });
    expectStatus(createAllRes, 201, 'Create all-students task');
    const taskAllId = readId(createAllRes, 'Create all-students task', 'data', 'task', 'id');
    trackId(tracked.taskIds, taskAllId);

    const taskSectionTitle = `TM Section Task ${uniqueSuffix}`;
    const createSectionRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catAId,
        title: taskSectionTitle,
        description: 'Section-targeted task for eligibility scenarios',
        location: 'Lab A',
        visibility: 'specific_sections',
        capacity: 10,
        requiredHours: 4,
        status: 'draft',
        targetSectionIds: [sectionA],
      },
    });
    expectStatus(createSectionRes, 201, 'Create section-targeted task');
    const taskSectionId = readId(
      createSectionRes,
      'Create section-targeted task',
      'data',
      'task',
      'id',
    );
    trackId(tracked.taskIds, taskSectionId);

    const taskStudentTitle = `TM Student Task ${uniqueSuffix}`;
    const createStudentTaskRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catBId,
        title: taskStudentTitle,
        description: 'Individually targeted task for eligibility scenarios',
        location: 'Lab B',
        visibility: 'selected_students',
        capacity: 5,
        requiredHours: 6,
        status: 'draft',
        targetStudentIds: [stu1.studentId],
      },
    });
    expectStatus(createStudentTaskRes, 201, 'Create individually targeted task');
    const taskStudentId = readId(
      createStudentTaskRes,
      'Create individually targeted task',
      'data',
      'task',
      'id',
    );
    trackId(tracked.taskIds, taskStudentId);

    const taskCapacityTitle = `TM Capacity Task ${uniqueSuffix}`;
    const createCapacityRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catBId,
        title: taskCapacityTitle,
        description: 'Capacity-one task for approved-capacity scenarios',
        location: 'Lab C',
        visibility: 'all_students',
        capacity: 1,
        requiredHours: 2,
        status: 'published',
      },
    });
    expectStatus(createCapacityRes, 201, 'Create capacity task');
    const taskCapacityId = readId(createCapacityRes, 'Create capacity task', 'data', 'task', 'id');
    trackId(tracked.taskIds, taskCapacityId);

    const taskAttendanceTitle = `TM Attendance Task ${uniqueSuffix}`;
    const createAttendanceTaskRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catBId,
        title: taskAttendanceTitle,
        description: 'Attendance-linked task for session restriction scenarios',
        location: 'Lab D',
        visibility: 'all_students',
        capacity: 1,
        requiredHours: 3,
        status: 'published',
      },
    });
    expectStatus(createAttendanceTaskRes, 201, 'Create attendance task');
    const taskAttendanceId = readId(
      createAttendanceTaskRes,
      'Create attendance task',
      'data',
      'task',
      'id',
    );
    trackId(tracked.taskIds, taskAttendanceId);

    // Invalid task payloads.
    const invalidTitleRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catBId,
        title: 'X',
        description: 'too short title',
        visibility: 'all_students',
      },
    });
    expectError(invalidTitleRes, 400, 'VALIDATION_ERROR', 'Reject task title shorter than 3 chars');

    const invalidVisibilityRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catBId,
        title: `TM Invalid Visibility ${uniqueSuffix}`,
        description: 'invalid visibility value',
        visibility: 'everyone',
      },
    });
    expectError(invalidVisibilityRes, 400, 'INVALID_VISIBILITY', 'Reject unknown visibility');

    // -------------------------------------------------------------------------
    // 6. Task detail, editing, and category persistence
    // -------------------------------------------------------------------------
    const detailBeforeRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAllId}`,
      { session: coordSession },
    );
    expectStatus(detailBeforeRes, 200, 'Retrieve task detail');
    const detailBefore = detailBeforeRes.json?.data?.task;
    assert.equal(Number(detailBefore?.id), taskAllId);
    assert.equal(detailBefore?.title, taskAllTitle);
    assert.equal(Number(detailBefore?.categoryId), catAId);
    assert.equal(detailBefore?.status, 'draft');
    assert.equal(detailBefore?.visibility, 'all_students');
    assert.equal(Number(detailBefore?.capacity), 10);
    assert.equal(Number(detailBefore?.requiredHours), 8);

    const editedTitle = `${taskAllTitle} Edited`;
    const editedDescription = 'Edited description for task management coverage';
    const editAllRes = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${taskAllId}`, {
      method: 'PATCH',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catBId,
        title: editedTitle,
        description: editedDescription,
        location: 'Main Hall Annex',
        visibility: 'all_students',
        capacity: 10,
        requiredHours: 12,
        targetSectionIds: [],
        targetStudentIds: [],
      },
    });
    expectStatus(editAllRes, 200, 'Edit task title/description/hours/category');
    assert.equal(editAllRes.json?.data?.task?.title, editedTitle);
    assert.equal(Number(editAllRes.json?.data?.task?.categoryId), catBId);
    assert.equal(Number(editAllRes.json?.data?.task?.requiredHours), 12);

    const detailAfterRes = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${taskAllId}`, {
      session: coordSession,
    });
    expectStatus(detailAfterRes, 200, 'Re-retrieve task detail');
    const detailAfter = detailAfterRes.json?.data?.task;
    assert.equal(detailAfter?.title, editedTitle);
    assert.equal(detailAfter?.description, editedDescription);
    assert.equal(Number(detailAfter?.categoryId), catBId, 'Category change must persist');
    assert.equal(Number(detailAfter?.requiredHours), 12);

    const invalidCategoryRes = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${taskAllId}`, {
      method: 'PATCH',
      session: coordSession,
      body: {
        collegeId,
        categoryId: 999999999,
        title: editedTitle,
        description: editedDescription,
        visibility: 'all_students',
        capacity: 10,
        requiredHours: 12,
      },
    });
    expectError(
      invalidCategoryRes,
      404,
      'TASK_CATEGORY_NOT_FOUND',
      'Reject nonexistent category identifier',
    );

    // Category A is deactivated; switching a task to it must fail, but keeping an
    // already-assigned category must remain allowed.
    const deactivateAForTaskRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catAId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { name: catAName, description: 'Inactive for assignment tests', isActive: false },
      },
    );
    expectStatus(deactivateAForTaskRes, 200, 'Deactivate category A for assignment tests');

    const createWithInactiveRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId: catAId,
        title: `TM Inactive Category ${uniqueSuffix}`,
        description: 'must not be created under an inactive category',
        visibility: 'all_students',
      },
    });
    expectError(
      createWithInactiveRes,
      400,
      'TASK_CATEGORY_INACTIVE',
      'Reject task creation with inactive category',
    );

    const switchToInactiveRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAllId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          collegeId,
          categoryId: catAId,
          title: editedTitle,
          description: editedDescription,
          visibility: 'all_students',
          capacity: 10,
          requiredHours: 12,
        },
      },
    );
    expectError(
      switchToInactiveRes,
      400,
      'TASK_CATEGORY_INACTIVE',
      'Reject switching a task to an inactive category',
    );

    const keepInactiveSameCategoryRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskSectionId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          collegeId,
          categoryId: catAId,
          title: taskSectionTitle,
          description: 'Section-targeted task for eligibility scenarios',
          location: 'Lab A',
          visibility: 'specific_sections',
          capacity: 10,
          requiredHours: 4,
          targetSectionIds: [sectionA],
        },
      },
    );
    expectStatus(
      keepInactiveSameCategoryRes,
      200,
      'Editing a task while keeping its already-assigned inactive category',
    );

    // Publishing while the assigned category is inactive must fail.
    const publishInactiveCategoryRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskSectionId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'published' },
      },
    );
    expectError(
      publishInactiveCategoryRes,
      400,
      'TASK_CATEGORY_INACTIVE',
      'Reject publishing under an inactive category',
    );

    const reactivateAForPublishRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catAId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { name: catAName, description: 'Reactivated for publishing', isActive: true },
      },
    );
    expectStatus(reactivateAForPublishRes, 200, 'Reactivate category A');

    // -------------------------------------------------------------------------
    // 7. Publication and status transitions
    // -------------------------------------------------------------------------
    const invalidTransitionRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAllId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'ongoing' },
      },
    );
    expectError(
      invalidTransitionRes,
      409,
      'INVALID_STATUS_TRANSITION',
      'Reject draft -> ongoing transition',
    );

    // Closed/unpublished task must reject applications.
    const closedApplyRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAllId}/apply`,
      {
        method: 'POST',
        session: stu1.session,
        body: { applicationMessage: 'attempt on a draft task' },
      },
    );
    expectError(closedApplyRes, 400, 'TASK_NOT_OPEN', 'Reject application to unpublished task');

    const publishAllRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAllId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'published' },
      },
    );
    expectStatus(publishAllRes, 200, 'Publish all-students task');
    assert.equal(publishAllRes.json?.data?.task?.status, 'published');

    const publishSectionRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskSectionId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'published' },
      },
    );
    expectStatus(publishSectionRes, 200, 'Publish section-targeted task');

    const publishStudentTaskRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskStudentId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'published' },
      },
    );
    expectStatus(publishStudentTaskRes, 200, 'Publish individually targeted task');

    // Same-category rule while category B is inactive.
    const deactivateBRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catBId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          name: updatedCatBName,
          description: 'Inactive while already assigned',
          isActive: false,
        },
      },
    );
    expectStatus(deactivateBRes, 200, 'Deactivate category B');

    const editKeepingInactiveBRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAllId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          collegeId,
          categoryId: catBId,
          title: editedTitle,
          description: editedDescription,
          location: 'Main Hall Annex',
          visibility: 'all_students',
          capacity: 10,
          requiredHours: 12,
        },
      },
    );
    expectStatus(
      editKeepingInactiveBRes,
      200,
      'Editing a published task keeping its inactive assigned category',
    );

    const reactivateBRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/task-categories/${catBId}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { name: updatedCatBName, description: 'Reactivated', isActive: true },
      },
    );
    expectStatus(reactivateBRes, 200, 'Reactivate category B');

    // -------------------------------------------------------------------------
    // 8. Task listing, filtering, search, pagination
    // -------------------------------------------------------------------------
    const listTasksRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks?search=${encodeURIComponent(uniqueSuffix)}&page=1&pageSize=10`,
      { session: coordSession },
    );
    expectStatus(listTasksRes, 200, 'Task list search');
    const searchedTasks: Array<{ id: number }> = listTasksRes.json?.data?.tasks ?? [];
    const searchedIds = searchedTasks.map((task) => Number(task.id));
    assert.ok(searchedIds.includes(taskAllId), 'Search must return the all-students task');
    assert.ok(searchedIds.includes(taskCapacityId), 'Search must return the capacity task');

    const filterCategoryRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks?categoryId=${catBId}&pageSize=50`,
      { session: coordSession },
    );
    expectStatus(filterCategoryRes, 200, 'Task list category filter');
    const filteredTasks: Array<{ id: number; categoryName: string }> =
      filterCategoryRes.json?.data?.tasks ?? [];
    assert.ok(
      filteredTasks.every((task) => task.categoryName === updatedCatBName),
      'Category filter must only return tasks in the requested category',
    );
    assert.ok(
      filteredTasks.some((task) => Number(task.id) === taskAllId),
      'Category filter must include the edited task now assigned to category B',
    );

    const paginationRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks?search=${encodeURIComponent(uniqueSuffix)}&page=1&pageSize=2`,
      { session: coordSession },
    );
    expectStatus(paginationRes, 200, 'Task list pagination');
    assert.equal(Number(paginationRes.json?.data?.pageSize), 2);
    assert.equal(Number(paginationRes.json?.data?.page), 1);
    assert.ok(
      (paginationRes.json?.data?.tasks ?? []).length <= 2,
      'pageSize=2 must return at most two tasks',
    );
    assert.ok(Number(paginationRes.json?.data?.totalPages) >= 1);

    const lastPageRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks?search=${encodeURIComponent(uniqueSuffix)}&page=99999&pageSize=2`,
      { session: coordSession },
    );
    expectStatus(lastPageRes, 200, 'Task list out-of-range page');
    assert.equal(
      Number(lastPageRes.json?.data?.page),
      Number(lastPageRes.json?.data?.totalPages),
      'An out-of-range page must clamp to the last page',
    );

    const invalidStatusFilterRes = await apiFetch(
      baseUrl,
      '/api/v1/coordinator/tasks?status=not_a_status',
      { session: coordSession },
    );
    expectError(invalidStatusFilterRes, 400, 'INVALID_TASK_STATUS', 'Reject invalid status filter');

    const invalidVisibilityFilterRes = await apiFetch(
      baseUrl,
      '/api/v1/coordinator/tasks?visibility=not_a_visibility',
      { session: coordSession },
    );
    expectError(
      invalidVisibilityFilterRes,
      400,
      'INVALID_VISIBILITY',
      'Reject invalid visibility filter',
    );

    // -------------------------------------------------------------------------
    // 9. Student visibility, targeting, and eligibility rechecks
    // -------------------------------------------------------------------------
    const listStudentTasks = async (
      session: ApiClientSession,
      label: string,
    ): Promise<number[]> => {
      const res = await apiFetch(baseUrl, '/api/v1/student/tasks', { session });
      expectStatus(res, 200, label);
      const tasks: Array<{ id: number }> = res.json?.data?.tasks ?? [];
      return tasks.map((task) => Number(task.id));
    };

    const stu1TaskIds = await listStudentTasks(stu1.session, 'Student 1 eligible task list');
    const stu2TaskIds = await listStudentTasks(stu2.session, 'Student 2 eligible task list');
    const stu3TaskIds = await listStudentTasks(stu3.session, 'Student 3 eligible task list');

    assert.ok(stu1TaskIds.includes(taskAllId), 'Student 1 must see the all-students task');
    assert.ok(stu2TaskIds.includes(taskAllId), 'Student 2 must see the all-students task');
    assert.ok(stu3TaskIds.includes(taskAllId), 'Student 3 must see the all-students task');

    assert.ok(stu1TaskIds.includes(taskSectionId), 'Student 1 must see the section-targeted task');
    assert.ok(stu2TaskIds.includes(taskSectionId), 'Student 2 must see the section-targeted task');
    assert.ok(
      !stu3TaskIds.includes(taskSectionId),
      'Student 3 outside the target section must not see the section-targeted task',
    );

    assert.ok(stu1TaskIds.includes(taskStudentId), 'Targeted student must see the individual task');
    assert.ok(
      !stu2TaskIds.includes(taskStudentId),
      'Non-targeted Student 2 must not see the individually targeted task',
    );
    assert.ok(
      !stu3TaskIds.includes(taskStudentId),
      'Non-targeted Student 3 must not see the individually targeted task',
    );

    const stu1StudentTaskDetail = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskStudentId}`,
      { session: stu1.session },
    );
    expectStatus(stu1StudentTaskDetail, 200, 'Targeted student task detail');
    assert.equal(Number(stu1StudentTaskDetail.json?.data?.task?.id), taskStudentId);

    const stu2StudentTaskDetail = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskStudentId}`,
      { session: stu2.session },
    );
    expectError(
      stu2StudentTaskDetail,
      403,
      'TASK_NOT_ELIGIBLE',
      'Non-targeted student task detail',
    );

    const stu3SectionDetail = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskSectionId}`,
      { session: stu3.session },
    );
    expectError(
      stu3SectionDetail,
      403,
      'TASK_NOT_ELIGIBLE',
      'Student outside the target section task detail',
    );

    const stu2ApplyTargetedRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskStudentId}/apply`,
      {
        method: 'POST',
        session: stu2.session,
        body: { applicationMessage: 'non-targeted application attempt' },
      },
    );
    expectError(
      stu2ApplyTargetedRes,
      403,
      'TASK_NOT_ELIGIBLE',
      'Backend must recheck individual targeting on apply',
    );

    const stu3ApplySectionRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskSectionId}/apply`,
      {
        method: 'POST',
        session: stu3.session,
        body: { applicationMessage: 'outside-section application attempt' },
      },
    );
    expectError(
      stu3ApplySectionRes,
      403,
      'TASK_NOT_ELIGIBLE',
      'Backend must recheck section targeting on apply',
    );

    // -------------------------------------------------------------------------
    // 10. Capacity: approved count only, duplicate prevention, full rejection
    // -------------------------------------------------------------------------
    const capacityApply1 = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskCapacityId}/apply`,
      {
        method: 'POST',
        session: stu1.session,
        body: { applicationMessage: 'capacity fixture application' },
      },
    );
    expectStatus(capacityApply1, 201, 'Student 1 applies to capacity task');
    const capacityApp1Id = readId(
      capacityApply1,
      'Student 1 capacity application',
      'data',
      'application',
      'id',
    );
    trackId(tracked.applicationIds, capacityApp1Id);

    const capacityApprove1 = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/applications/${capacityApp1Id}/decision`,
      {
        method: 'POST',
        session: coordSession,
        body: { decision: 'approved', remarks: 'Approved to fill capacity' },
      },
    );
    expectStatus(capacityApprove1, 200, 'Approve Student 1 capacity application');
    assert.equal(capacityApprove1.json?.data?.application?.status, 'approved');

    const capacityApply2 = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskCapacityId}/apply`,
      {
        method: 'POST',
        session: stu2.session,
        body: { applicationMessage: 'capacity overflow attempt' },
      },
    );
    expectError(
      capacityApply2,
      409,
      'TASK_CAPACITY_FULL',
      'Reject application when approved capacity is reached',
    );

    const firstAllApplicationRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAllId}/apply`,
      {
        method: 'POST',
        session: stu1.session,
        body: { applicationMessage: 'first application for duplicate prevention' },
      },
    );
    expectStatus(firstAllApplicationRes, 201, 'First application to all-students task');
    const firstAllApplicationId = readId(
      firstAllApplicationRes,
      'First all-students application',
      'data',
      'application',
      'id',
    );
    trackId(tracked.applicationIds, firstAllApplicationId);

    const duplicateApplicationRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAllId}/apply`,
      {
        method: 'POST',
        session: stu1.session,
        body: { applicationMessage: 'duplicate application attempt' },
      },
    );
    expectError(
      duplicateApplicationRes,
      409,
      'DUPLICATE_APPLICATION',
      'Reject duplicate active application on the all-students task',
    );

    const stu2CapacityListRes = await apiFetch(baseUrl, '/api/v1/student/tasks', {
      session: stu2.session,
    });
    expectStatus(stu2CapacityListRes, 200, 'Student 2 capacity task list');
    const capacityTaskView = (stu2CapacityListRes.json?.data?.tasks ?? []).find(
      (task: { id: number }) => Number(task.id) === taskCapacityId,
    );
    assert.ok(capacityTaskView, 'Capacity task must be visible to Student 2');
    assert.equal(Number(capacityTaskView.approvedCount), 1);
    assert.equal(capacityTaskView.isFull, true);
    assert.equal(Number(capacityTaskView.remainingCapacity), 0);

    // Pending applications must not consume capacity: both students can apply
    // to the capacity-one attendance task while no application is approved.
    const pendingApplyStu2 = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAttendanceId}/apply`,
      {
        method: 'POST',
        session: stu2.session,
        body: { applicationMessage: 'pending application, not counted as approved' },
      },
    );
    expectStatus(pendingApplyStu2, 201, 'Student 2 pending application on capacity-one task');
    const pendingAppStu2Id = readId(
      pendingApplyStu2,
      'Student 2 pending application',
      'data',
      'application',
      'id',
    );
    trackId(tracked.applicationIds, pendingAppStu2Id);

    const pendingApplyStu1 = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAttendanceId}/apply`,
      {
        method: 'POST',
        session: stu1.session,
        body: { applicationMessage: 'second pending application while no approvals exist' },
      },
    );
    expectStatus(
      pendingApplyStu1,
      201,
      'Pending applications must not count toward approved capacity',
    );
    const attendanceAppId = readId(
      pendingApplyStu1,
      'Student 1 attendance application',
      'data',
      'application',
      'id',
    );
    trackId(tracked.applicationIds, attendanceAppId);

    const approveAttendanceApp = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/applications/${attendanceAppId}/decision`,
      {
        method: 'POST',
        session: coordSession,
        body: { decision: 'approved', remarks: 'Approved for attendance session tests' },
      },
    );
    expectStatus(approveAttendanceApp, 200, 'Approve Student 1 attendance application');

    const stu3ApplyFullRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAttendanceId}/apply`,
      {
        method: 'POST',
        session: stu3.session,
        body: { applicationMessage: 'apply after capacity reached' },
      },
    );
    expectError(
      stu3ApplyFullRes,
      409,
      'TASK_CAPACITY_FULL',
      'Reject application after the capacity-one task becomes full',
    );

    // -------------------------------------------------------------------------
    // 11. Task sessions
    // -------------------------------------------------------------------------
    const invalidTimeRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: `TM Invalid Range ${uniqueSuffix}`,
          sessionDate: '2027-03-10',
          startTime: '10:00',
          endTime: '09:00',
          location: 'Lab D',
        },
      },
    );
    expectError(invalidTimeRes, 400, 'INVALID_TIME_RANGE', 'Reject end time before start time');

    const invalidDateRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: `TM Invalid Date ${uniqueSuffix}`,
          sessionDate: 'not-a-date',
          startTime: '08:00',
          endTime: '12:00',
          location: 'Lab D',
        },
      },
    );
    expectError(invalidDateRes, 400, 'VALIDATION_ERROR', 'Reject malformed session date');

    const session1Res = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: `TM Session One ${uniqueSuffix}`,
          sessionDate: '2027-03-10',
          startTime: '08:00',
          endTime: '12:00',
          location: 'Lab D',
        },
      },
    );
    expectStatus(session1Res, 201, 'Create session 1');
    const session1Id = readId(session1Res, 'Create session 1', 'data', 'session', 'id');
    trackId(tracked.sessionIds, session1Id);
    assert.equal(session1Res.json?.data?.session?.sessionTitle, `TM Session One ${uniqueSuffix}`);
    assert.equal(session1Res.json?.data?.session?.startTime, '08:00');
    assert.equal(session1Res.json?.data?.session?.endTime, '12:00');

    const overlapRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: `TM Overlapping Session ${uniqueSuffix}`,
          sessionDate: '2027-03-10',
          startTime: '11:00',
          endTime: '13:00',
          location: 'Lab D',
        },
      },
    );
    expectError(overlapRes, 409, 'SESSION_TIME_OVERLAP', 'Reject overlapping session');

    const session3Res = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: `TM Session Three ${uniqueSuffix}`,
          sessionDate: '2027-03-11',
          startTime: '08:00',
          endTime: '12:00',
          location: 'Lab D',
        },
      },
    );
    expectStatus(session3Res, 201, 'Create non-overlapping session');
    const session3Id = readId(
      session3Res,
      'Create non-overlapping session',
      'data',
      'session',
      'id',
    );
    trackId(tracked.sessionIds, session3Id);

    const listSessionsRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions`,
      { session: coordSession },
    );
    expectStatus(listSessionsRes, 200, 'List task sessions');
    const listedSessions: Array<{ id: number }> = listSessionsRes.json?.data?.sessions ?? [];
    const listedSessionIds = listedSessions.map((session) => Number(session.id));
    assert.ok(listedSessionIds.includes(session1Id), 'Session list must include session 1');
    assert.ok(listedSessionIds.includes(session3Id), 'Session list must include session 3');

    const editSessionRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions/${session3Id}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          sessionTitle: `TM Session Three Edited ${uniqueSuffix}`,
          sessionDate: '2027-03-11',
          startTime: '13:00',
          endTime: '17:00',
          location: 'Lab D Annex',
        },
      },
    );
    expectStatus(editSessionRes, 200, 'Edit task session');
    assert.equal(
      editSessionRes.json?.data?.session?.sessionTitle,
      `TM Session Three Edited ${uniqueSuffix}`,
    );

    const deleteSessionRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions/${session3Id}`,
      { method: 'DELETE', session: coordSession },
    );
    expectStatus(deleteSessionRes, 200, 'Delete session without attendance');
    assert.equal(Number(deleteSessionRes.json?.data?.deletedSessionId), session3Id);

    // Attendance creation makes session 1 non-deletable, but editing stays allowed.
    const attendanceRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: coordSession,
      body: {
        applicationId: attendanceAppId,
        taskSessionId: session1Id,
        recordedHours: 2,
        autoVerify: false,
        remarks: 'Session-linked attendance for deletion restriction test',
      },
    });
    expectStatus(attendanceRes, 201, 'Create attendance for session restriction test');
    const attendanceId = readId(attendanceRes, 'Create attendance record', 'data', 'record', 'id');
    trackId(tracked.attendanceIds, attendanceId);

    const deleteSessionWithAttendanceRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions/${session1Id}`,
      { method: 'DELETE', session: coordSession },
    );
    expectError(
      deleteSessionWithAttendanceRes,
      409,
      'SESSION_HAS_ATTENDANCE',
      'Reject deleting a session that has attendance',
    );

    const editSessionWithAttendanceRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskAttendanceId}/sessions/${session1Id}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          sessionTitle: `TM Session One Edited ${uniqueSuffix}`,
          sessionDate: '2027-03-10',
          startTime: '08:00',
          endTime: '12:00',
          location: 'Lab D Annex',
        },
      },
    );
    expectStatus(
      editSessionWithAttendanceRes,
      200,
      'Editing a session is currently allowed even when attendance exists (known product gap)',
    );
    assert.equal(
      editSessionWithAttendanceRes.json?.data?.session?.sessionTitle,
      `TM Session One Edited ${uniqueSuffix}`,
    );

    // -------------------------------------------------------------------------
    // 12. Full supported status lifecycle on the capacity task
    // -------------------------------------------------------------------------
    const unpublishWithApplicationsRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskCapacityId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'draft' },
      },
    );
    expectError(
      unpublishWithApplicationsRes,
      409,
      'TASK_HAS_APPLICATIONS',
      'Reject unpublishing a task with approved applications',
    );

    const ongoingRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskCapacityId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'ongoing' },
      },
    );
    expectStatus(ongoingRes, 200, 'Publish -> ongoing transition');

    const invalidOngoingRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskCapacityId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'published' },
      },
    );
    expectError(
      invalidOngoingRes,
      409,
      'INVALID_STATUS_TRANSITION',
      'Reject ongoing -> published transition',
    );

    const completedRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskCapacityId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'completed' },
      },
    );
    expectStatus(completedRes, 200, 'Ongoing -> completed transition');

    const archivedRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskCapacityId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'archived' },
      },
    );
    expectStatus(archivedRes, 200, 'Completed -> archived transition');

    const reopenRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/tasks/${taskCapacityId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'draft' },
      },
    );
    expectStatus(reopenRes, 200, 'Archived -> draft transition');

    // -------------------------------------------------------------------------
    // 13. Security: authentication, role authorization, CSRF
    // -------------------------------------------------------------------------
    const unauthenticatedListRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks');
    expectError(
      unauthenticatedListRes,
      401,
      'UNAUTHENTICATED',
      'Unauthenticated coordinator task list',
    );

    const studentCoordinatorListRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      session: stu1.session,
    });
    expectError(
      studentCoordinatorListRes,
      403,
      ['ROLE_UNAUTHORIZED', 'FORBIDDEN'],
      'Student role denied coordinator task list',
    );

    const missingCsrfCategoryRes = await apiFetch(
      baseUrl,
      '/api/v1/coordinator/task-categories',
      {
        method: 'POST',
        session: coordSession,
        omitCsrf: true,
        body: { name: `TM No CSRF ${uniqueSuffix}`, isActive: true },
      },
    );
    expectError(
      missingCsrfCategoryRes,
      403,
      'CSRF_INVALID',
      'Missing CSRF token on category mutation',
    );

    const coordinatorApplyRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAllId}/apply`,
      {
        method: 'POST',
        session: coordSession,
        body: { applicationMessage: 'coordinator must not apply' },
      },
    );
    expectError(
      coordinatorApplyRes,
      403,
      ['ROLE_UNAUTHORIZED', 'FORBIDDEN'],
      'Coordinator role denied student application endpoint',
    );

    const unauthenticatedApplyRes = await apiFetch(
      baseUrl,
      `/api/v1/student/tasks/${taskAllId}/apply`,
      {
        method: 'POST',
        body: { applicationMessage: 'no session' },
      },
    );
    expectError(
      unauthenticatedApplyRes,
      401,
      'UNAUTHENTICATED',
      'Unauthenticated student application',
    );
  } catch (err) {
    testError = err;
  } finally {
    // -------------------------------------------------------------------------
    // Cleanup: only after the live database identity was verified. Deletions are
    // strictly foreign-key-safe and limited to fixtures created by this run.
    // -------------------------------------------------------------------------
    if (isolationVerified) {
      try {
        // Recover any student fixture that was created but whose IDs were not tracked.
        for (const fixture of studentFixtures) {
          if (fixture.studentId !== null && fixture.userId !== null) {
            continue;
          }
          const recovered = await recoverStudentFixture(fixture);
          if (!recovered) {
            console.error(
              `[CLEANUP_FAILURE] Unable to identify test student fixture for cleanup: ` +
                `studentNumber=${fixture.studentNumber} email=${fixture.email}`,
            );
            continue;
          }
          fixture.studentId = recovered.studentId;
          fixture.userId = recovered.userId;
          trackId(tracked.studentIds, recovered.studentId);
          trackId(tracked.userIds, recovered.userId);
        }

        const appIds = tracked.applicationIds;
        const sessIds = tracked.sessionIds;
        const taskIds = tracked.taskIds;
        const catIds = tracked.taskCategoryIds;
        const stuIds = tracked.studentIds;
        const uIds = tracked.userIds;
        const attIds = tracked.attendanceIds;
        const ayIds = tracked.academicYearIds;
        const progIds = tracked.programIds;
        const secIds = tracked.sectionIds;
        const relatedIds = Array.from(new Set([...appIds, ...taskIds, ...sessIds, ...attIds]));
        const subjectIds = Array.from(new Set([...relatedIds, ...stuIds]));

        // 1. Notifications addressed to test users or referencing test-created records
        //    (including notifications delivered to pre-existing coordinators).
        if (uIds.length > 0 || relatedIds.length > 0) {
          const conditions: string[] = [];
          const params: unknown[] = [];
          if (uIds.length > 0) {
            params.push(uIds);
            conditions.push(`user_id = ANY($${params.length}::bigint[])`);
          }
          if (relatedIds.length > 0) {
            params.push(relatedIds);
            conditions.push(
              `(related_id = ANY($${params.length}::bigint[]) AND ` +
                `related_type IN ('task_applications','tasks','task_sessions','attendance'))`,
            );
          }
          await query(`DELETE FROM notifications WHERE ${conditions.join(' OR ')}`, params);
        }

        // 2. Audit logs authored by test users or describing test-created subjects.
        if (uIds.length > 0 || subjectIds.length > 0) {
          const conditions: string[] = [];
          const params: unknown[] = [];
          if (uIds.length > 0) {
            params.push(uIds);
            conditions.push(`user_id = ANY($${params.length}::bigint[])`);
          }
          if (subjectIds.length > 0) {
            params.push(subjectIds);
            conditions.push(
              `(subject_id = ANY($${params.length}::bigint[]) AND subject_type IN (` +
                `'students','student_section_history','tasks','task_categories',` +
                `'task_sessions','task_applications','attendance'))`,
            );
          }
          await query(`DELETE FROM audit_logs WHERE ${conditions.join(' OR ')}`, params);
        }

        // 3. Service-hour adjustments, attendance, reviews, applications.
        if (appIds.length > 0) {
          await query(
            `DELETE FROM service_hour_adjustments WHERE application_id = ANY($1::bigint[])`,
            [appIds],
          );
          await query(`DELETE FROM attendance WHERE application_id = ANY($1::bigint[])`, [appIds]);
          await query(
            `DELETE FROM application_reviews WHERE application_id = ANY($1::bigint[])`,
            [appIds],
          );
        }
        if (attIds.length > 0) {
          await query(`DELETE FROM attendance WHERE id = ANY($1::bigint[])`, [attIds]);
        }
        if (sessIds.length > 0) {
          await query(`DELETE FROM attendance WHERE task_session_id = ANY($1::bigint[])`, [sessIds]);
        }
        if (taskIds.length > 0) {
          await query(
            `DELETE FROM attendance WHERE task_session_id IN (
               SELECT id FROM task_sessions WHERE task_id = ANY($1::bigint[])
             )`,
            [taskIds],
          );
        }
        if (appIds.length > 0) {
          await query(`DELETE FROM task_applications WHERE id = ANY($1::bigint[])`, [appIds]);
        }

        // 4. Sessions (by tracked id or parent task), then targets, then tasks.
        if (sessIds.length > 0 || taskIds.length > 0) {
          const conditions: string[] = [];
          const params: unknown[] = [];
          if (sessIds.length > 0) {
            params.push(sessIds);
            conditions.push(`id = ANY($${params.length}::bigint[])`);
          }
          if (taskIds.length > 0) {
            params.push(taskIds);
            conditions.push(`task_id = ANY($${params.length}::bigint[])`);
          }
          await query(`DELETE FROM task_sessions WHERE ${conditions.join(' OR ')}`, params);
        }
        if (taskIds.length > 0) {
          await query(`DELETE FROM task_target_students WHERE task_id = ANY($1::bigint[])`, [
            taskIds,
          ]);
          await query(`DELETE FROM task_target_sections WHERE task_id = ANY($1::bigint[])`, [
            taskIds,
          ]);
          await query(`DELETE FROM tasks WHERE id = ANY($1::bigint[])`, [taskIds]);
        }

        // 5. Categories after tasks (tasks.category_id is RESTRICT).
        if (catIds.length > 0) {
          await query(`DELETE FROM task_categories WHERE id = ANY($1::bigint[])`, [catIds]);
        }

        // 6. Student profiles and section history.
        if (stuIds.length > 0) {
          await query(`DELETE FROM student_section_history WHERE student_id = ANY($1::bigint[])`, [
            stuIds,
          ]);
          await query(`DELETE FROM students WHERE id = ANY($1::bigint[])`, [stuIds]);
        }

        // 7. Test-only academic fixtures. Task targets and student section history
        //    were deleted above, so sections can now be removed before programs and
        //    academic years. Seeded colleges and year levels are never touched.
        if (secIds.length > 0) {
          await query(`DELETE FROM sections WHERE id = ANY($1::bigint[])`, [secIds]);
        }
        if (progIds.length > 0) {
          await query(`DELETE FROM programs WHERE id = ANY($1::bigint[])`, [progIds]);
        }
        if (ayIds.length > 0) {
          await query(`DELETE FROM academic_years WHERE id = ANY($1::bigint[])`, [ayIds]);
        }

        // 8. User roles, then users (after all RESTRICT references are gone).
        if (uIds.length > 0) {
          await query(`DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])`, [uIds]);
          await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [uIds]);
        }
      } catch (cleanErr) {
        cleanupError = cleanErr;
        console.error('[CLEANUP_FAILURE] Error during test teardown cleanup:', cleanErr, {
          suffix: uniqueSuffix,
          coordinator: coordEmail,
          students: studentFixtures.map((fixture) => ({
            studentNumber: fixture.studentNumber,
            email: fixture.email,
            studentId: fixture.studentId,
            userId: fixture.userId,
          })),
          categories: tracked.taskCategoryIds,
          tasks: tracked.taskIds,
          sessions: tracked.sessionIds,
          applications: tracked.applicationIds,
          attendance: tracked.attendanceIds,
          academicYears: tracked.academicYearIds,
          programs: tracked.programIds,
          sections: tracked.sectionIds,
        });
      }
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (testError) {
      throw testError;
    }
    if (cleanupError) {
      throw new Error(`Test assertions passed, but cleanup failed: ${String(cleanupError)}`);
    }
  }
});
