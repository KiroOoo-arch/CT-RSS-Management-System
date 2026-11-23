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
import { apiFetch, loginAs } from './testUtils.ts';

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
  await closeDatabasePool().catch(() => undefined);
});

test('Attendance and Service Hours Workflow Automated Test Suite', async () => {
  const app = await createApp({ enableVite: false });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  assert.ok(address && typeof address === 'object', 'Ephemeral test server failed to bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // Track all test-created record IDs for deterministic teardown cleanup
  const tracked = {
    userIds: [] as number[],
    studentIds: [] as number[],
    taskCategoryIds: [] as number[],
    taskIds: [] as number[],
    sessionIds: [] as number[],
    applicationIds: [] as number[],
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
      if (!tracked.studentIds.includes(studentId)) {
        tracked.studentIds.push(studentId);
      }
      if (!tracked.userIds.includes(userId)) {
        tracked.userIds.push(userId);
      }
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
    if (!tracked.studentIds.includes(recovered.studentId)) {
      tracked.studentIds.push(recovered.studentId);
    }
    if (!tracked.userIds.includes(recovered.userId)) {
      tracked.userIds.push(recovered.userId);
    }

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
    // 1. Query Seeded College
    // -------------------------------------------------------------------------
    const collegeRes = await query<{ id: number }>(
      `SELECT id FROM colleges WHERE code = 'CT' LIMIT 1`,
    );
    const collegeId = Number(collegeRes.rows[0]?.id ?? 1);
    assert.ok(collegeId > 0, 'Seeded College of Technology record must exist');

    // -------------------------------------------------------------------------
    // 1. Fixture Creation: Coordinator Account
    // -------------------------------------------------------------------------
    const coordEmail = `coord_att_${uniqueSuffix}@ctrss.test`;
    const coordPassword = 'CoordPassword#2026!';
    const coordHash = await hashPassword(coordPassword);

    const coordInsertRes = await query<{ id: number }>(
      `INSERT INTO users (name, email, password, account_status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [`QA Coordinator ${uniqueSuffix}`, coordEmail, coordHash],
    );
    const coordUserId = Number(coordInsertRes.rows[0]?.id);
    assert.ok(coordUserId > 0, 'Coordinator user must be created');
    tracked.userIds.push(coordUserId);

    await query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       SELECT $1, id, $1 FROM roles WHERE name = 'RSS Coordinator' LIMIT 1`,
      [coordUserId],
    );

    const coordLogin = await loginAs(baseUrl, coordEmail, coordPassword);
    assert.equal(coordLogin.status, 200, 'Coordinator login must succeed');
    assert.equal(coordLogin.json?.data?.user?.primaryRole, 'RSS Coordinator');
    const coordSession = coordLogin.session;
    assert.ok(coordSession.csrfToken.length > 10, 'Coordinator must receive a valid CSRF token');

    // -------------------------------------------------------------------------
    // 2. Fixture Creation: Student Accounts (1 to be approved, 1 unapproved)
    // -------------------------------------------------------------------------
    const stu1Email = `stu1_att_${uniqueSuffix}@ctrss.test`;
    const stu1Password = 'StudentPass#2026!';
    const stu1Num = `ATT-${uniqueSuffix}-1`;

    const createStu1Res = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: stu1Num,
        firstName: 'ApprovedFirst',
        lastName: 'ApprovedLast',
        email: stu1Email,
        password: stu1Password,
        accountStatus: 'active',
      },
    });
    assert.equal(
      createStu1Res.status,
      201,
      `Student 1 creation failed: ${createStu1Res.status} ${createStu1Res.statusText}\n` +
        `Content-Type: ${createStu1Res.contentType}\n` +
        `Redirected: ${createStu1Res.redirected} URL: ${createStu1Res.finalUrl}\n` +
        `Body (truncated): ${createStu1Res.bodyText.slice(0, 1500)}`
    );
    const stu1Fixture: TrackedStudentFixture = {
      studentNumber: stu1Num,
      email: stu1Email,
      studentId: null,
      userId: null,
    };
    studentFixtures.push(stu1Fixture);
    const { studentId: stu1Id, userId: stu1UserId } = await registerStudentFixture(
      stu1Fixture,
      createStu1Res.json,
    );
    assert.ok(stu1Id > 0 && stu1UserId > 0);

    const stu2Email = `stu2_att_${uniqueSuffix}@ctrss.test`;
    const stu2Password = 'StudentPass#2026!';
    const stu2Num = `ATT-${uniqueSuffix}-2`;

    const createStu2Res = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: stu2Num,
        firstName: 'UnapprovedFirst',
        lastName: 'UnapprovedLast',
        email: stu2Email,
        password: stu2Password,
        accountStatus: 'active',
      },
    });
    assert.equal(createStu2Res.status, 201, 'Student 2 creation must succeed');
    const stu2Fixture: TrackedStudentFixture = {
      studentNumber: stu2Num,
      email: stu2Email,
      studentId: null,
      userId: null,
    };
    studentFixtures.push(stu2Fixture);
    const { studentId: stu2Id, userId: stu2UserId } = await registerStudentFixture(
      stu2Fixture,
      createStu2Res.json,
    );
    assert.ok(stu2Id > 0 && stu2UserId > 0);

    // -------------------------------------------------------------------------
    // 3. Fixture Creation: Task Category, Published Task, Sessions
    // -------------------------------------------------------------------------
    const catRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
      method: 'POST',
      session: coordSession,
      body: {
        name: `Att Category ${uniqueSuffix}`,
        description: 'Attendance verification test category',
        isActive: true,
      },
    });
    assert.equal(catRes.status, 201, 'Task category creation must succeed');
    const categoryId = Number(catRes.json?.data?.category?.id);
    assert.ok(categoryId > 0);
    tracked.taskCategoryIds.push(categoryId);

    const taskRes = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
      method: 'POST',
      session: coordSession,
      body: {
        collegeId,
        categoryId,
        title: `Attendance Verification Task ${uniqueSuffix}`,
        description: 'Task for testing attendance and service hours workflows',
        location: 'Technology Lab 3',
        visibility: 'all_students',
        capacity: 10,
        requiredHours: 8,
        status: 'draft',
      },
    });
    assert.equal(taskRes.status, 201, 'Task creation must succeed');
    const taskId = Number(taskRes.json?.data?.task?.id);
    assert.ok(taskId > 0);
    tracked.taskIds.push(taskId);

    const pubRes = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${taskId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'published' },
    });
    assert.equal(pubRes.status, 200, 'Publishing task must succeed');

    const sess1Res = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${taskId}/sessions`, {
      method: 'POST',
      session: coordSession,
      body: {
        sessionTitle: `Morning Lab Shift ${uniqueSuffix}`,
        sessionDate: '2026-11-20',
        startTime: '08:00',
        endTime: '12:00',
        location: 'Tech Lab 3',
      },
    });
    assert.equal(sess1Res.status, 201, 'Session 1 creation must succeed');
    const sess1Id = Number(sess1Res.json?.data?.session?.id);
    assert.ok(sess1Id > 0);
    tracked.sessionIds.push(sess1Id);

    const sess2Res = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${taskId}/sessions`, {
      method: 'POST',
      session: coordSession,
      body: {
        sessionTitle: `Afternoon Lab Shift ${uniqueSuffix}`,
        sessionDate: '2026-11-21',
        startTime: '13:00',
        endTime: '17:00',
        location: 'Tech Lab 3',
      },
    });
    assert.equal(sess2Res.status, 201, 'Session 2 creation must succeed');
    const sess2Id = Number(sess2Res.json?.data?.session?.id);
    assert.ok(sess2Id > 0);
    tracked.sessionIds.push(sess2Id);

    // -------------------------------------------------------------------------
    // 4. Fixture Creation: Task Applications (Approved & Unapproved)
    // -------------------------------------------------------------------------
    const stu1Login = await loginAs(baseUrl, stu1Email, stu1Password);
    assert.equal(stu1Login.status, 200, 'Student 1 login must succeed');
    const stu1Session = stu1Login.session;

    const app1ApplyRes = await apiFetch(baseUrl, `/api/v1/student/tasks/${taskId}/apply`, {
      method: 'POST',
      session: stu1Session,
      body: { applicationMessage: 'Student 1 applying to task' },
    });
    assert.equal(app1ApplyRes.status, 201, 'Student 1 application must succeed');
    const app1Id = Number(app1ApplyRes.json?.data?.application?.id);
    assert.ok(app1Id > 0);
    tracked.applicationIds.push(app1Id);

    // Coordinator approves Student 1 application
    const app1DecisionRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/applications/${app1Id}/decision`,
      {
        method: 'POST',
        session: coordSession,
        body: { decision: 'approved', remarks: 'Approved for testing' },
      },
    );
    assert.equal(app1DecisionRes.status, 200, 'Coordinator approval must succeed');
    assert.equal(app1DecisionRes.json?.data?.application?.status, 'approved');

    // Student 2 applies and remains pending (unapproved)
    const stu2Login = await loginAs(baseUrl, stu2Email, stu2Password);
    assert.equal(stu2Login.status, 200, 'Student 2 login must succeed');
    const stu2Session = stu2Login.session;

    const app2ApplyRes = await apiFetch(baseUrl, `/api/v1/student/tasks/${taskId}/apply`, {
      method: 'POST',
      session: stu2Session,
      body: { applicationMessage: 'Student 2 unapproved application' },
    });
    assert.equal(app2ApplyRes.status, 201, 'Student 2 application must succeed');
    const app2Id = Number(app2ApplyRes.json?.data?.application?.id);
    assert.ok(app2Id > 0);
    tracked.applicationIds.push(app2Id);

    // -------------------------------------------------------------------------
    // Scenario 1: Reject attendance for an unapproved application
    // -------------------------------------------------------------------------
    const unapprovedAttRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: coordSession,
      body: {
        applicationId: app2Id,
        taskSessionId: sess1Id,
        recordedHours: 3.5,
      },
    });
    assert.equal(
      unapprovedAttRes.status,
      400,
      'Scenario 1: Recording attendance for unapproved application must return 400',
    );
    assert.equal(
      unapprovedAttRes.json?.error?.code,
      'APPLICATION_NOT_APPROVED',
      'Scenario 1: Error code must be APPLICATION_NOT_APPROVED',
    );

    // -------------------------------------------------------------------------
    // Scenario 2: Valid attendance recording (pending when autoVerify is false)
    // -------------------------------------------------------------------------
    const validAttRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: coordSession,
      body: {
        applicationId: app1Id,
        taskSessionId: sess1Id,
        recordedHours: 3.5,
        autoVerify: false,
        remarks: 'On time for morning shift',
      },
    });
    assert.equal(validAttRes.status, 201, 'Scenario 2: Recording valid attendance must return 201');
    const record1 = validAttRes.json?.data?.record;
    assert.ok(record1 && record1.id > 0, 'Scenario 2: Must return created attendance record');
    const att1Id = Number(record1.id);
    assert.equal(
      record1.verificationStatus,
      'pending',
      'Scenario 2: Status must be pending when autoVerify=false',
    );
    assert.equal(record1.recordedHours, 3.5, 'Scenario 2: Recorded hours must equal 3.5');
    assert.equal(record1.verifiedHours, 0, 'Scenario 2: Verified hours must be 0 while pending');

    // -------------------------------------------------------------------------
    // Scenario 3: Reject duplicate attendance for the same application and session
    // -------------------------------------------------------------------------
    const dupAttRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: coordSession,
      body: {
        applicationId: app1Id,
        taskSessionId: sess1Id,
        recordedHours: 3.5,
      },
    });
    assert.equal(
      dupAttRes.status,
      409,
      'Scenario 3: Duplicate attendance entry must return 409 Conflict',
    );
    assert.equal(
      dupAttRes.json?.error?.code,
      'DUPLICATE_ATTENDANCE',
      'Scenario 3: Error code must be DUPLICATE_ATTENDANCE',
    );

    // -------------------------------------------------------------------------
    // Scenario 4: An absent student has zero recorded hours
    // -------------------------------------------------------------------------
    const absentAttRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: coordSession,
      body: {
        applicationId: app1Id,
        taskSessionId: sess2Id,
        markAbsent: true,
        remarks: 'Excused absence for exam',
      },
    });
    assert.equal(
      absentAttRes.status,
      201,
      'Scenario 4: Recording absent attendance must return 201',
    );
    const record2 = absentAttRes.json?.data?.record;
    assert.ok(record2 && record2.id > 0);
    assert.equal(record2.recordedHours, 0, 'Scenario 4: Absent student recorded hours must be 0');
    assert.equal(record2.verifiedHours, 0, 'Scenario 4: Absent student verified hours must be 0');
    assert.ok(
      typeof record2.remarks === 'string' && record2.remarks.includes('[ABSENT]'),
      'Scenario 4: Remarks must indicate student was absent',
    );

    // -------------------------------------------------------------------------
    // Scenario 5: Pending attendance can be verified
    // -------------------------------------------------------------------------
    const verifyAttRes = await apiFetch(baseUrl, `/api/v1/coordinator/attendance/${att1Id}`, {
      method: 'PATCH',
      session: coordSession,
      body: {
        verificationStatus: 'verified',
        verifiedHours: 3.5,
        remarks: 'Verified by laboratory supervisor',
      },
    });
    assert.equal(verifyAttRes.status, 200, 'Scenario 5: Attendance verification must return 200');
    const verifiedRecord = verifyAttRes.json?.data?.record;
    assert.equal(
      verifiedRecord.verificationStatus,
      'verified',
      'Scenario 5: Status must be verified',
    );
    assert.equal(verifiedRecord.verifiedHours, 3.5, 'Scenario 5: Verified hours must be 3.5');

    // -------------------------------------------------------------------------
    // Scenario 6: Rejection requires remarks, and a rejected record can be corrected
    // -------------------------------------------------------------------------
    // 6a: Rejection without remarks must fail validation
    const rejWithoutRemarksRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/attendance/${att1Id}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          verificationStatus: 'rejected',
          verifiedHours: 0,
        },
      },
    );
    assert.equal(
      rejWithoutRemarksRes.status,
      400,
      'Scenario 6a: Rejecting attendance without remarks must return 400',
    );
    assert.equal(
      rejWithoutRemarksRes.json?.error?.code,
      'VALIDATION_ERROR',
      'Scenario 6a: Error code must be VALIDATION_ERROR',
    );

    // 6b: Valid rejection with remarks
    const rejWithRemarksRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/attendance/${att1Id}`,
      {
        method: 'PATCH',
        session: coordSession,
        body: {
          verificationStatus: 'rejected',
          verifiedHours: 0,
          remarks: 'Time card missing departure signature',
        },
      },
    );
    assert.equal(
      rejWithRemarksRes.status,
      200,
      'Scenario 6b: Valid rejection with remarks must return 200',
    );
    const rejectedRecord = rejWithRemarksRes.json?.data?.record;
    assert.equal(
      rejectedRecord.verificationStatus,
      'rejected',
      'Scenario 6b: Status must be rejected',
    );
    assert.equal(rejectedRecord.verifiedHours, 0, 'Scenario 6b: Verified hours must reset to 0');

    // 6c: Correction back to verified status
    const correctBackRes = await apiFetch(baseUrl, `/api/v1/coordinator/attendance/${att1Id}`, {
      method: 'PATCH',
      session: coordSession,
      body: {
        verificationStatus: 'verified',
        verifiedHours: 3.0,
        remarks: 'Corrected after signed departure sheet produced',
      },
    });
    assert.equal(
      correctBackRes.status,
      200,
      'Scenario 6c: Correcting back to verified must return 200',
    );
    const correctedRecord = correctBackRes.json?.data?.record;
    assert.equal(
      correctedRecord.verificationStatus,
      'verified',
      'Scenario 6c: Status must return to verified',
    );
    assert.equal(
      correctedRecord.verifiedHours,
      3.0,
      'Scenario 6c: Corrected verified hours must equal 3.0',
    );

    // -------------------------------------------------------------------------
    // Scenario 7: Service-hour aggregation includes verified hours and excludes absent/pending
    // -------------------------------------------------------------------------
    const hoursSummaryRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/service-hours?studentId=${stu1Id}`,
      {
        method: 'GET',
        session: coordSession,
      },
    );
    assert.equal(
      hoursSummaryRes.status,
      200,
      'Scenario 7: Coordinator service-hours query must return 200',
    );
    const studentHours = hoursSummaryRes.json?.data?.students?.find(
      (s: { studentId: number }) => s.studentId === stu1Id,
    );
    assert.ok(studentHours, 'Scenario 7: Student ledger entry must be returned');
    assert.equal(
      studentHours.verifiedAttendanceHours,
      3.0,
      'Scenario 7: Verified attendance hours must equal 3.0',
    );
    assert.equal(
      studentHours.totalCreditedHours,
      3.0,
      'Scenario 7: Total credited hours must match verified attendance',
    );
    assert.equal(
      studentHours.verifiedSessionCount,
      1,
      'Scenario 7: Verified session count must be exactly 1',
    );

    // -------------------------------------------------------------------------
    // Scenario 8: Auth, role, and CSRF protection enforcement
    // -------------------------------------------------------------------------
    // 8a: Missing CSRF token rejected
    const missingCsrfRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: coordSession,
      omitCsrf: true,
      body: {
        applicationId: app1Id,
        taskSessionId: sess1Id,
        recordedHours: 1.0,
      },
    });
    assert.equal(
      missingCsrfRes.status,
      403,
      'Scenario 8a: Missing CSRF token on POST must return 403',
    );
    assert.equal(
      missingCsrfRes.json?.error?.code,
      'CSRF_INVALID',
      'Scenario 8a: Error code must be CSRF_INVALID',
    );

    // 8b: Student role denied access to coordinator attendance endpoint
    const studentRoleDenialRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      session: stu1Session,
      body: {
        applicationId: app1Id,
        taskSessionId: sess1Id,
        recordedHours: 1.0,
      },
    });
    assert.equal(
      studentRoleDenialRes.status,
      403,
      'Scenario 8b: Student role attempting coordinator attendance must return 403',
    );
    assert.ok(
      studentRoleDenialRes.json?.error?.code === 'ROLE_UNAUTHORIZED' ||
        studentRoleDenialRes.json?.error?.code === 'FORBIDDEN',
      'Scenario 8b: Error code must reflect role denial',
    );

    // 8c: Unauthenticated request rejected
    const unauthenticatedRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
      method: 'POST',
      body: {
        applicationId: app1Id,
        taskSessionId: sess1Id,
        recordedHours: 1.0,
      },
    });
    assert.equal(
      unauthenticatedRes.status,
      401,
      'Scenario 8c: Unauthenticated attendance request must return 401',
    );
    assert.equal(
      unauthenticatedRes.json?.error?.code,
      'UNAUTHENTICATED',
      'Scenario 8c: Error code must be UNAUTHENTICATED',
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
        // Recover any 201-created student fixture that was not tracked in time.
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
          if (!tracked.studentIds.includes(recovered.studentId)) {
            tracked.studentIds.push(recovered.studentId);
          }
          if (!tracked.userIds.includes(recovered.userId)) {
            tracked.userIds.push(recovered.userId);
          }
        }

        const appIds = tracked.applicationIds;
        const sessIds = tracked.sessionIds;
        const taskIds = tracked.taskIds;
        const catIds = tracked.taskCategoryIds;
        const stuIds = tracked.studentIds;
        const uIds = tracked.userIds;

        if (appIds.length > 0) {
          await query(`DELETE FROM service_hour_adjustments WHERE application_id = ANY($1::bigint[])`, [appIds]);
          await query(`DELETE FROM attendance WHERE application_id = ANY($1::bigint[])`, [appIds]);
          await query(
            `DELETE FROM accomplishment_reviews WHERE submission_id IN (
               SELECT id FROM accomplishment_submissions WHERE accomplishment_id IN (
                 SELECT id FROM accomplishments WHERE application_id = ANY($1::bigint[])
               )
             )`,
            [appIds],
          );
          await query(
            `DELETE FROM evidence_images WHERE submission_id IN (
               SELECT id FROM accomplishment_submissions WHERE accomplishment_id IN (
                 SELECT id FROM accomplishments WHERE application_id = ANY($1::bigint[])
               )
             )`,
            [appIds],
          );
          await query(
            `DELETE FROM accomplishment_submissions WHERE accomplishment_id IN (
               SELECT id FROM accomplishments WHERE application_id = ANY($1::bigint[])
             )`,
            [appIds],
          );
          await query(`DELETE FROM accomplishments WHERE application_id = ANY($1::bigint[])`, [appIds]);
          await query(`DELETE FROM application_reviews WHERE application_id = ANY($1::bigint[])`, [appIds]);
          await query(`DELETE FROM task_applications WHERE id = ANY($1::bigint[])`, [appIds]);
        }

        if (sessIds.length > 0) {
          await query(`DELETE FROM attendance WHERE task_session_id = ANY($1::bigint[])`, [sessIds]);
          await query(`DELETE FROM task_sessions WHERE id = ANY($1::bigint[])`, [sessIds]);
        }

        if (taskIds.length > 0) {
          await query(`DELETE FROM task_target_sections WHERE task_id = ANY($1::bigint[])`, [taskIds]);
          await query(`DELETE FROM task_target_students WHERE task_id = ANY($1::bigint[])`, [taskIds]);
          await query(`DELETE FROM tasks WHERE id = ANY($1::bigint[])`, [taskIds]);
        }

        if (catIds.length > 0) {
          await query(`DELETE FROM task_categories WHERE id = ANY($1::bigint[])`, [catIds]);
        }

        if (stuIds.length > 0) {
          await query(`DELETE FROM student_section_history WHERE student_id = ANY($1::bigint[])`, [stuIds]);
          await query(`DELETE FROM students WHERE id = ANY($1::bigint[])`, [stuIds]);
        }

        if (uIds.length > 0) {
          await query(`DELETE FROM notifications WHERE user_id = ANY($1::bigint[])`, [uIds]);
          await query(`DELETE FROM audit_logs WHERE user_id = ANY($1::bigint[])`, [uIds]);
          await query(`DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])`, [uIds]);
          await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [uIds]);
        }
      } catch (cleanErr) {
        cleanupError = cleanErr;
        console.error('[CLEANUP_FAILURE] Error during test teardown cleanup:', cleanErr, {
          studentFixtures: studentFixtures.map((fixture) => ({
            studentNumber: fixture.studentNumber,
            email: fixture.email,
            studentId: fixture.studentId,
            userId: fixture.userId,
          })),
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
