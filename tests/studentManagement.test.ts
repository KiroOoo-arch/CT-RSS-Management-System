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

function readId(res: { json: Record<string, any> | null }, ...path: string[]): number {
  let cur: any = res.json;
  for (const key of path) {
    cur = cur?.[key];
  }
  const id = toPositiveSafeId(cur);
  assert.ok(id !== null, `Expected positive id at ${path.join('.')}, got ${String(cur)}`);
  return id;
}

function expectStatus(
  res: { status: number; bodyText: string },
  expected: number,
  label: string,
): void {
  assert.equal(
    res.status,
    expected,
    `${label}: expected ${expected}, got ${res.status}. Body: ${res.bodyText.slice(0, 500)}`,
  );
}

function expectError(
  res: { status: number; json: Record<string, any> | null; bodyText: string },
  expectedStatus: number,
  expectedCodes: string | string[],
  label: string,
): void {
  const codes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  assert.equal(
    res.status,
    expectedStatus,
    `${label}: expected status ${expectedStatus}, got ${res.status}. Body: ${res.bodyText.slice(0, 500)}`,
  );
  const code = String(res.json?.error?.code ?? res.json?.code ?? '');
  assert.ok(
    codes.includes(code),
    `${label}: expected error code in [${codes.join(', ')}], got "${code}".`,
  );
}

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

