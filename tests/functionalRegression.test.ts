import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.ts';
import {
  closeDatabasePool,
  query,
  runWithRollbackTransaction,
} from '../src/server/config/database.ts';
import {
  bootstrapRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
} from '../src/server/middleware/rateLimit.ts';
import { hashPassword } from '../src/server/utils/password.ts';

interface ApiClientSession {
  cookieHeader: string;
  csrfToken: string;
}

function extractCookiesFromHeaders(headers: Headers): Record<string, string> {
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawList = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [];
  const cookies: Record<string, string> = {};
  for (const raw of rawList) {
    const firstSegment = raw.split(';')[0] ?? '';
    const eqIndex = firstSegment.indexOf('=');
    if (eqIndex > 0) {
      const name = firstSegment.slice(0, eqIndex).trim();
      const val = firstSegment.slice(eqIndex + 1).trim();
      cookies[name] = val;
    }
  }
  return cookies;
}

async function apiFetch(
  baseUrl: string,
  routePath: string,
  options?: {
    method?: string;
    body?: unknown;
    session?: ApiClientSession;
    omitCsrf?: boolean;
    extraHeaders?: Record<string, string>;
  },
): Promise<{
  status: number;
  headers: Headers;
  json: Record<string, any> | null;
  buffer: Buffer;
}> {
  const headers: Record<string, string> = {
    ...(options?.extraHeaders ?? {}),
  };
  if (options?.session?.cookieHeader) {
    headers.cookie = options.session.cookieHeader;
  }
  if (options?.session?.csrfToken && !options?.omitCsrf) {
    headers['x-csrf-token'] = options.session.csrfToken;
  }
  let body: string | undefined;
  if (options?.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`${baseUrl}${routePath}`, {
    method: options?.method ?? 'GET',
    headers,
    body,
  });

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const contentType = res.headers.get('content-type') ?? '';
  let json: Record<string, any> | null = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(buffer.toString('utf8')) as Record<string, any>;
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, json, buffer };
}

async function loginAs(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{
  status: number;
  json: Record<string, any> | null;
  session: ApiClientSession;
  rawSetCookies: string[];
}> {
  const res = await apiFetch(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawSetCookies = typeof getSetCookie === 'function' ? getSetCookie.call(res.headers) : [];
  const parsed = extractCookiesFromHeaders(res.headers);
  const cookieHeader = Object.entries(parsed)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const csrfToken = String(res.json?.data?.csrfToken ?? parsed.ct_rss_csrf ?? '');
  return {
    status: res.status,
    json: res.json,
    session: { cookieHeader, csrfToken },
    rawSetCookies,
  };
}

async function snapshotStorageFiles(): Promise<Set<string>> {
  const storageRoot = path.resolve(process.cwd(), 'storage');
  const collected = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        collected.add(full);
      }
    }
  }
  await walk(storageRoot);
  return collected;
}

async function cleanupNewStorageFiles(beforeSnapshot: Set<string>): Promise<void> {
  const afterSnapshot = await snapshotStorageFiles();
  for (const filePath of afterSnapshot) {
    if (!beforeSnapshot.has(filePath)) {
      await fs.unlink(filePath).catch(() => undefined);
    }
  }
  // Remove any empty test submission directories under storage/evidence
  const evidenceRoot = path.resolve(process.cwd(), 'storage', 'evidence');
  try {
    const dirs = await fs.readdir(evidenceRoot, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const fullDir = path.join(evidenceRoot, dir.name);
        const contents = await fs.readdir(fullDir);
        if (contents.length === 0) {
          await fs.rmdir(fullDir).catch(() => undefined);
        }
      }
    }
  } catch {
    // ignore missing evidence directory
  }
}

async function snapshotProductionCounts(): Promise<{
  tableCount: number;
  counts: Record<string, number>;
}> {
  const tablesRes = await query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name ASC`,
  );
  const counts: Record<string, number> = {};
  for (const row of tablesRes.rows) {
    const countRes = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM "${row.table_name}"`,
    );
    counts[row.table_name] = Number.parseInt(countRes.rows[0]?.cnt ?? '0', 10);
  }
  return { tableCount: tablesRes.rows.length, counts };
}

const VALID_PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]).toString('base64');

const VALID_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]).toString('base64');

const SPOOFED_PNG_BASE64 = Buffer.from('MZ_NOT_REALLY_A_PNG_EXECUTABLE_TEST').toString('base64');

test.after(async () => {
  await closeDatabasePool().catch(() => undefined);
});