test('Student Management Automated Test Suite', async () => {
  const app = await createApp({ enableVite: false });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  assert.ok(address && typeof address === 'object', 'Ephemeral test server failed to bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const tracked = {
    userIds: [] as number[],
    studentIds: [] as number[],
    academicYearIds: [] as number[],
    programIds: [] as number[],
    sectionIds: [] as number[],
  };

  const studentFixtures: TrackedStudentFixture[] = [];
  let isolationVerified = false;
  let testError: unknown = null;
  let cleanupError: unknown = null;

  const trackId = (arr: number[], id: number | null) => {
    if (id !== null && !arr.includes(id)) arr.push(id);
  };

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
        `[CLEANUP_FAILURE] Student 201 response lacked ids: studentNumber=${fixture.studentNumber} email=${fixture.email}`,
      );
    }
    fixture.studentId = recovered.studentId;
    fixture.userId = recovered.userId;
    trackId(tracked.studentIds, recovered.studentId);
    trackId(tracked.userIds, recovered.userId);
    throw new Error(
      `Student creation returned 201 without expected ids; recovered for cleanup: ${fixture.studentNumber}`,
    );
  };

  try {
    // Identity gate
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

    // Seeded prerequisites
    const collegeRes = await query<{ id: number }>(
      `SELECT id FROM colleges WHERE code = 'CT' AND is_active = TRUE LIMIT 1`,
    );
    const collegeId = toPositiveSafeId(collegeRes.rows[0]?.id);
    assert.ok(collegeId !== null, 'Seeded active CT college is required.');

    const yearLevelRes = await query<{ id: number }>(
      `SELECT id FROM year_levels ORDER BY id LIMIT 1`,
    );
    const yearLevelId = toPositiveSafeId(yearLevelRes.rows[0]?.id);
    assert.ok(yearLevelId !== null, 'At least one seeded year level is required.');

    // Academic fixtures
    const suffix = uniqueSuffix;
    const academicSuffix = `${Date.now().toString(36).slice(-8)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const ayName = `SM AY ${academicSuffix}`;
    const programCode = `SMP${academicSuffix.toUpperCase()}`;
    const programName = `SM Program ${suffix}`;
    const sectionAName = `SM Section A ${suffix}`;
    const sectionBName = `SM Section B ${suffix}`;

    const ayInsert = await query<{ id: number }>(
      `INSERT INTO academic_years (name, start_date, end_date, is_current)
       VALUES ($1, '2026-06-01', '2027-05-31', FALSE)
       RETURNING id`,
      [ayName],
    );
    const academicYearId = toPositiveSafeId(ayInsert.rows[0]?.id);
    assert.ok(academicYearId !== null);
    trackId(tracked.academicYearIds, academicYearId);

    const progInsert = await query<{ id: number }>(
      `INSERT INTO programs (college_id, code, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [collegeId, programCode, programName],
    );
    const programId = toPositiveSafeId(progInsert.rows[0]?.id);
    assert.ok(programId !== null);
    trackId(tracked.programIds, programId);

    const secAInsert = await query<{ id: number }>(
      `INSERT INTO sections (program_id, year_level_id, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [programId, yearLevelId, sectionAName],
    );
    const sectionA = toPositiveSafeId(secAInsert.rows[0]?.id);
    assert.ok(sectionA !== null);
    trackId(tracked.sectionIds, sectionA);

    const secBInsert = await query<{ id: number }>(
      `INSERT INTO sections (program_id, year_level_id, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [programId, yearLevelId, sectionBName],
    );
    const sectionB = toPositiveSafeId(secBInsert.rows[0]?.id);
    assert.ok(sectionB !== null);
    trackId(tracked.sectionIds, sectionB);

    // Coordinator
    const coordEmail = `coord_sm_${suffix}@ctrss.test`;
    const coordPassword = 'CoordPassword#2026!';
    const coordHash = await hashPassword(coordPassword);
    const coordInsert = await query<{ id: number }>(
      `INSERT INTO users (name, email, password, account_status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [`SM Coordinator ${suffix}`, coordEmail, coordHash],
    );
    const coordUserId = toPositiveSafeId(coordInsert.rows[0]?.id);
    assert.ok(coordUserId !== null);
    trackId(tracked.userIds, coordUserId);
    await query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       SELECT $1, id, $1 FROM roles WHERE name = 'RSS Coordinator' LIMIT 1`,
      [coordUserId],
    );
    const coordLogin = await loginAs(baseUrl, coordEmail, coordPassword);
    assert.equal(coordLogin.status, 200, 'Coordinator login must succeed');
    const coordSession = coordLogin.session;
    assert.ok(coordSession.csrfToken.length > 10);

    const stuPassword = 'StudentPass#2026!';

    const createStudent = async (input: {
      studentNumber: string;
      email: string;
      sectionId: number;
      label: string;
    }) => {
      const res = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
        method: 'POST',
        session: coordSession,
        body: {
          studentNumber: input.studentNumber,
          firstName: input.label,
          lastName: 'Tester',
          email: input.email,
          password: stuPassword,
          accountStatus: 'active',
          sectionId: input.sectionId,
          academicYearId: academicYearId,
        },
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
      assert.ok(ids.studentId > 0 && ids.userId > 0);
      return { ...ids, studentNumber: input.studentNumber, email: input.email, password: stuPassword };
    };

    const stu1 = await createStudent({
      studentNumber: `SM-${suffix}-1`,
      email: `stu1_sm_${suffix}@ctrss.test`,
      sectionId: sectionA,
      label: 'StudentOne',
    });
    const stu2 = await createStudent({
      studentNumber: `SM-${suffix}-2`,
      email: `stu2_sm_${suffix}@ctrss.test`,
      sectionId: sectionA,
      label: 'StudentTwo',
    });
    const stu3 = await createStudent({
      studentNumber: `SM-${suffix}-3`,
      email: `stu3_sm_${suffix}@ctrss.test`,
      sectionId: sectionB,
      label: 'StudentThree',
    });

    // Login student 1
    const stu1Login = await loginAs(baseUrl, stu1.email, stu1.password);
    assert.equal(stu1Login.status, 200, 'Student 1 login must succeed');
    const stu1Session = stu1Login.session;

    // -------------------------------------------------------------------------
    // 1. Creation validation
    // -------------------------------------------------------------------------
    const weakPwRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: `SM-${suffix}-WP`,
        firstName: 'Weak',
        lastName: 'Pw',
        email: `wp_sm_${suffix}@ctrss.test`,
        password: 'short',
        accountStatus: 'active',
      },
    });
    expectError(weakPwRes, 400, 'WEAK_PASSWORD', 'Weak password rejected');

    const badEmailRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: `SM-${suffix}-BE`,
        firstName: 'Bad',
        lastName: 'Email',
        email: 'not-an-email',
        password: stuPassword,
        accountStatus: 'active',
      },
    });
    expectError(badEmailRes, 400, 'VALIDATION_ERROR', 'Invalid email rejected');

    const shortNumRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: 'AB',
        firstName: 'Short',
        lastName: 'Num',
        email: `shortnum_sm_${suffix}@ctrss.test`,
        password: stuPassword,
        accountStatus: 'active',
      },
    });
    expectError(shortNumRes, 400, 'VALIDATION_ERROR', 'Short student number rejected');

    const missingAyRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: `SM-${suffix}-MA`,
        firstName: 'Missing',
        lastName: 'Ay',
        email: `missingay_sm_${suffix}@ctrss.test`,
        password: stuPassword,
        accountStatus: 'active',
        sectionId: sectionA,
      },
    });
    expectError(missingAyRes, 400, 'ACADEMIC_YEAR_REQUIRED', 'Missing AY rejected');

    const missingSectionRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: `SM-${suffix}-MS`,
        firstName: 'Missing',
        lastName: 'Section',
        email: `missingsec_sm_${suffix}@ctrss.test`,
        password: stuPassword,
        accountStatus: 'active',
        sectionId: 999999999,
        academicYearId: academicYearId,
      },
    });
    expectError(missingSectionRes, 404, 'SECTION_NOT_FOUND', 'Unknown section rejected');

    const missingAy2Res = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: `SM-${suffix}-MA2`,
        firstName: 'Missing',
        lastName: 'Ay2',
        email: `missingay2_sm_${suffix}@ctrss.test`,
        password: stuPassword,
        accountStatus: 'active',
        sectionId: sectionA,
        academicYearId: 999999999,
      },
    });
    expectError(missingAy2Res, 404, 'ACADEMIC_YEAR_NOT_FOUND', 'Unknown AY rejected');

    // -------------------------------------------------------------------------
    // 2. Uniqueness (case-variant)
    // -------------------------------------------------------------------------
    const dupNumRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: stu1.studentNumber.toUpperCase(),
        firstName: 'Dup',
        lastName: 'Num',
        email: `dupnum_sm_${suffix}@ctrss.test`,
        password: stuPassword,
        accountStatus: 'active',
      },
    });
    expectError(dupNumRes, 409, 'STUDENT_NUMBER_EXISTS', 'Duplicate student number rejected');

    const dupEmailRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: `SM-${suffix}-DE`,
        firstName: 'Dup',
        lastName: 'Email',
        email: stu1.email.toUpperCase(),
        password: stuPassword,
        accountStatus: 'active',
      },
    });
    expectError(dupEmailRes, 409, 'EMAIL_EXISTS', 'Duplicate email rejected');

    // Update keeps own values
    const selfUpdateRes = await apiFetch(baseUrl, `/api/v1/coordinator/students/${stu1.studentId}`, {
      method: 'PATCH',
      session: coordSession,
      body: {
        studentNumber: stu1.studentNumber,
        firstName: 'StudentOne',
        lastName: 'Tester',
        email: stu1.email,
      },
    });
    expectStatus(selfUpdateRes, 200, 'Self-update with same values');

    // -------------------------------------------------------------------------
    // 3. Listing / search / filters / pagination
    // -------------------------------------------------------------------------
    const listRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students?search=${encodeURIComponent(stu1.studentNumber)}&page=1&pageSize=5`,
      { session: coordSession },
    );
    expectStatus(listRes, 200, 'Student list search');
    const listed = listRes.json?.data?.students ?? [];
    assert.ok(
      listed.some((s: any) => Number(s.studentId) === stu1.studentId),
      'Search must return the matching student',
    );
    assert.ok(Number(listRes.json?.data?.total) >= 1);

    const filterRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students?sectionId=${sectionA}&registrationStatus=approved&accountStatus=active&page=1&pageSize=2`,
      { session: coordSession },
    );
    expectStatus(filterRes, 200, 'Student list filters');
    const filtered = filterRes.json?.data?.students ?? [];
    assert.ok(filtered.every((s: any) => s.accountStatus === 'active'));
    assert.ok(filtered.every((s: any) => s.registrationStatus === 'approved'));

    const invalidStatusRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students?accountStatus=bogus`,
      { session: coordSession },
    );
    expectError(invalidStatusRes, 400, 'INVALID_ACCOUNT_STATUS', 'Invalid account status filter');

    const invalidRegRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students?registrationStatus=bogus`,
      { session: coordSession },
    );
    expectError(invalidRegRes, 400, 'INVALID_REGISTRATION_STATUS', 'Invalid registration status filter');

    // SQLi search should not break
    const sqliRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students?search=${encodeURIComponent("'; DROP TABLE students; --")}`,
      { session: coordSession },
    );
    expectStatus(sqliRes, 200, 'SQLi search must not error');

    // -------------------------------------------------------------------------
    // 4. Student detail
    // -------------------------------------------------------------------------
    const detailRes = await apiFetch(baseUrl, `/api/v1/coordinator/students/${stu1.studentId}`, {
      session: coordSession,
    });
    expectStatus(detailRes, 200, 'Student detail');
    const detail = detailRes.json?.data?.student;
    assert.equal(Number(detail.studentId), stu1.studentId);
    assert.ok(Array.isArray(detail.sectionHistory));
    const currentRows = detail.sectionHistory.filter((h: any) => h.isCurrent === true);
    assert.equal(currentRows.length, 1, 'Detail must show exactly one current section');

    const notFoundRes = await apiFetch(baseUrl, `/api/v1/coordinator/students/999999999`, {
      session: coordSession,
    });
    expectError(notFoundRes, 404, 'STUDENT_NOT_FOUND', 'Unknown student detail');

    // -------------------------------------------------------------------------
    // 5. Section transfer rules
    // -------------------------------------------------------------------------
    // ALREADY_ASSIGNED: transfer stu1 to same section + AY
    const alreadyRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students/${stu1.studentId}/section-assignment`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sectionId: sectionA,
          academicYearId: academicYearId,
          effectiveDate: new Date().toISOString().slice(0, 10),
        },
      },
    );
    expectError(alreadyRes, 409, 'ALREADY_ASSIGNED', 'Same section+AY rejected');

    // Backdated before current enrollment
    const backdatedRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students/${stu1.studentId}/section-assignment`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sectionId: sectionB,
          academicYearId: academicYearId,
          effectiveDate: '2020-01-01',
        },
      },
    );
    expectError(backdatedRes, 400, 'INVALID_EFFECTIVE_DATE', 'Backdated transfer rejected');

    // Future date rejected
    const futureDate = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
    const futureRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students/${stu1.studentId}/section-assignment`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sectionId: sectionB,
          academicYearId: academicYearId,
          effectiveDate: futureDate,
        },
      },
    );
    expectError(futureRes, 400, 'INVALID_EFFECTIVE_DATE', 'Future transfer rejected');

    // AY range mismatch
    const ayMismatchRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students/${stu1.studentId}/section-assignment`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sectionId: sectionB,
          academicYearId: academicYearId,
          effectiveDate: '2025-01-01',
        },
      },
    );
    expectError(ayMismatchRes, 400, 'INVALID_EFFECTIVE_DATE', 'AY range mismatch rejected');

    // Successful transfer stu1 from A to B
    const today = new Date().toISOString().slice(0, 10);
    const transferRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students/${stu1.studentId}/section-assignment`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sectionId: sectionB,
          academicYearId: academicYearId,
          effectiveDate: today,
        },
      },
    );
    expectStatus(transferRes, 200, 'Transfer to section B');
    const transferredDetail = transferRes.json?.data?.student;
    const currentAfter = (transferredDetail?.sectionHistory ?? []).filter(
      (h: any) => h.isCurrent === true,
    );
    assert.equal(currentAfter.length, 1, 'Exactly one current section after transfer');
    assert.equal(Number(currentAfter[0].sectionId), sectionB);

    // Inactive section rejected
    // (deactivate section B first via direct SQL? avoid; instead use unknown/inactive via a temp section)
    // Create an inactive section to test
    const inactiveSecInsert = await query<{ id: number }>(
      `INSERT INTO sections (program_id, year_level_id, name, is_active)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id`,
      [programId, yearLevelId, `SM Inactive ${suffix}`],
    );
    const inactiveSecId = toPositiveSafeId(inactiveSecInsert.rows[0]?.id);
    assert.ok(inactiveSecId !== null);
    trackId(tracked.sectionIds, inactiveSecId);
    const inactiveSecRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/students/${stu2.studentId}/section-assignment`,
      {
        method: 'POST',
        session: coordSession,
        body: {
          sectionId: inactiveSecId,
          academicYearId: academicYearId,
          effectiveDate: today,
        },
      },
    );
    expectError(inactiveSecRes, 400, 'SECTION_INACTIVE', 'Inactive section rejected');

    // -------------------------------------------------------------------------
    // 6. Account status transitions
    // -------------------------------------------------------------------------
    // Student cannot access coordinator endpoint
    const forbiddenRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      session: stu1Session,
    });
    expectError(forbiddenRes, 403, ['ROLE_UNAUTHORIZED', 'FORBIDDEN'], 'Student denied coordinator list');

    // Unauthenticated
    const unauthRes = await apiFetch(baseUrl, '/api/v1/coordinator/students');
    expectError(unauthRes, 401, 'UNAUTHENTICATED', 'Unauthenticated list');

    // Missing CSRF on status change
    const noCsrfRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/users/${stu2.userId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        omitCsrf: true,
        body: { status: 'suspended', reason: 'test' },
      },
    );
    expectError(noCsrfRes, 403, 'CSRF_INVALID', 'Missing CSRF rejected');

    // Self-status lock
    const selfStatusRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${coordUserId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'deactivated', reason: 'self' },
    });
    expectError(selfStatusRes, 400, 'SELF_STATUS_LOCK', 'Self deactivation rejected');

    // Invalid status
    const invalidStatusRes2 = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/users/${stu2.userId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'bogus' },
      },
    );
    expectError(invalidStatusRes2, 400, 'INVALID_ACCOUNT_STATUS', 'Invalid status rejected');

    // Suspend stu2
    const suspendRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'suspended', reason: 'temporary' },
    });
    expectStatus(suspendRes, 200, 'Suspend student');

    // Suspended student cannot log in
    const suspendedLogin = await loginAs(baseUrl, stu2.email, stu2.password);
    assert.equal(suspendedLogin.status, 403, 'Suspended student login must be blocked');

    // Reactivate
    const reactivateRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'active', reason: 'done' },
    });
    expectStatus(reactivateRes, 200, 'Reactivate student');

    // Deactivate
    const deactivateRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'deactivated', reason: 'done' },
    });
    expectStatus(deactivateRes, 200, 'Deactivate student');

    // deactivated -> active (approved registration)
    const reactivateApprovedRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'active', reason: 'reactivate approved' },
    });
    expectStatus(reactivateApprovedRes, 200, 'Deactivated approved student reactivated');

    // approved student cannot be moved back to pending
    const pendingStatusRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'pending', reason: 'try pending' },
    });
    expectError(pendingStatusRes, 400, 'INVALID_ACCOUNT_STATUS', 'Approved student cannot be pending');

    // active -> suspended
    const suspendAgainRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'suspended', reason: 'temp' },
    });
    expectStatus(suspendAgainRes, 200, 'Suspend again');

    // suspended -> active
    const suspendedToActiveRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'active', reason: 'lift suspension' },
    });
    expectStatus(suspendedToActiveRes, 200, 'Suspended to active');

    // suspended -> deactivated
    const suspendForDeactRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'suspended', reason: 'temp2' },
    });
    expectStatus(suspendForDeactRes, 200, 'Suspend for deactivation');
    const suspendedToDeactivatedRes = await apiFetch(baseUrl, `/api/v1/coordinator/users/${stu2.userId}/status`, {
      method: 'PATCH',
      session: coordSession,
      body: { status: 'deactivated', reason: 'revoke' },
    });
    expectStatus(suspendedToDeactivatedRes, 200, 'Suspended to deactivated');

    // -------------------------------------------------------------------------
    // 7. Registration approval / rejection
    // -------------------------------------------------------------------------
    // Create a pending student via API
    const pendingNum = `SM-${suffix}-P`;
    const pendingEmail = `pending_sm_${suffix}@ctrss.test`;
    const pendingCreateRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: pendingNum,
        firstName: 'Pending',
        lastName: 'Student',
        email: pendingEmail,
        password: stuPassword,
        accountStatus: 'pending',
      },
    });
    expectStatus(pendingCreateRes, 201, 'Pending student creation');
    const pendingFixture: TrackedStudentFixture = {
      studentNumber: pendingNum,
      email: pendingEmail,
      studentId: null,
      userId: null,
    };
    studentFixtures.push(pendingFixture);
    const pendingIds = await registerStudentFixture(pendingFixture, pendingCreateRes.json);
    assert.ok(pendingIds.studentId > 0);

    // Pending cannot log in
    const pendingLogin = await loginAs(baseUrl, pendingEmail, stuPassword);
    assert.equal(pendingLogin.status, 403, 'Pending student login must be blocked');

    // Reject registration
    const rejectRegRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/registrations/${pendingIds.studentId}/decision`,
      {
        method: 'POST',
        session: coordSession,
        body: { decision: 'rejected', remarks: 'not eligible' },
      },
    );
    expectStatus(rejectRegRes, 200, 'Reject registration');
    assert.equal(rejectRegRes.json?.data?.registrationStatus, 'rejected');

    // Rejected cannot log in
    const rejectedLogin = await loginAs(baseUrl, pendingEmail, stuPassword);
    assert.equal(rejectedLogin.status, 403, 'Rejected student login must be blocked');

    // ALREADY_REVIEWED on second decision
    const secondDecisionRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/registrations/${pendingIds.studentId}/decision`,
      {
        method: 'POST',
        session: coordSession,
        body: { decision: 'approved' },
      },
    );
    expectError(secondDecisionRes, 409, 'ALREADY_REVIEWED', 'Second decision rejected');

    // Rejected registration cannot be reactivated via account status
    const reactivateRejectedRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/users/${pendingIds.userId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'active', reason: 'try' },
      },
    );
    expectError(reactivateRejectedRes, 409, 'REGISTRATION_REJECTED', 'Rejected reactivation blocked');

    // Approved registration flow
    const approvedNum = `SM-${suffix}-A`;
    const approvedEmail = `approved_sm_${suffix}@ctrss.test`;
    const approvedCreateRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
      method: 'POST',
      session: coordSession,
      body: {
        studentNumber: approvedNum,
        firstName: 'Approved',
        lastName: 'Student',
        email: approvedEmail,
        password: stuPassword,
        accountStatus: 'pending',
      },
    });
    expectStatus(approvedCreateRes, 201, 'Pending-for-approval student creation');
    const approvedFixture: TrackedStudentFixture = {
      studentNumber: approvedNum,
      email: approvedEmail,
      studentId: null,
      userId: null,
    };
    studentFixtures.push(approvedFixture);
    const approvedIds = await registerStudentFixture(approvedFixture, approvedCreateRes.json);
    assert.ok(approvedIds.studentId > 0);

    // Pending account cannot be activated via status endpoint (before approval)
    const pendingActivateRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/users/${approvedIds.userId}/status`,
      {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'active', reason: 'try' },
      },
    );
    expectError(pendingActivateRes, 409, 'REGISTRATION_PENDING', 'Pending activation blocked');

    const approveRegRes = await apiFetch(
      baseUrl,
      `/api/v1/coordinator/registrations/${approvedIds.studentId}/decision`,
      {
        method: 'POST',
        session: coordSession,
        body: { decision: 'approved' },
      },
    );
    expectStatus(approveRegRes, 200, 'Approve registration');
    assert.equal(approveRegRes.json?.data?.registrationStatus, 'approved');

    const approvedLogin = await loginAs(baseUrl, approvedEmail, stuPassword);
    assert.equal(approvedLogin.status, 200, 'Approved student login must succeed');

    // Student self profile
    const profileRes = await apiFetch(baseUrl, '/api/v1/student/profile', {
      session: stu1Session,
    });
    expectStatus(profileRes, 200, 'Student self profile');

    // Ownership: student cannot access another student's profile
    const otherProfileRes = await apiFetch(baseUrl, `/api/v1/students/${stu2.studentId}/profile`, {
      session: stu1Session,
    });
    expectError(otherProfileRes, 403, 'FORBIDDEN', 'IDOR profile blocked');

    // Coordinator can access
    const coordProfileRes = await apiFetch(baseUrl, `/api/v1/students/${stu1.studentId}/profile`, {
      session: coordSession,
    });
    expectStatus(coordProfileRes, 200, 'Coordinator profile access');
  } catch (err) {
    testError = err;
  } finally {
    if (isolationVerified) {
      try {
        for (const fixture of studentFixtures) {
          if (fixture.studentId !== null && fixture.userId !== null) continue;
          const recovered = await recoverStudentFixture(fixture);
          if (!recovered) {
            console.error(
              `[CLEANUP_FAILURE] Unable to identify test student: studentNumber=${fixture.studentNumber} email=${fixture.email}`,
            );
            continue;
          }
          fixture.studentId = recovered.studentId;
          fixture.userId = recovered.userId;
          trackId(tracked.studentIds, recovered.studentId);
          trackId(tracked.userIds, recovered.userId);
        }

        const stuIds = tracked.studentIds;
        const uIds = tracked.userIds;
        const ayIds = tracked.academicYearIds;
        const progIds = tracked.programIds;
        const secIds = tracked.sectionIds;

        // Notifications addressed to test users or referencing test-created students
        if (uIds.length > 0 || stuIds.length > 0) {
          const conditions: string[] = [];
          const params: unknown[] = [];
          if (uIds.length > 0) {
            params.push(uIds);
            conditions.push(`user_id = ANY($${params.length}::bigint[])`);
          }
          if (stuIds.length > 0) {
            params.push(stuIds);
            conditions.push(
              `(related_id = ANY($${params.length}::bigint[]) AND ` +
                `related_type IN ('students', 'student_section_history'))`,
            );
          }
          await query(`DELETE FROM notifications WHERE ${conditions.join(' OR ')}`, params);
        }
        // Audit logs authored by test users or describing test students
        if (uIds.length > 0 || stuIds.length > 0) {
          const conditions: string[] = [];
          const params: unknown[] = [];
          if (uIds.length > 0) {
            params.push(uIds);
            conditions.push(`user_id = ANY($${params.length}::bigint[])`);
          }
          if (stuIds.length > 0) {
            params.push(stuIds);
            conditions.push(
              `(subject_id = ANY($${params.length}::bigint[]) AND ` +
                `subject_type IN ('students', 'student_section_history'))`,
            );
          }
          await query(`DELETE FROM audit_logs WHERE ${conditions.join(' OR ')}`, params);
        }
        // Student section history + students
        if (stuIds.length > 0) {
          await query(`DELETE FROM student_section_history WHERE student_id = ANY($1::bigint[])`, [stuIds]);
          await query(`DELETE FROM students WHERE id = ANY($1::bigint[])`, [stuIds]);
        }
        // Sections, programs, academic years
        if (secIds.length > 0) {
          await query(`DELETE FROM sections WHERE id = ANY($1::bigint[])`, [secIds]);
        }
        if (progIds.length > 0) {
          await query(`DELETE FROM programs WHERE id = ANY($1::bigint[])`, [progIds]);
        }
        if (ayIds.length > 0) {
          await query(`DELETE FROM academic_years WHERE id = ANY($1::bigint[])`, [ayIds]);
        }
        // User roles + users
        if (uIds.length > 0) {
          await query(`DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])`, [uIds]);
          await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [uIds]);
        }
      } catch (cleanErr) {
        cleanupError = cleanErr;
        console.error('[CLEANUP_FAILURE] Error during teardown:', cleanErr);
      }
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (testError) throw testError;
    if (cleanupError) throw new Error(`Test assertions passed, but cleanup failed: ${String(cleanupError)}`);
  }
});