test('CT-RSS End-to-End Functional, Security, RBAC, Report PDF, and Zero-Persistence Suite', async () => {
  const baselineBefore = await snapshotProductionCounts();
  assert.equal(baselineBefore.tableCount, 28, 'Database must have exactly 28 approved tables');

  const storageBefore = await snapshotStorageFiles();

  const app = await createApp({ enableVite: false });

  try {
    await runWithRollbackTransaction(async () => {
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      assert.ok(address && typeof address === 'object', 'Ephemeral HTTP server failed to bind');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      try {
        loginRateLimiter.reset();
        registerRateLimiter.reset();
        bootstrapRateLimiter.reset();

      // -----------------------------------------------------------------------
      // 1. Public Endpoints & Unauthenticated Protections
      // -----------------------------------------------------------------------
      const healthRes = await apiFetch(baseUrl, '/api/v1/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.json?.success, true);
      assert.equal(healthRes.json?.data?.database?.actualTableCount, 28);

      const foundationRes = await apiFetch(baseUrl, '/api/v1/system/foundation');
      assert.equal(foundationRes.status, 200);
      assert.equal(foundationRes.json?.data?.initialScope, 'College of Technology');
      assert.equal(foundationRes.json?.data?.database?.actualTableCount, 28);

      const notFoundApiRes = await apiFetch(baseUrl, '/api/v1/does-not-exist');
      assert.equal(notFoundApiRes.status, 404);
      assert.equal(notFoundApiRes.json?.error?.code, 'NOT_FOUND');

      for (const protectedPath of [
        '/api/v1/auth/me',
        '/api/v1/coordinator/academic-years',
        '/api/v1/coordinator/task-categories',
        '/api/v1/coordinator/tasks',
        '/api/v1/student/tasks',
        '/api/v1/section-rep/overview',
        '/api/v1/reports/1/download',
        '/api/v1/evidence/1/file',
      ]) {
        const res = await apiFetch(baseUrl, protectedPath);
        assert.equal(res.status, 401, `${protectedPath} must reject unauthenticated requests`);
      }

      // -----------------------------------------------------------------------
      // 2. Seed Ephemeral Coordinator Inside Rollback-Only Test Transaction
      // -----------------------------------------------------------------------
      const testCoordinatorEmail = `qa.coordinator.${Date.now()}@ctrss.local.test`;
      const testCoordinatorPassword = 'TestCoord#2026Strong!';
      const coordHash = await hashPassword(testCoordinatorPassword);

      const coordInsertRes = await query<{ id: number }>(
        `INSERT INTO users (name, email, password, account_status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        ['QA Ephemeral Coordinator', testCoordinatorEmail, coordHash],
      );
      const testCoordinatorUserId = Number(coordInsertRes.rows[0]?.id);
      assert.ok(testCoordinatorUserId > 0);

      await query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by)
         SELECT $1, id, $1 FROM roles WHERE name = 'RSS Coordinator' LIMIT 1`,
        [testCoordinatorUserId],
      );

      // Invalid Coordinator Login -> 401
      const badLogin = await loginAs(baseUrl, testCoordinatorEmail, 'WrongPassword#999');
      assert.equal(badLogin.status, 401);

      // Valid Coordinator Login -> 200 + HttpOnly Cookie + CSRF
      const coordLogin = await loginAs(baseUrl, testCoordinatorEmail, testCoordinatorPassword);
      assert.equal(coordLogin.status, 200);
      assert.equal(coordLogin.json?.data?.user?.primaryRole, 'RSS Coordinator');
      const coordSession = coordLogin.session;
      assert.ok(
        coordLogin.rawSetCookies.some(
          (c) => c.startsWith('ct_rss_session=') && /httponly/i.test(c),
        ),
        'Session cookie must be HttpOnly',
      );
      assert.ok(coordSession.csrfToken.length > 10);

      // Verify /auth/me persists session
      const meRes = await apiFetch(baseUrl, '/api/v1/auth/me', { session: coordSession });
      assert.equal(meRes.status, 200);
      assert.equal(meRes.json?.data?.user?.email, testCoordinatorEmail);

      // Verify CSRF rejection when missing x-csrf-token on POST
      const missingCsrfRes = await apiFetch(baseUrl, '/api/v1/coordinator/academic-years', {
        method: 'POST',
        session: coordSession,
        omitCsrf: true,
        body: {
          name: '2099-2100',
          startDate: '2099-08-01',
          endDate: '2100-05-31',
          isCurrent: false,
        },
      });
      assert.equal(missingCsrfRes.status, 403);
      assert.equal(missingCsrfRes.json?.error?.code, 'CSRF_INVALID');

      // -----------------------------------------------------------------------
      // 3. Academic Years, Programs, Sections (CRUD + Validation + Constraints)
      // -----------------------------------------------------------------------
      const metaRes = await apiFetch(baseUrl, '/api/v1/coordinator/academic-metadata', {
        session: coordSession,
      });
      assert.equal(metaRes.status, 200);
      const ctCollegeId = Number(metaRes.json?.data?.colleges?.[0]?.id);
      const yearLevel1Id = Number(metaRes.json?.data?.yearLevels?.[0]?.id);
      const yearLevel2Id = Number(metaRes.json?.data?.yearLevels?.[1]?.id ?? yearLevel1Id);
      assert.ok(ctCollegeId > 0 && yearLevel1Id > 0);

      // Date validation (endDate before startDate) -> 400
      const invalidAyRes = await apiFetch(baseUrl, '/api/v1/coordinator/academic-years', {
        method: 'POST',
        session: coordSession,
        body: {
          name: '2026-2027-BAD',
          startDate: '2027-05-31',
          endDate: '2026-08-01',
          isCurrent: false,
        },
      });
      assert.equal(invalidAyRes.status, 400);

      const ay1Res = await apiFetch(baseUrl, '/api/v1/coordinator/academic-years', {
        method: 'POST',
        session: coordSession,
        body: {
          name: 'AY 2026-2027 QA',
          startDate: '2026-08-01',
          endDate: '2027-05-31',
          isCurrent: true,
        },
      });
      assert.equal(ay1Res.status, 201);
      const ay1Id = Number(ay1Res.json?.data?.academicYear?.id);
      assert.equal(ay1Res.json?.data?.academicYear?.isCurrent, true);

      // Duplicate AY -> 409
      const dupAyRes = await apiFetch(baseUrl, '/api/v1/coordinator/academic-years', {
        method: 'POST',
        session: coordSession,
        body: {
          name: 'AY 2026-2027 QA',
          startDate: '2026-08-01',
          endDate: '2027-05-31',
          isCurrent: false,
        },
      });
      assert.equal(dupAyRes.status, 409);

      // Second AY + set-current enforces single current invariant
      const ay2Res = await apiFetch(baseUrl, '/api/v1/coordinator/academic-years', {
        method: 'POST',
        session: coordSession,
        body: {
          name: 'AY 2027-2028 QA',
          startDate: '2027-08-01',
          endDate: '2028-05-31',
          isCurrent: false,
        },
      });
      assert.equal(ay2Res.status, 201);
      const ay2Id = Number(ay2Res.json?.data?.academicYear?.id);

      const setCurrRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/academic-years/${ay2Id}/set-current`,
        { method: 'POST', session: coordSession },
      );
      assert.equal(setCurrRes.status, 200);

      const listAyRes = await apiFetch(baseUrl, '/api/v1/coordinator/academic-years', {
        session: coordSession,
      });
      const currentYears = (listAyRes.json?.data?.academicYears ?? []).filter(
        (ay: { isCurrent: boolean }) => ay.isCurrent,
      );
      assert.equal(currentYears.length, 1, 'Exactly one academic year must be marked current');
      assert.equal(Number(currentYears[0].id), ay2Id);

      // Restore ay1Id as current for active test operations
      await apiFetch(baseUrl, `/api/v1/coordinator/academic-years/${ay1Id}/set-current`, {
        method: 'POST',
        session: coordSession,
      });

      // Programs CRUD
      const progRes = await apiFetch(baseUrl, '/api/v1/coordinator/programs', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          code: 'BSINDTECH-QA',
          name: 'BS Industrial Technology QA',
          isActive: true,
        },
      });
      assert.equal(progRes.status, 201);
      const programId = Number(progRes.json?.data?.program?.id);

      const dupProgRes = await apiFetch(baseUrl, '/api/v1/coordinator/programs', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          code: 'BSINDTECH-QA',
          name: 'Duplicate Program',
          isActive: true,
        },
      });
      assert.equal(dupProgRes.status, 409);

      const editProgRes = await apiFetch(baseUrl, `/api/v1/coordinator/programs/${programId}`, {
        method: 'PATCH',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          code: 'BSINDTECH-QA',
          name: 'BS Industrial Technology QA Edited',
          isActive: true,
        },
      });
      assert.equal(editProgRes.status, 200);
      assert.equal(editProgRes.json?.data?.program?.name, 'BS Industrial Technology QA Edited');

      // Sections A & B CRUD
      const secARes = await apiFetch(baseUrl, '/api/v1/coordinator/sections', {
        method: 'POST',
        session: coordSession,
        body: { programId, yearLevelId: yearLevel1Id, name: 'QA-A', isActive: true },
      });
      assert.equal(secARes.status, 201);
      const sectionAId = Number(secARes.json?.data?.section?.id);

      const secBRes = await apiFetch(baseUrl, '/api/v1/coordinator/sections', {
        method: 'POST',
        session: coordSession,
        body: { programId, yearLevelId: yearLevel2Id, name: 'QA-B', isActive: true },
      });
      assert.equal(secBRes.status, 201);
      const sectionBId = Number(secBRes.json?.data?.section?.id);

      // Duplicate section -> 409
      const dupSecRes = await apiFetch(baseUrl, '/api/v1/coordinator/sections', {
        method: 'POST',
        session: coordSession,
        body: { programId, yearLevelId: yearLevel1Id, name: 'QA-A', isActive: true },
      });
      assert.equal(dupSecRes.status, 409);

      // -----------------------------------------------------------------------
      // 4. Student Self-Registration, Pending Gate, Approval & Coordinator Student Creation
      // -----------------------------------------------------------------------
      const stu1Email = `qa.student1.${Date.now()}@ctrss.local.test`;
      const stu1Password = 'StudentPass#2026';
      const stu1Num = `CT-QA-${Date.now() % 100000}-1`;

      const regRes = await apiFetch(baseUrl, '/api/v1/auth/register', {
        method: 'POST',
        body: {
          email: stu1Email,
          password: stu1Password,
          studentNumber: stu1Num,
          firstName: 'Ana',
          middleName: 'Reyes',
          lastName: 'Santos',
          contactNumber: '09171234567',
        },
      });
      assert.equal(regRes.status, 201);
      const stu1Id = Number(regRes.json?.data?.registration?.studentId);
      const stu1UserId = Number(regRes.json?.data?.registration?.userId);

      // Pending student login must be rejected (403)
      const pendingLogin = await loginAs(baseUrl, stu1Email, stu1Password);
      assert.equal(pendingLogin.status, 403);

      // Coordinator approves Student 1 registration
      const approveRegRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/registrations/${stu1Id}/decision`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'approved', remarks: 'Verified student ID' },
        },
      );
      assert.equal(approveRegRes.status, 200);
      assert.equal(approveRegRes.json?.data?.registrationStatus, 'approved');

      // Coordinator assigns Student 1 to Section A then transfers to Section B -> check history preserved
      const assignSecARes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/students/${stu1Id}/section-assignment`,
        {
          method: 'POST',
          session: coordSession,
          body: { sectionId: sectionAId, academicYearId: ay1Id, effectiveDate: '2026-08-02' },
        },
      );
      assert.equal(assignSecARes.status, 200);

      const transferSecBRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/students/${stu1Id}/section-assignment`,
        {
          method: 'POST',
          session: coordSession,
          body: { sectionId: sectionBId, academicYearId: ay1Id, effectiveDate: '2026-09-01' },
        },
      );
      assert.equal(transferSecBRes.status, 200);
      const stu1DetailRes = await apiFetch(baseUrl, `/api/v1/coordinator/students/${stu1Id}`, {
        session: coordSession,
      });
      assert.equal(stu1DetailRes.status, 200);
      const history = stu1DetailRes.json?.data?.student?.sectionHistory ?? [];
      assert.equal(history.length, 2, 'Transfer must preserve previous section history');
      assert.equal(history.filter((h: { isCurrent: boolean }) => h.isCurrent).length, 1);
      assert.equal(Number(stu1DetailRes.json?.data?.student?.currentSection?.sectionId), sectionBId);

      // Edit student and clear optional middleName/contactNumber -> verify persists as null
      const editStu1Res = await apiFetch(baseUrl, `/api/v1/coordinator/students/${stu1Id}`, {
        method: 'PATCH',
        session: coordSession,
        body: {
          studentNumber: stu1Num,
          firstName: 'Ana',
          middleName: null,
          lastName: 'Santos',
          suffix: null,
          sex: 'female',
          birthDate: null,
          contactNumber: null,
          email: stu1Email,
        },
      });
      assert.equal(editStu1Res.status, 200);
      assert.equal(editStu1Res.json?.data?.student?.middleName, null);
      assert.equal(editStu1Res.json?.data?.student?.contactNumber, null);

      // Coordinator directly creates Student 2 (assigned to Section A) and Student 3 (Section Rep in Section A)
      const stu2Email = `qa.student2.${Date.now()}@ctrss.local.test`;
      const stu2Password = 'StudentTwo#2026';
      const stu2Num = `CT-QA-${Date.now() % 100000}-2`;
      const createStu2Res = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
        method: 'POST',
        session: coordSession,
        body: {
          studentNumber: stu2Num,
          firstName: 'Marco',
          lastName: 'Diaz',
          email: stu2Email,
          password: stu2Password,
          accountStatus: 'active',
          sectionId: sectionAId,
          academicYearId: ay1Id,
        },
      });
      assert.equal(createStu2Res.status, 201);
      const stu2Id = Number(createStu2Res.json?.data?.student?.id);
      const stu2UserId = Number(createStu2Res.json?.data?.student?.userId);

      // Duplicate student number -> 409
      const dupStuRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
        method: 'POST',
        session: coordSession,
        body: {
          studentNumber: stu2Num,
          firstName: 'Dup',
          lastName: 'User',
          email: `dup.${Date.now()}@ctrss.local.test`,
          password: stu2Password,
          accountStatus: 'active',
        },
      });
      assert.equal(dupStuRes.status, 409);

      // Student 3: Section Representative assigned to Section A
      const repEmail = `qa.secrep.${Date.now()}@ctrss.local.test`;
      const repPassword = 'SecRepPass#2026';
      const repNum = `CT-QA-${Date.now() % 100000}-3`;
      const createRepRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
        method: 'POST',
        session: coordSession,
        body: {
          studentNumber: repNum,
          firstName: 'Liza',
          lastName: 'Cruz',
          email: repEmail,
          password: repPassword,
          accountStatus: 'active',
          sectionId: sectionAId,
          academicYearId: ay1Id,
        },
      });
      assert.equal(createRepRes.status, 201);
      const repUserId = Number(createRepRes.json?.data?.student?.userId);

      const assignRepRoleRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/users/${repUserId}/roles`,
        {
          method: 'POST',
          session: coordSession,
          body: { roleName: 'Section Representative' },
        },
      );
      assert.equal(assignRepRoleRes.status, 200);

      // Unassigned Section Representative account (user with Section Representative role and NO section assignment)
      const unassignedRepEmail = `qa.unassignedrep.${Date.now()}@ctrss.local.test`;
      const unassignedRepRes = await apiFetch(baseUrl, '/api/v1/coordinator/students', {
        method: 'POST',
        session: coordSession,
        body: {
          studentNumber: `CT-QA-${Date.now() % 100000}-4`,
          firstName: 'NoSec',
          lastName: 'Rep',
          email: unassignedRepEmail,
          password: repPassword,
          accountStatus: 'active',
        },
      });
      assert.equal(unassignedRepRes.status, 201);
      const unassignedRepUserId = Number(unassignedRepRes.json?.data?.student?.userId);
      await apiFetch(baseUrl, `/api/v1/coordinator/users/${unassignedRepUserId}/roles`, {
        method: 'POST',
        session: coordSession,
        body: { roleName: 'Section Representative' },
      });

      // Rejected registration account cannot log in
      const rejEmail = `qa.rejected.${Date.now()}@ctrss.local.test`;
      const rejReg = await apiFetch(baseUrl, '/api/v1/auth/register', {
        method: 'POST',
        body: {
          email: rejEmail,
          password: stu1Password,
          studentNumber: `CT-QA-${Date.now() % 100000}-5`,
          firstName: 'Rejected',
          lastName: 'Applicant',
        },
      });
      assert.equal(rejReg.status, 201);
      const rejStudentId = Number(rejReg.json?.data?.registration?.studentId);
      await apiFetch(baseUrl, `/api/v1/coordinator/registrations/${rejStudentId}/decision`, {
        method: 'POST',
        session: coordSession,
        body: { decision: 'rejected', remarks: 'Invalid ID card' },
      });
      const rejectedLogin = await loginAs(baseUrl, rejEmail, stu1Password);
      assert.equal(rejectedLogin.status, 403);

      // Log in as Student 1, Student 2, Assigned Section Rep, and Unassigned Section Rep
      const stu1Session = (await loginAs(baseUrl, stu1Email, stu1Password)).session;
      const stu2Session = (await loginAs(baseUrl, stu2Email, stu2Password)).session;

      // For Section Rep users created via postCoordinatorStudent, their primaryRole is 'Student' unless Student role isn't primary or RBAC allows Section Representative routes!
      // Verify how roles resolve for repUserId: users with Section Representative role can access /section-rep/* routes regardless of primaryRole!
      const repLogin = await loginAs(baseUrl, repEmail, repPassword);
      assert.equal(repLogin.status, 200);
      const repSession = repLogin.session;
      assert.ok(repLogin.json?.data?.user?.roles?.includes('Section Representative'));

      const unassignedRepSession = (await loginAs(baseUrl, unassignedRepEmail, repPassword)).session;

      // -----------------------------------------------------------------------
      // 5. Task Categories & Tasks & Task Sessions (Including Capacity & Targeting)
      // -----------------------------------------------------------------------
      const catCreateRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
        method: 'POST',
        session: coordSession,
        body: {
          name: 'Community Outreach QA',
          description: 'Clean-up and tech literacy outreach',
          isActive: true,
        },
      });
      assert.equal(catCreateRes.status, 201);
      const categoryId = Number(catCreateRes.json?.data?.category?.id);

      // Duplicate category rejected (409)
      const dupCatRes = await apiFetch(baseUrl, '/api/v1/coordinator/task-categories', {
        method: 'POST',
        session: coordSession,
        body: { name: 'Community Outreach QA', isActive: true },
      });
      assert.equal(dupCatRes.status, 409);

      // Task 1: All-students published task with capacity=1 (to test strict capacity cap!)
      const task1Res = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          categoryId,
          title: 'Campus Solar Lab Assistance QA',
          description: 'Assist instructors and organize workshop stations for College of Technology.',
          location: 'CT Building Room 201',
          visibility: 'all_students',
          capacity: 1,
          requiredHours: 4,
          applicationStart: '2025-01-01T00:00:00Z',
          applicationDeadline: '2030-12-31T23:59:59Z',
          activityStart: '2026-09-10',
          activityEnd: '2026-09-12',
          status: 'draft',
        },
      });
      assert.equal(task1Res.status, 201);
      const task1Id = Number(task1Res.json?.data?.task?.id);

      // Draft task must NOT be visible to Student 1
      const stu1DraftListRes = await apiFetch(baseUrl, '/api/v1/student/tasks', {
        session: stu1Session,
      });
      assert.equal(stu1DraftListRes.status, 200);
      assert.ok(
        !(stu1DraftListRes.json?.data?.tasks ?? []).some((t: { id: number }) => t.id === task1Id),
        'Draft task must not appear in student task list',
      );
      const stu1DraftDetailRes = await apiFetch(baseUrl, `/api/v1/student/tasks/${task1Id}`, {
        session: stu1Session,
      });
      assert.equal(stu1DraftDetailRes.status, 404);

      // Task 2: Specific Section A only
      const task2Res = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          categoryId,
          title: 'Section A Only Inventory QA',
          description: 'Inventory tools strictly assigned to Section A.',
          visibility: 'specific_sections',
          targetSectionIds: [sectionAId],
          status: 'published',
        },
      });
      assert.equal(task2Res.status, 201);
      const task2Id = Number(task2Res.json?.data?.task?.id);

      // Task 3: Selected Student 1 only
      const task3Res = await apiFetch(baseUrl, '/api/v1/coordinator/tasks', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          categoryId,
          title: 'Selected Student 1 Task QA',
          description: 'Special technical documentation assignment for selected student.',
          visibility: 'selected_students',
          targetStudentIds: [stu1Id],
          status: 'published',
        },
      });
      assert.equal(task3Res.status, 201);
      const task3Id = Number(task3Res.json?.data?.task?.id);

      // Publish Task 1 + Sessions (overlap check + edit + delete)
      const pubTask1Res = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${task1Id}/status`, {
        method: 'PATCH',
        session: coordSession,
        body: { status: 'published' },
      });
      assert.equal(pubTask1Res.status, 200);

      const sess1Res = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${task1Id}/sessions`, {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: 'Morning Setup QA',
          sessionDate: '2026-09-10',
          startTime: '08:00',
          endTime: '12:00',
          location: 'CT Lab 1',
        },
      });
      assert.equal(sess1Res.status, 201);
      const session1Id = Number(sess1Res.json?.data?.session?.id);

      // Overlapping session -> 409
      const overlapSessRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/tasks/${task1Id}/sessions`,
        {
          method: 'POST',
          session: coordSession,
          body: {
            sessionTitle: 'Overlapping QA',
            sessionDate: '2026-09-10',
            startTime: '10:00',
            endTime: '13:00',
            location: 'CT Lab 2',
          },
        },
      );
      assert.equal(overlapSessRes.status, 409);

      // Non-overlapping session 2 -> create, edit, then delete safely (no attendance yet)
      const sess2Res = await apiFetch(baseUrl, `/api/v1/coordinator/tasks/${task1Id}/sessions`, {
        method: 'POST',
        session: coordSession,
        body: {
          sessionTitle: 'Afternoon QA',
          sessionDate: '2026-09-10',
          startTime: '13:00',
          endTime: '16:00',
          location: 'CT Lab 1',
        },
      });
      assert.equal(sess2Res.status, 201);
      const session2Id = Number(sess2Res.json?.data?.session?.id);

      const editSess2Res = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/tasks/${task1Id}/sessions/${session2Id}`,
        {
          method: 'PATCH',
          session: coordSession,
          body: {
            sessionTitle: 'Afternoon QA Edited',
            sessionDate: '2026-09-10',
            startTime: '13:30',
            endTime: '16:30',
            location: 'CT Lab 2',
          },
        },
      );
      assert.equal(editSess2Res.status, 200);

      const delSess2Res = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/tasks/${task1Id}/sessions/${session2Id}`,
        { method: 'DELETE', session: coordSession },
      );
      assert.equal(delSess2Res.status, 200);

      // Verify Student Eligibility Filtering:
      // Student 1 (in Section B) sees task1 & task3, NOT task2 (Section A only)!
      // Student 2 (in Section A) sees task1 & task2, NOT task3 (Student 1 only)!
      const stu1Tasks = (
        await apiFetch(baseUrl, '/api/v1/student/tasks', { session: stu1Session })
      ).json?.data?.tasks as Array<{ id: number }>;
      assert.ok(stu1Tasks.some((t) => t.id === task1Id));
      assert.ok(stu1Tasks.some((t) => t.id === task3Id));
      assert.ok(!stu1Tasks.some((t) => t.id === task2Id), 'Student 1 in Sec B must NOT see Sec A task');

      const stu2Tasks = (
        await apiFetch(baseUrl, '/api/v1/student/tasks', { session: stu2Session })
      ).json?.data?.tasks as Array<{ id: number }>;
      assert.ok(stu2Tasks.some((t) => t.id === task1Id));
      assert.ok(stu2Tasks.some((t) => t.id === task2Id));
      assert.ok(!stu2Tasks.some((t) => t.id === task3Id), 'Student 2 must NOT see Student 1-only task');

      // Direct apply bypass attempt by Student 1 on Task 2 must fail (403)
      const bypassApplyRes = await apiFetch(baseUrl, `/api/v1/student/tasks/${task2Id}/apply`, {
        method: 'POST',
        session: stu1Session,
        body: { applicationMessage: 'Bypass test' },
      });
      assert.equal(bypassApplyRes.status, 403);

      // -----------------------------------------------------------------------
      // 6. Task Applications, Withdraw/Reapply, Capacity Enforcement
      // -----------------------------------------------------------------------
      // Student 1 applies to Task 1, withdraws, then re-applies
      const app1Init = await apiFetch(baseUrl, `/api/v1/student/tasks/${task1Id}/apply`, {
        method: 'POST',
        session: stu1Session,
        body: { applicationMessage: 'Excited to contribute to the lab setup.' },
      });
      assert.equal(app1Init.status, 201);
      const app1Id = Number(app1Init.json?.data?.application?.id);

      // Duplicate apply -> 409
      const dupApply = await apiFetch(baseUrl, `/api/v1/student/tasks/${task1Id}/apply`, {
        method: 'POST',
        session: stu1Session,
        body: { applicationMessage: 'Duplicate apply attempt' },
      });
      assert.equal(dupApply.status, 409);

      // Withdraw
      const withdrawRes = await apiFetch(
        baseUrl,
        `/api/v1/student/applications/${app1Id}/withdraw`,
        {
          method: 'POST',
          session: stu1Session,
          body: { reason: 'Schedule check' },
        },
      );
      assert.equal(withdrawRes.status, 200);
      assert.equal(withdrawRes.json?.data?.application?.status, 'withdrawn');

      // Re-apply
      const app1Reapply = await apiFetch(baseUrl, `/api/v1/student/tasks/${task1Id}/apply`, {
        method: 'POST',
        session: stu1Session,
        body: { applicationMessage: 'Schedule confirmed, reapplying now.' },
      });
      assert.equal(app1Reapply.status, 201);
      const stu1AppId = Number(app1Reapply.json?.data?.application?.id);

      // Student 2 also applies to Task 1 (capacity=1)
      const app2Init = await apiFetch(baseUrl, `/api/v1/student/tasks/${task1Id}/apply`, {
        method: 'POST',
        session: stu2Session,
        body: { applicationMessage: 'Student 2 also applying for Task 1.' },
      });
      assert.equal(app2Init.status, 201);
      const stu2AppId = Number(app2Init.json?.data?.application?.id);

      // Coordinator approves Student 1 -> succeeds
      const approveApp1 = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/applications/${stu1AppId}/decision`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'approved', remarks: 'Approved for Morning Setup' },
        },
      );
      assert.equal(approveApp1.status, 200);
      assert.equal(approveApp1.json?.data?.application?.status, 'approved');

      // Coordinator tries to approve Student 2 when Task 1 capacity=1 is already full -> 409!
      const overCapApprove = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/applications/${stu2AppId}/decision`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'approved', remarks: 'Should fail capacity check' },
        },
      );
      assert.equal(overCapApprove.status, 409, 'Coordinator must not approve past task capacity');

      // Coordinator rejects Student 2 on Task 1 cleanly
      const rejectApp2 = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/applications/${stu2AppId}/decision`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'rejected', remarks: 'Capacity reached' },
        },
      );
      assert.equal(rejectApp2.status, 200);

      // Student 2 cannot modify or access Student 1's application detail (IDOR check -> 403)
      const idorAppRes = await apiFetch(baseUrl, `/api/v1/student/applications/${stu1AppId}`, {
        session: stu2Session,
      });
      assert.equal(idorAppRes.status, 403);

      // -----------------------------------------------------------------------
      // 7. Attendance & Service Hours Ledger + Adjustments + Session Delete Guard
      // -----------------------------------------------------------------------
      // Invalid check-out before check-in -> 400
      const invalidTimeAtt = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
        method: 'POST',
        session: coordSession,
        body: {
          applicationId: stu1AppId,
          taskSessionId: session1Id,
          attendanceDate: '2026-09-10',
          checkIn: '2026-09-10T11:00:00',
          checkOut: '2026-09-10T09:00:00',
        },
      });
      assert.equal(invalidTimeAtt.status, 400);

      // Record Attendance as PENDING (4.0h recorded, 0 verified initially)
      const recAttRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
        method: 'POST',
        session: coordSession,
        body: {
          applicationId: stu1AppId,
          taskSessionId: session1Id,
          attendanceDate: '2026-09-10',
          checkIn: '2026-09-10T08:00:00',
          checkOut: '2026-09-10T12:00:00',
          autoVerify: false,
          remarks: 'Attended morning lab session',
        },
      });
      assert.equal(recAttRes.status, 201);
      const attendanceId = Number(recAttRes.json?.data?.record?.id);
      assert.equal(recAttRes.json?.data?.record?.verificationStatus, 'pending');

      // Duplicate attendance on same application+session -> 409
      const dupAttRes = await apiFetch(baseUrl, '/api/v1/coordinator/attendance', {
        method: 'POST',
        session: coordSession,
        body: {
          applicationId: stu1AppId,
          taskSessionId: session1Id,
          attendanceDate: '2026-09-10',
        },
      });
      assert.equal(dupAttRes.status, 409);

      // Session delete protection when attendance exists -> 409
      const deleteProtectedSess = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/tasks/${task1Id}/sessions/${session1Id}`,
        { method: 'DELETE', session: coordSession },
      );
      assert.equal(deleteProtectedSess.status, 409);

      // Verify Pending Attendance does NOT count towards verifiedHours
      const stu1HoursBefore = await apiFetch(baseUrl, '/api/v1/student/service-hours', {
        session: stu1Session,
      });
      assert.equal(stu1HoursBefore.status, 200);
      assert.equal(stu1HoursBefore.json?.data?.students?.[0]?.verifiedAttendanceHours ?? 0, 0);
      assert.equal(stu1HoursBefore.json?.data?.students?.[0]?.pendingAttendanceHours, 4);

      // Student cannot call Coordinator attendance verification endpoint -> 403
      const stuVerifyAttempt = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/attendance/${attendanceId}`,
        {
          method: 'PATCH',
          session: stu1Session,
          body: { verificationStatus: 'verified', verifiedHours: 10 },
        },
      );
      assert.equal(stuVerifyAttempt.status, 403);

      // Coordinator verifies 3.75 hours
      const verifyAttRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/attendance/${attendanceId}`,
        {
          method: 'PATCH',
          session: coordSession,
          body: {
            verificationStatus: 'verified',
            verifiedHours: 3.75,
            remarks: 'Verified 15-min break deduction',
          },
        },
      );
      assert.equal(verifyAttRes.status, 200);
      assert.equal(verifyAttRes.json?.data?.record?.verifiedHours, 3.75);

      // Student submits positive adjustment request (+1.25h) -> Coordinator approves -> Total = 5.00h
      const adjReqRes = await apiFetch(baseUrl, '/api/v1/student/service-hours/adjustments', {
        method: 'POST',
        session: stu1Session,
        body: {
          applicationId: stu1AppId,
          adjustmentHours: 1.25,
          reason: 'Pre-event preparation work verified by instructor',
        },
      });
      assert.equal(adjReqRes.status, 201);
      const adj1Id = Number(adjReqRes.json?.data?.adjustment?.id);
      assert.equal(adjReqRes.json?.data?.adjustment?.status, 'pending');

      // Coordinator approves adjustment
      const approveAdjRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/service-hours/adjustments/${adj1Id}/decision`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'approved' },
        },
      );
      assert.equal(approveAdjRes.status, 200);

      // Negative adjustment larger than total (-10h) -> rejected 400
      const negOverAdjRes = await apiFetch(
        baseUrl,
        '/api/v1/coordinator/service-hours/adjustments',
        {
          method: 'POST',
          session: coordSession,
          body: {
            applicationId: stu1AppId,
            adjustmentHours: -10,
            reason: 'Invalid excessive deduction test',
            autoApprove: true,
          },
        },
      );
      assert.equal(negOverAdjRes.status, 400);

      // Student service hours total = 3.75 + 1.25 = 5.0
      const stu1HoursAfter = await apiFetch(baseUrl, '/api/v1/student/service-hours', {
        session: stu1Session,
      });
      assert.equal(stu1HoursAfter.status, 200);
      assert.equal(stu1HoursAfter.json?.data?.students?.[0]?.verifiedAttendanceHours, 3.75);
      assert.equal(stu1HoursAfter.json?.data?.students?.[0]?.approvedAdjustmentHours, 1.25);
      assert.equal(stu1HoursAfter.json?.data?.students?.[0]?.totalCreditedHours, 5);

      // -----------------------------------------------------------------------
      // 8. Accomplishments & Evidence Image Security + Versioning
      // -----------------------------------------------------------------------
      const initDraftRes = await apiFetch(baseUrl, '/api/v1/student/accomplishments/draft', {
        method: 'POST',
        session: stu1Session,
        body: { applicationId: stu1AppId },
      });
      assert.equal(initDraftRes.status, 201);

      // Spoofed PNG magic bytes -> 400 INVALID_IMAGE_SIGNATURE
      const spoofedRes = await apiFetch(baseUrl, '/api/v1/student/accomplishments/submit', {
        method: 'POST',
        session: stu1Session,
        body: {
          applicationId: stu1AppId,
          activityDate: '2026-09-10',
          accomplishmentDescription: 'Completed solar lab equipment wiring and testing.',
          evidenceImages: [
            {
              originalFilename: '../../etc/passwd.png',
              mimeType: 'image/png',
              dataBase64: SPOOFED_PNG_BASE64,
              imageCategory: 'before',
            },
          ],
        },
      });
      assert.equal(spoofedRes.status, 400);
      assert.equal(spoofedRes.json?.error?.code, 'INVALID_IMAGE_SIGNATURE');

      // Oversized image (>5MB decoded) -> 400 FILE_TOO_LARGE
      const bigBuf = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
        Buffer.alloc(5 * 1024 * 1024 + 32, 0x41),
      ]);
      const oversizedRes = await apiFetch(baseUrl, '/api/v1/student/accomplishments/submit', {
        method: 'POST',
        session: stu1Session,
        body: {
          applicationId: stu1AppId,
          activityDate: '2026-09-10',
          accomplishmentDescription: 'Testing oversized evidence image rejection limit.',
          evidenceImages: [
            {
              originalFilename: 'huge.png',
              mimeType: 'image/png',
              dataBase64: bigBuf.toString('base64'),
              imageCategory: 'during',
            },
          ],
        },
      });
      assert.equal(oversizedRes.status, 400);
      assert.equal(oversizedRes.json?.error?.code, 'FILE_TOO_LARGE');

      // Valid submission v1 (with path-traversal filename sanitized + PNG & JPEG magic bytes)
      const submitV1Res = await apiFetch(baseUrl, '/api/v1/student/accomplishments/submit', {
        method: 'POST',
        session: stu1Session,
        body: {
          applicationId: stu1AppId,
          activityDate: '2026-09-10',
          accomplishmentDescription:
            'Calibrated bench power supplies and prepared all 10 student workstations.',
          studentRemarks: 'Initial v1 evidence package',
          evidenceImages: [
            {
              originalFilename: '../../traversal_before.png',
              mimeType: 'image/png',
              dataBase64: `data:image/png;base64,${VALID_PNG_BASE64}`,
              imageCategory: 'before',
              caption: 'Before setup',
            },
            {
              originalFilename: 'after_station.jpg',
              mimeType: 'image/jpeg',
              dataBase64: VALID_JPEG_BASE64,
              imageCategory: 'after',
              caption: 'Completed station',
            },
          ],
        },
      });
      assert.equal(submitV1Res.status, 201);
      const accId = Number(submitV1Res.json?.data?.accomplishment?.id);
      const subV1 = submitV1Res.json?.data?.accomplishment?.submissions?.[0];
      const subV1Id = Number(subV1?.id);
      const evidenceImg1Id = Number(subV1?.evidenceImages?.[0]?.id);
      assert.equal(subV1?.versionNumber, 1);
      assert.ok(!String(subV1?.evidenceImages?.[0]?.originalFilename).includes('..'));

      // Cannot resubmit while already submitted -> 409 SUBMISSION_LOCKED
      const resubmitWhileLocked = await apiFetch(
        baseUrl,
        '/api/v1/student/accomplishments/submit',
        {
          method: 'POST',
          session: stu1Session,
          body: {
            applicationId: stu1AppId,
            activityDate: '2026-09-10',
            accomplishmentDescription: 'Trying to overwrite locked submission before review.',
            evidenceImages: [
              {
                originalFilename: 'try.png',
                mimeType: 'image/png',
                dataBase64: VALID_PNG_BASE64,
                imageCategory: 'other',
              },
            ],
          },
        },
      );
      assert.equal(resubmitWhileLocked.status, 409);

      // Evidence image authorization checks:
      // Student 1 (owner) -> 200, Coordinator -> 200, Student 2 (other student IDOR) -> 403!
      const ownerImgRes = await apiFetch(baseUrl, `/api/v1/evidence/${evidenceImg1Id}/file`, {
        session: stu1Session,
      });
      assert.equal(ownerImgRes.status, 200);
      assert.equal(ownerImgRes.headers.get('content-type'), 'image/png');

      const coordImgRes = await apiFetch(baseUrl, `/api/v1/evidence/${evidenceImg1Id}/file`, {
        session: coordSession,
      });
      assert.equal(coordImgRes.status, 200);

      const idorImgRes = await apiFetch(baseUrl, `/api/v1/evidence/${evidenceImg1Id}/file`, {
        session: stu2Session,
      });
      assert.equal(idorImgRes.status, 403);

      // Student 2 IDOR on Student 1 accomplishment detail -> 403
      const idorAccRes = await apiFetch(baseUrl, `/api/v1/student/accomplishments/${accId}`, {
        session: stu2Session,
      });
      assert.equal(idorAccRes.status, 403);

      // Coordinator requests revision (remarks required check first -> 400 if blank, then 200)
      const revNoRemarks = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/accomplishments/submissions/${subV1Id}/review`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'revision_required', remarks: '' },
        },
      );
      assert.equal(revNoRemarks.status, 400);

      const revOkRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/accomplishments/submissions/${subV1Id}/review`,
        {
          method: 'POST',
          session: coordSession,
          body: {
            decision: 'revision_required',
            remarks: 'Please include quantitative counts of calibrated benches.',
          },
        },
      );
      assert.equal(revOkRes.status, 200);
      assert.equal(revOkRes.json?.data?.accomplishment?.status, 'revision_required');

      // Report eligibility: revision_required submission must NOT appear in individual report
      const revIndPreviewRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/individual/preview?studentId=${stu1Id}&academicYearId=${ay1Id}`,
        { session: coordSession },
      );
      assert.equal(revIndPreviewRes.status, 200);
      const revIndSubs = revIndPreviewRes.json?.data?.preview?.includedSubmissions ?? [];
      assert.ok(
        !revIndSubs.some((s: { submissionId: number }) => s.submissionId === subV1Id),
        'Revision-required submission must not appear in individual report preview',
      );
      assert.equal(revIndPreviewRes.json?.data?.preview?.totals?.approvedAccomplishmentsCount, 0,
        'Approved accomplishments count must be 0 while submission is revision_required');

      // Report eligibility: revision_required submission must NOT appear in section report
      const revSecPreviewRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/section/preview?sectionId=${sectionBId}&academicYearId=${ay1Id}`,
        { session: coordSession },
      );
      assert.equal(revSecPreviewRes.status, 200);
      const revSecSubs = revSecPreviewRes.json?.data?.preview?.includedSubmissions ?? [];
      assert.ok(
        !revSecSubs.some((s: { submissionId: number }) => s.submissionId === subV1Id),
        'Revision-required submission must not appear in section report preview',
      );

      // Student submits v2; verify v1 stays preserved in submission history!
      const submitV2Res = await apiFetch(baseUrl, '/api/v1/student/accomplishments/submit', {
        method: 'POST',
        session: stu1Session,
        body: {
          applicationId: stu1AppId,
          activityDate: '2026-09-10',
          accomplishmentDescription:
            'Calibrated 10 bench power supplies and tested 20 multimeter leads across CT Lab 1.',
          studentRemarks: 'Added quantitative details as requested',
          evidenceImages: [
            {
              originalFilename: 'during_calibration.png',
              mimeType: 'image/png',
              dataBase64: VALID_PNG_BASE64,
              imageCategory: 'during',
            },
          ],
        },
      });
      assert.equal(submitV2Res.status, 201);
      const subsAfterV2 = submitV2Res.json?.data?.accomplishment?.submissions ?? [];
      assert.equal(subsAfterV2.length, 2, 'v1 and v2 submissions must both be retained');
      const subV2Id = Number(subsAfterV2[0]?.id);

      // Coordinator approves v2
      const approveAccRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/accomplishments/submissions/${subV2Id}/review`,
        {
          method: 'POST',
          session: coordSession,
          body: { decision: 'approved', remarks: 'Complete and verified.' },
        },
      );
      assert.equal(approveAccRes.status, 200);
      assert.equal(approveAccRes.json?.data?.accomplishment?.status, 'approved');

      // Report eligibility: v2 (approved) must appear, v1 (revision_required) must not
      const postApproveIndPreviewRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/individual/preview?studentId=${stu1Id}&academicYearId=${ay1Id}`,
        { session: coordSession },
      );
      assert.equal(postApproveIndPreviewRes.status, 200);
      const postApproveIndSubs = postApproveIndPreviewRes.json?.data?.preview?.includedSubmissions ?? [];
      assert.ok(
        postApproveIndSubs.some((s: { submissionId: number }) => s.submissionId === subV2Id),
        'Approved v2 must appear in individual report preview',
      );
      assert.ok(
        !postApproveIndSubs.some((s: { submissionId: number }) => s.submissionId === subV1Id),
        'Revision-required v1 must not appear in individual report preview',
      );
      assert.equal(postApproveIndPreviewRes.json?.data?.preview?.totals?.approvedAccomplishmentsCount, 1,
        'Approved accomplishments count must be 1 (only v2)');

      // Section report: v2 present, v1 absent
      const postApproveSecPreviewRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/section/preview?sectionId=${sectionBId}&academicYearId=${ay1Id}`,
        { session: coordSession },
      );
      assert.equal(postApproveSecPreviewRes.status, 200);
      const postApproveSecSubs = postApproveSecPreviewRes.json?.data?.preview?.includedSubmissions ?? [];
      assert.ok(
        postApproveSecSubs.some((s: { submissionId: number }) => s.submissionId === subV2Id),
        'Approved v2 must appear in section report preview',
      );
      assert.ok(
        !postApproveSecSubs.some((s: { submissionId: number }) => s.submissionId === subV1Id),
        'Revision-required v1 must not appear in section report preview',
      );

      // -----------------------------------------------------------------------
      // 9. Report Templates, Individual PDF Reports, Section PDF Reports & Scoping
      // -----------------------------------------------------------------------
      const tplRes = await apiFetch(baseUrl, '/api/v1/coordinator/report-templates', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          templateName: 'QA Official CT-RSS Template',
          templateVersion: '1.0',
          isActive: true,
          config: {
            reportType: 'both',
            subtitle: 'QA Verification Subtitle',
            headerNote: 'LLCC CT QA',
            footerNote: 'Verified hours only',
            signatoryTitle: 'RSS Coordinator',
            includeSections: {
              attendanceSummary: true,
              serviceHoursBreakdown: true,
              accomplishmentNarrative: true,
              evidenceCountSummary: true,
              sectionComparison: true,
            },
          },
        },
      });
      assert.equal(tplRes.status, 201);
      const templateId = Number(tplRes.json?.data?.template?.id);

      // Duplicate template name+version -> 409
      const dupTplRes = await apiFetch(baseUrl, '/api/v1/coordinator/report-templates', {
        method: 'POST',
        session: coordSession,
        body: {
          collegeId: ctCollegeId,
          templateName: 'QA Official CT-RSS Template',
          templateVersion: '1.0',
        },
      });
      assert.equal(dupTplRes.status, 409);

      // Individual Report Preview + PDF Generation (v1)
      const indPreviewRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/individual/preview?studentId=${stu1Id}&academicYearId=${ay1Id}`,
        { session: coordSession },
      );
      assert.equal(indPreviewRes.status, 200);
      assert.equal(indPreviewRes.json?.data?.preview?.totals?.totalCreditedHours, 5);
      assert.equal(indPreviewRes.json?.data?.preview?.totals?.approvedAccomplishmentsCount, 1);
      // Verify the approved submission in the report is v2 (not v1)
      const indPreviewSubs = indPreviewRes.json?.data?.preview?.includedSubmissions ?? [];
      assert.ok(
        indPreviewSubs.some((s: { submissionId: number }) => s.submissionId === subV2Id),
        'Report must include the approved v2 submission',
      );
      assert.ok(
        !indPreviewSubs.some((s: { submissionId: number }) => s.submissionId === subV1Id),
        'Report must not include the revision_required v1 submission',
      );

      const genIndRes = await apiFetch(baseUrl, '/api/v1/coordinator/reports/individual/generate', {
        method: 'POST',
        session: coordSession,
        body: { studentId: stu1Id, academicYearId: ay1Id, templateId },
      });
      assert.equal(genIndRes.status, 201);
      const indReportId = Number(genIndRes.json?.data?.report?.id);
      const indReportHash = String(genIndRes.json?.data?.report?.fileHash ?? '');
      assert.equal(genIndRes.json?.data?.report?.version, 1);
      assert.equal(genIndRes.json?.data?.report?.itemCount, 1);

      // Student 1 downloads own PDF + verifies real %PDF- signature & SHA-256 hash match
      const stu1DownloadRes = await apiFetch(baseUrl, `/api/v1/reports/${indReportId}/download`, {
        session: stu1Session,
      });
      assert.equal(stu1DownloadRes.status, 200);
      assert.equal(stu1DownloadRes.headers.get('content-type'), 'application/pdf');
      assert.equal(stu1DownloadRes.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
      const actualSha256 = crypto.createHash('sha256').update(stu1DownloadRes.buffer).digest('hex');
      assert.equal(actualSha256, indReportHash);

      // Student 2 CANNOT download Student 1's individual report -> 403!
      const stu2IdorReportRes = await apiFetch(baseUrl, `/api/v1/reports/${indReportId}/download`, {
        session: stu2Session,
      });
      assert.equal(stu2IdorReportRes.status, 403);

      // Update Individual Report Status (generated -> approved)
      const approveReportRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/${indReportId}/status`,
        {
          method: 'PATCH',
          session: coordSession,
          body: { status: 'approved' },
        },
      );
      assert.equal(approveReportRes.status, 200);
      assert.equal(approveReportRes.json?.data?.report?.status, 'approved');

      // Section Report Preview + Comparison + PDF for Section A and Section B
      const secBPreviewRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/reports/section/preview?sectionId=${sectionBId}&academicYearId=${ay1Id}&includeComparison=true`,
        { session: coordSession },
      );
      assert.equal(secBPreviewRes.status, 200);
      assert.equal(secBPreviewRes.json?.data?.preview?.totals?.totalCreditedHours, 5);
      assert.ok(secBPreviewRes.json?.data?.preview?.sectionComparison?.length >= 2);

      const genSecBRes = await apiFetch(baseUrl, '/api/v1/coordinator/reports/section/generate', {
        method: 'POST',
        session: coordSession,
        body: { sectionId: sectionBId, academicYearId: ay1Id, templateId },
      });
      assert.equal(genSecBRes.status, 201);
      const secBReportId = Number(genSecBRes.json?.data?.report?.id);

      const genSecARes = await apiFetch(baseUrl, '/api/v1/coordinator/reports/section/generate', {
        method: 'POST',
        session: coordSession,
        body: { sectionId: sectionAId, academicYearId: ay1Id, templateId },
      });
      assert.equal(genSecARes.status, 201);
      const secAReportId = Number(genSecARes.json?.data?.report?.id);

      // -----------------------------------------------------------------------
      // 10. Section Representative Scoping & Strict Isolation Tests
      // -----------------------------------------------------------------------
      const repOverviewRes = await apiFetch(baseUrl, '/api/v1/section-rep/overview', {
        session: repSession,
      });
      assert.equal(repOverviewRes.status, 200);
      assert.equal(repOverviewRes.json?.data?.assigned, true);
      assert.equal(Number(repOverviewRes.json?.data?.section?.sectionId), sectionAId);

      // Assigned Section Rep (Section A) can download Section A report (200),
      // CANNOT download Section B report (403!), CANNOT download Student 1 individual report (403!)
      const repSecADownload = await apiFetch(baseUrl, `/api/v1/reports/${secAReportId}/download`, {
        session: repSession,
      });
      assert.equal(repSecADownload.status, 200);
      assert.equal(repSecADownload.buffer.subarray(0, 5).toString('ascii'), '%PDF-');

      const repSecBForbidden = await apiFetch(baseUrl, `/api/v1/reports/${secBReportId}/download`, {
        session: repSession,
      });
      assert.equal(
        repSecBForbidden.status,
        403,
        'Section Rep must NOT download another section report via ID manipulation',
      );

      const repIndForbidden = await apiFetch(baseUrl, `/api/v1/reports/${indReportId}/download`, {
        session: repSession,
      });
      assert.equal(repIndForbidden.status, 403);

      // Section Rep CANNOT call Coordinator administrative endpoints -> 403
      const repCoordForbidden = await apiFetch(baseUrl, '/api/v1/coordinator/registrations', {
        session: repSession,
      });
      assert.equal(repCoordForbidden.status, 403);

      // Unassigned Section Rep gets clean assigned=false state and CANNOT download Section A/B reports (403)
      const unassignedOverview = await apiFetch(baseUrl, '/api/v1/section-rep/overview', {
        session: unassignedRepSession,
      });
      assert.equal(unassignedOverview.status, 200);
      assert.equal(unassignedOverview.json?.data?.assigned, false);
      assert.equal(unassignedOverview.json?.data?.section, null);

      const unassignedDownload = await apiFetch(
        baseUrl,
        `/api/v1/reports/${secAReportId}/download`,
        { session: unassignedRepSession },
      );
      assert.equal(unassignedDownload.status, 403);

      // -----------------------------------------------------------------------
      // 11. Notifications, Dashboard Summary, Audit Logs & Immutability
      // -----------------------------------------------------------------------
      const stu1Dash = await apiFetch(baseUrl, '/api/v1/dashboard/summary', {
        session: stu1Session,
      });
      assert.equal(stu1Dash.status, 200);
      assert.equal(stu1Dash.json?.data?.student?.verifiedServiceHours, 5);
      assert.equal(stu1Dash.json?.data?.student?.availableIndividualReports, 1);

      const stu1NotifsBefore = await apiFetch(baseUrl, '/api/v1/notifications', {
        session: stu1Session,
      });
      assert.equal(stu1NotifsBefore.status, 200);
      assert.ok(stu1NotifsBefore.json?.data?.unreadCount >= 1);
      const firstNotifId = String(stu1NotifsBefore.json?.data?.notifications?.[0]?.id ?? '');
      assert.ok(firstNotifId.length > 0);

      // Mark single notification read
      const markOneRead = await apiFetch(baseUrl, `/api/v1/notifications/${firstNotifId}/read`, {
        method: 'PATCH',
        session: stu1Session,
      });
      assert.equal(markOneRead.status, 200);

      // Student 2 CANNOT mark Student 1's notification read -> 403/404
      const idorNotifRes = await apiFetch(baseUrl, `/api/v1/notifications/${firstNotifId}/read`, {
        method: 'PATCH',
        session: stu2Session,
      });
      assert.ok(idorNotifRes.status === 403 || idorNotifRes.status === 404);

      // Mark all remaining notifications read -> unreadCount reaches 0
      const markAllRead = await apiFetch(baseUrl, '/api/v1/notifications/read-all', {
        method: 'POST',
        session: stu1Session,
      });
      assert.equal(markAllRead.status, 200);
      const stu1NotifsAfter = await apiFetch(baseUrl, '/api/v1/notifications', {
        session: stu1Session,
      });
      assert.equal(stu1NotifsAfter.json?.data?.unreadCount, 0);

      // Coordinator Audit Logs: verify sensitive fields redacted and logs cannot be deleted/edited via API
      const auditLogsRes = await apiFetch(baseUrl, '/api/v1/coordinator/audit-logs?pageSize=25', {
        session: coordSession,
      });
      assert.equal(auditLogsRes.status, 200);
      const logSerialized = JSON.stringify(auditLogsRes.json?.data?.logs ?? []);
      assert.ok(!logSerialized.includes(testCoordinatorPassword));
      assert.ok(!logSerialized.includes(stu1Password));

      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const mutAuditRes = await apiFetch(baseUrl, '/api/v1/coordinator/audit-logs/1', {
          method,
          session: coordSession,
          body: {},
        });
        assert.equal(mutAuditRes.status, 404, `Audit log ${method} must not exist`);
      }

      // SQL injection payload in search query is safely parameterized (returns 200 empty results, no error)
      const sqliRes = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/students?search=${encodeURIComponent("'; DROP TABLE students; --")}`,
        { session: coordSession },
      );
      assert.equal(sqliRes.status, 200);

      // Suspend user -> active session/future login blocked; Logout -> cookie immediately revoked!
      const suspendStu2 = await apiFetch(
        baseUrl,
        `/api/v1/coordinator/users/${stu2UserId}/status`,
        {
          method: 'PATCH',
          session: coordSession,
          body: { status: 'suspended', reason: 'QA suspension test' },
        },
      );
      assert.equal(suspendStu2.status, 200);
      const stu2AfterSuspend = await apiFetch(baseUrl, '/api/v1/auth/me', {
        session: stu2Session,
      });
      assert.equal(stu2AfterSuspend.status, 401);

      // Coordinator logout revokes token immediately even if cookie replayed
      const logoutRes = await apiFetch(baseUrl, '/api/v1/auth/logout', {
        method: 'POST',
        session: coordSession,
      });
      assert.equal(logoutRes.status, 200);
      const replayAfterLogout = await apiFetch(baseUrl, '/api/v1/auth/me', {
        session: coordSession,
      });
      assert.equal(replayAfterLogout.status, 401);

      // Clean unused reference warning if any
      assert.ok(stu1UserId > 0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  } finally {
    await cleanupNewStorageFiles(storageBefore);
  }

  // Verify 100% Zero Persistent Rows Added to Neon After Rollback
  const baselineAfter = await snapshotProductionCounts();
  assert.equal(baselineAfter.tableCount, 28);
  assert.deepEqual(
    baselineAfter.counts,
    baselineBefore.counts,
    'Every Neon table row count after test rollback must match baseline identically',
  );
});
