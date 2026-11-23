// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { query, closeDatabasePool } from '../src/server/config/database.ts';
import { getDashboardSummaryForUser } from '../src/server/services/systemModulesService.ts';
import { getServiceHoursSummary } from '../src/server/services/attendanceService.ts';
import type { AuthenticatedUser, StudentSummary } from '../src/server/types/api.ts';

const tracked = {
  attendanceIds: [] as number[],
  adjustmentIds: [] as number[],
  accomplishmentIds: [] as number[],
  applicationIds: [] as number[],
  taskSessionIds: [] as number[],
  students: [] as number[],
  userIds: [] as number[],
  sections: [] as number[],
  programs: [] as number[],
  colleges: [] as number[],
  yearLevels: [] as number[],
  academicYears: [] as number[],
  tasks: [] as number[],
  categories: [] as number[],
};

interface StudentFixture {
  id: number;
  userId: number;
  roles: AuthenticatedUser['roles'];
  summary: StudentSummary;
}

interface FixtureSet {
  suffix: number;
  coordUserId: number;
  studentA: StudentFixture;
  studentB: StudentFixture;
  sectionRepUser: StudentFixture;
  secMainId: number;
  secOtherId: number;
  expected: {
    coord: {
      activeStudents: string;
      publishedTasks: string;
      pendingApplications: string;
      pendingAttendance: string;
      pendingAdjustments: string;
      pendingAccomplishments: string;
      totalCredited: string;
    };
    studentA: {
      myPendingApplications: string;
      myApprovedApplications: string;
      verifiedServiceHours: string;
      pendingServiceHours: string;
    };
    studentB: {
      myPendingApplications: string;
      myApprovedApplications: string;
      verifiedServiceHours: string;
      pendingServiceHours: string;
    };
    secRep: {
      enrolledStudentCount: string;
      approvedParticipations: string;
      totalCreditedServiceHours: string;
      visiblePublishedTasksCount: string;
    };
  };
}

async function createStudent(input: {
  emailSuffix: string;
  studentNumber: string;
  name: string;
  roleName: 'Student' | 'Section Representative';
  sectionId?: number;
  academicYearId: number;
  isCurrent?: boolean;
}): Promise<StudentFixture> {
  const userRes = await query<{ id: number }>(
    `INSERT INTO users (name, email, password, account_status) VALUES ($1, $2, 'hash', 'active') RETURNING id`,
    [input.name, `${input.emailSuffix}@test.local`],
  );
  const userId = userRes.rows[0].id;
  tracked.userIds.push(userId);

  const studentRes = await query<{ id: number }>(
    `INSERT INTO students (user_id, student_number, first_name, last_name, registration_status)
     VALUES ($1, $2, $3, $4, 'approved') RETURNING id`,
    [userId, input.studentNumber, input.name.split(' ')[0] ?? 'F', input.name.split(' ')[1] ?? 'S'],
  );
  const studentId = studentRes.rows[0].id;
  tracked.students.push(studentId);

  const roleRes = await query<{ id: number }>(`SELECT id FROM roles WHERE name = $1 LIMIT 1`, [input.roleName]);
  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleRes.rows[0].id]);

  if (input.sectionId !== undefined) {
    await query(
      `INSERT INTO student_section_history (student_id, section_id, academic_year_id, enrolled_at, is_current)
       VALUES ($1, $2, $3, '2025-01-01', COALESCE($4, TRUE))`,
      [studentId, input.sectionId, input.academicYearId, input.isCurrent === undefined ? null : input.isCurrent],
    );
  }

  return {
    id: studentId,
    userId,
    roles: [input.roleName],
    summary: {
      id: studentId,
      studentNumber: input.studentNumber,
      firstName: input.name.split(' ')[0] ?? 'F',
      middleName: null,
      lastName: input.name.split(' ')[1] ?? 'S',
      suffix: null,
      sex: null,
      birthDate: null,
      contactNumber: null,
      registrationStatus: 'approved',
      reviewedBy: null,
      reviewedAt: null,
    },
  };
}

async function cleanup() {
  for (const id of tracked.attendanceIds) {
    await query('DELETE FROM attendance WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.adjustmentIds) {
    await query('DELETE FROM service_hour_adjustments WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.accomplishmentIds) {
    await query('DELETE FROM accomplishments WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.applicationIds) {
    await query('DELETE FROM task_applications WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.taskSessionIds) {
    await query('DELETE FROM task_sessions WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.students) {
    await query('DELETE FROM student_section_history WHERE student_id = $1', [id]).catch(() => {});
    await query('DELETE FROM students WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.userIds) {
    await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.sections) {
    await query('DELETE FROM sections WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.academicYears) {
    await query('DELETE FROM academic_years WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.programs) {
    await query('DELETE FROM programs WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.colleges) {
    await query('DELETE FROM colleges WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.yearLevels) {
    await query('DELETE FROM year_levels WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.tasks) {
    await query('DELETE FROM tasks WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of tracked.categories) {
    await query('DELETE FROM task_categories WHERE id = $1', [id]).catch(() => {});
  }
}

async function buildFixtures(): Promise<FixtureSet> {
  const suffix = Date.now() % 100000;
  const collegeRes = await query<{ id: number }>(
    `INSERT INTO colleges (name, code) VALUES ($1, $2) RETURNING id`,
    [`Dash College ${suffix}`, `DCD${suffix}`],
  );
  const collegeId = collegeRes.rows[0].id;
  tracked.colleges.push(collegeId);

  const progRes = await query<{ id: number }>(
    `INSERT INTO programs (college_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [collegeId, `DPR${suffix}`, `Dash Program ${suffix}`],
  );
  const programId = progRes.rows[0].id;
  tracked.programs.push(programId);

  const ylRes = await query<{ id: number }>(
    `INSERT INTO year_levels (name, sort_order) VALUES ($1, $2) RETURNING id`,
    [`Dash YL ${suffix}`, 32000 + (suffix % 700)],
  );
  const ylId = ylRes.rows[0].id;
  tracked.yearLevels.push(ylId);

  const ayRes = await query<{ id: number }>(
    `INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`Dash AY ${suffix}`, '2025-01-01', '2025-12-31', false],
  );
  tracked.academicYears.push(ayRes.rows[0].id);

  const secMain = await query<{ id: number }>(
    `INSERT INTO sections (program_id, year_level_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [programId, ylId, `Dash SecMain ${suffix}`],
  );
  tracked.sections.push(secMain.rows[0].id);
  const secOther = await query<{ id: number }>(
    `INSERT INTO sections (program_id, year_level_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [programId, ylId, `Dash SecOther ${suffix}`],
  );
  tracked.sections.push(secOther.rows[0].id);
  const ayId = tracked.academicYears[0];

  const coordRes = await query<{ id: number }>(
    `INSERT INTO users (name, email, password, account_status) VALUES ($1, $2, 'hash', 'active') RETURNING id`,
    [`Dash Coord ${suffix}`, `dashcoord${suffix}@test.local`],
  );
  const coordUserId = coordRes.rows[0].id;
  tracked.userIds.push(coordUserId);
  const roleRes = await query<{ id: number }>(`SELECT id FROM roles WHERE name = 'RSS Coordinator' LIMIT 1`);
  await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [coordUserId, roleRes.rows[0].id]);

  const studentA = await createStudent({
    emailSuffix: `dsa${suffix}`,
    studentNumber: `DSA${suffix}`,
    name: 'Dash StudentA',
    roleName: 'Student',
    sectionId: secMain.rows[0].id,
    academicYearId: ayId,
  });
  const studentB = await createStudent({
    emailSuffix: `dsb${suffix}`,
    studentNumber: `DSB${suffix}`,
    name: 'Dash StudentB',
    roleName: 'Student',
    sectionId: secOther.rows[0].id,
    academicYearId: ayId,
  });
  const sectionRep = await createStudent({
    emailSuffix: `dsr${suffix}`,
    studentNumber: `DSR${suffix}`,
    name: 'Dash SecRep',
    roleName: 'Section Representative',
    sectionId: secMain.rows[0].id,
    academicYearId: ayId,
  });

  const catRes = await query<{ id: number }>(
    `INSERT INTO task_categories (name, description, is_active) VALUES ($1, '', TRUE) RETURNING id`,
    [`Dash Cat ${suffix}`],
  );
  tracked.categories.push(catRes.rows[0].id);
  const categoryId = catRes.rows[0].id;

  const taskA = await query<{ id: number }>(
    `INSERT INTO tasks (college_id, category_id, created_by, title, description, status, visibility)
     VALUES ($1, $2, $3, $4, '', $5, $6) RETURNING id`,
    [collegeId, categoryId, coordUserId, `Dash TaskA ${suffix}`, 'published', 'all_students'],
  );
  const taskB = await query<{ id: number }>(
    `INSERT INTO tasks (college_id, category_id, created_by, title, description, status, visibility)
     VALUES ($1, $2, $3, $4, '', $5, $6) RETURNING id`,
    [collegeId, categoryId, coordUserId, `Dash TaskB ${suffix}`, 'ongoing', 'all_students'],
  );
  const taskC = await query<{ id: number }>(
    `INSERT INTO tasks (college_id, category_id, created_by, title, description, status, visibility)
     VALUES ($1, $2, $3, $4, '', $5, $6) RETURNING id`,
    [collegeId, categoryId, coordUserId, `Dash TaskC ${suffix}`, 'draft', 'all_students'],
  );
  tracked.tasks.push(taskA.rows[0].id, taskB.rows[0].id, taskC.rows[0].id);

  const sessionA1 = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location)
     VALUES ($1, 'S1a', '2025-03-01', '09:00', '10:00', 'Room 1') RETURNING id`,
    [taskA.rows[0].id],
  );
  const sessionA2 = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location)
     VALUES ($1, 'S1b', '2025-03-01', '09:00', '10:00', 'Room 1') RETURNING id`,
    [taskA.rows[0].id],
  );
  const sessionB1 = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location)
     VALUES ($1, 'S2', '2025-03-02', '09:00', '10:00', 'Room 1') RETURNING id`,
    [taskB.rows[0].id],
  );
  const sessionA3 = await query<{ id: number }>(
    `INSERT INTO task_sessions (task_id, session_title, session_date, start_time, end_time, location)
     VALUES ($1, 'S1c', '2025-03-01', '09:00', '10:00', 'Room 1') RETURNING id`,
    [taskA.rows[0].id],
  );
  tracked.taskSessionIds.push(sessionA1.rows[0].id, sessionA2.rows[0].id, sessionB1.rows[0].id, sessionA3.rows[0].id);

  const appA1 = await query<{ id: number }>(
    `INSERT INTO task_applications (task_id, student_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
    [taskA.rows[0].id, studentA.id],
  );
  const appA2 = await query<{ id: number }>(
    `INSERT INTO task_applications (task_id, student_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [taskB.rows[0].id, studentA.id],
  );
  const appB1 = await query<{ id: number }>(
    `INSERT INTO task_applications (task_id, student_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
    [taskA.rows[0].id, studentB.id],
  );
  tracked.applicationIds.push(appA1.rows[0].id, appA2.rows[0].id, appB1.rows[0].id);

  const attVerified = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status)
     VALUES ($1, $2, '2025-03-01', 5, 5, 'verified') RETURNING id`,
    [appA1.rows[0].id, sessionA1.rows[0].id],
  );
  const attRejected = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status)
     VALUES ($1, $2, '2025-03-01', 3, 0, 'rejected') RETURNING id`,
    [appA1.rows[0].id, sessionA2.rows[0].id],
  );
  const attPending = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status)
     VALUES ($1, $2, '2025-03-02', 2, 0, 'pending') RETURNING id`,
    [appA2.rows[0].id, sessionB1.rows[0].id],
  );
  const attBVerified = await query<{ id: number }>(
    `INSERT INTO attendance (application_id, task_session_id, attendance_date, recorded_hours, verified_hours, verification_status)
     VALUES ($1, $2, '2025-03-01', 4, 4, 'verified') RETURNING id`,
    [appB1.rows[0].id, sessionA3.rows[0].id],
  );
  tracked.attendanceIds.push(
    attVerified.rows[0].id,
    attRejected.rows[0].id,
    attPending.rows[0].id,
    attBVerified.rows[0].id,
  );

  const adjApproved = await query<{ id: number }>(
    `INSERT INTO service_hour_adjustments (application_id, requested_by, adjustment_hours, reason, status, approved_at)
     VALUES ($1, $2, 2, 'r1', 'approved', NOW()) RETURNING id`,
    [appA1.rows[0].id, studentA.userId],
  );
  const adjPending = await query<{ id: number }>(
    `INSERT INTO service_hour_adjustments (application_id, requested_by, adjustment_hours, reason, status)
     VALUES ($1, $2, 1, 'r2', 'pending') RETURNING id`,
    [appA2.rows[0].id, studentA.userId],
  );
  const adjBApproved = await query<{ id: number }>(
    `INSERT INTO service_hour_adjustments (application_id, requested_by, adjustment_hours, reason, status, approved_at)
     VALUES ($1, $2, 1, 'r3', 'approved', NOW()) RETURNING id`,
    [appB1.rows[0].id, studentB.userId],
  );
  tracked.adjustmentIds.push(adjApproved.rows[0].id, adjPending.rows[0].id, adjBApproved.rows[0].id);

  const accA = await query<{ id: number }>(
    `INSERT INTO accomplishments (application_id, status) VALUES ($1, 'submitted') RETURNING id`,
    [appA1.rows[0].id],
  );
  const accB = await query<{ id: number }>(
    `INSERT INTO accomplishments (application_id, status) VALUES ($1, 'approved') RETURNING id`,
    [appB1.rows[0].id],
  );
  tracked.accomplishmentIds.push(accA.rows[0].id, accB.rows[0].id);

  const expected = {
    coord: {
      activeStudents: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM students s JOIN users u ON u.id = s.user_id
         WHERE s.registration_status = 'approved' AND u.account_status = 'active' AND u.deleted_at IS NULL`,
      )).rows[0].count,
      publishedTasks: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tasks WHERE deleted_at IS NULL AND status IN ('published', 'ongoing')`,
      )).rows[0].count,
      pendingApplications: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_applications WHERE status = 'pending'`,
      )).rows[0].count,
      pendingAttendance: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM attendance WHERE verification_status = 'pending'`,
      )).rows[0].count,
      pendingAdjustments: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM service_hour_adjustments WHERE status = 'pending'`,
      )).rows[0].count,
      pendingAccomplishments: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM accomplishments WHERE status = 'submitted'`,
      )).rows[0].count,
      totalCredited: (await query<{ total: string }>(
        `SELECT (COALESCE((SELECT SUM(verified_hours) FROM attendance WHERE verification_status = 'verified'), 0)
                + COALESCE((SELECT SUM(adjustment_hours) FROM service_hour_adjustments WHERE status = 'approved'), 0))::text AS total`,
      )).rows[0].total,
    },
    studentA: {
      myPendingApplications: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_applications WHERE student_id = $1 AND status = 'pending'`,
        [studentA.id],
      )).rows[0].count,
      myApprovedApplications: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_applications WHERE student_id = $1 AND status = 'approved'`,
        [studentA.id],
      )).rows[0].count,
      // Computed below with the same formula used by the dashboard.
      verifiedServiceHours: '',
      pendingServiceHours: '',
    },
    studentB: {
      myPendingApplications: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_applications WHERE student_id = $1 AND status = 'pending'`,
        [studentB.id],
      )).rows[0].count,
      myApprovedApplications: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_applications WHERE student_id = $1 AND status = 'approved'`,
        [studentB.id],
      )).rows[0].count,
      verifiedServiceHours: '',
      pendingServiceHours: '',
    },
    secRep: {
      enrolledStudentCount: (await query<{ count: string }>(
        `SELECT COUNT(DISTINCT ssh.student_id)::text AS count
         FROM student_section_history ssh
         JOIN students s ON s.id = ssh.student_id
         WHERE ssh.section_id = $1 AND ssh.is_current AND s.registration_status = 'approved'`,
        [secMain.rows[0].id],
      )).rows[0].count,
      approvedParticipations: (await query<{ count: string }>(
        `SELECT COUNT(DISTINCT ta.id)::text AS count
         FROM task_applications ta
         JOIN student_section_history ssh ON ssh.student_id = ta.student_id AND ssh.is_current
         WHERE ssh.section_id = $1 AND ta.status = 'approved'`,
        [secMain.rows[0].id],
      )).rows[0].count,
      totalCreditedServiceHours: (await query<{ hours: string }>(
        `SELECT (COALESCE((
            SELECT SUM(att.verified_hours)
            FROM attendance att
            JOIN task_applications ta_att ON ta_att.id = att.application_id
            JOIN student_section_history ssh ON ssh.student_id = ta_att.student_id AND ssh.is_current
            WHERE ssh.section_id = $1 AND att.verification_status = 'verified'
          ), 0)
          + COALESCE((
            SELECT SUM(adj.adjustment_hours)
            FROM service_hour_adjustments adj
            JOIN task_applications ta_adj ON ta_adj.id = adj.application_id
            JOIN student_section_history ssh ON ssh.student_id = ta_adj.student_id AND ssh.is_current
            WHERE ssh.section_id = $1 AND adj.status = 'approved'
          ), 0))::text AS hours`,
        [secMain.rows[0].id],
      )).rows[0].hours,
      visiblePublishedTasksCount: (await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tasks t
         JOIN programs p ON p.college_id = t.college_id
         JOIN sections sec ON sec.program_id = p.id
         WHERE sec.id = $1 AND t.deleted_at IS NULL AND t.status = 'published'`,
        [secMain.rows[0].id],
      )).rows[0].count,
    },
  };

  // Student A scoped expectations (dashboard definition: verified attendance + approved adjustments)
  expected.studentA.verifiedServiceHours = (await query<{ total: string }>(
    `SELECT (COALESCE(SUM(att.verified_hours), 0)
       + COALESCE((
         SELECT SUM(adj.adjustment_hours)
         FROM service_hour_adjustments adj
         JOIN task_applications ta_adj ON ta_adj.id = adj.application_id
         WHERE ta_adj.student_id = $1 AND adj.status = 'approved'
       ), 0))::text AS total
     FROM attendance att
     JOIN task_applications ta ON ta.id = att.application_id
     WHERE ta.student_id = $1 AND att.verification_status = 'verified'`,
    [studentA.id],
  )).rows[0].total;
  expected.studentA.pendingServiceHours = (await query<{ total: string }>(
    `SELECT COALESCE(SUM(att.recorded_hours), 0)::text AS total
     FROM attendance att
     JOIN task_applications ta ON ta.id = att.application_id
     WHERE ta.student_id = $1 AND att.verification_status = 'pending'`,
    [studentA.id],
  )).rows[0].total;

  expected.studentB.verifiedServiceHours = (await query<{ total: string }>(
    `SELECT (COALESCE(SUM(att.verified_hours), 0)
       + COALESCE((
         SELECT SUM(adj.adjustment_hours)
         FROM service_hour_adjustments adj
         JOIN task_applications ta_adj ON ta_adj.id = adj.application_id
         WHERE ta_adj.student_id = $1 AND adj.status = 'approved'
       ), 0))::text AS total
     FROM attendance att
     JOIN task_applications ta ON ta.id = att.application_id
     WHERE ta.student_id = $1 AND att.verification_status = 'verified'`,
    [studentB.id],
  )).rows[0].total;
  expected.studentB.pendingServiceHours = (await query<{ total: string }>(
    `SELECT COALESCE(SUM(att.recorded_hours), 0)::text AS total
     FROM attendance att
     JOIN task_applications ta ON ta.id = att.application_id
     WHERE ta.student_id = $1 AND att.verification_status = 'pending'`,
    [studentB.id],
  )).rows[0].total;

  return {
    suffix,
    coordUserId,
    studentA,
    studentB,
    sectionRepUser: sectionRep,
    secMainId: Number(secMain.rows[0].id),
    secOtherId: Number(secOther.rows[0].id),
    expected,
  };
}

let fixturesPromise: Promise<FixtureSet> | null = null;
function fixtures(): Promise<FixtureSet> {
  if (!fixturesPromise) {
    fixturesPromise = buildFixtures();
  }
  return fixturesPromise;
}

function toAuthUser(f: StudentFixture): AuthenticatedUser {
  return {
    id: f.userId,
    name: f.summary.firstName,
    email: `${f.summary.studentNumber.toLowerCase()}@test.local`,
    accountStatus: 'active',
    roles: f.roles,
    primaryRole: f.roles[0] ?? 'Student',
    student: f.summary,
  };
}

test('dashboard-consistency: test database guard active', async () => {
  const res = await query<{ db: string }>('SELECT current_database() AS db');
  assert.equal(res.rows[0]?.db, 'ct_rss_test');
});

test('dashboard-consistency: coordinator dashboard totals match source queries', async () => {
  const fx = await fixtures();
  const dashboard = await getDashboardSummaryForUser({
    id: fx.coordUserId,
    name: `Dash Coord ${fx.suffix}`,
    email: `dashcoord${fx.suffix}@test.local`,
    accountStatus: 'active',
    roles: ['RSS Coordinator'],
    primaryRole: 'RSS Coordinator',
    student: null,
  });

  assert.equal(dashboard.role, 'RSS Coordinator');
  assert.ok(dashboard.coordinator, 'coordinator dashboard expected');
  assert.equal(dashboard.coordinator.activeStudents, Number(fx.expected.coord.activeStudents));
  assert.equal(dashboard.coordinator.publishedTasks, Number(fx.expected.coord.publishedTasks));
  assert.equal(dashboard.coordinator.pendingApplications, Number(fx.expected.coord.pendingApplications));
  assert.equal(dashboard.coordinator.pendingAttendanceVerifications, Number(fx.expected.coord.pendingAttendance));
  assert.equal(dashboard.coordinator.pendingHourAdjustments, Number(fx.expected.coord.pendingAdjustments));
  assert.equal(dashboard.coordinator.pendingAccomplishmentReviews, Number(fx.expected.coord.pendingAccomplishments));
  assert.equal(Math.round(dashboard.coordinator.totalCreditedServiceHours), Number(fx.expected.coord.totalCredited));
});

test('dashboard-consistency: student A dashboard matches source queries', async () => {
  const fx = await fixtures();
  const dashboard = await getDashboardSummaryForUser(toAuthUser(fx.studentA));

  assert.equal(dashboard.role, 'Student');
  assert.ok(dashboard.student, 'student dashboard expected');
  assert.equal(dashboard.student.myPendingApplications, Number(fx.expected.studentA.myPendingApplications));
  assert.equal(dashboard.student.myApprovedApplications, Number(fx.expected.studentA.myApprovedApplications));
  assert.equal(
    Math.round(dashboard.student.verifiedServiceHours),
    Number(fx.expected.studentA.verifiedServiceHours),
  );
  assert.equal(
    Math.round(dashboard.student.pendingServiceHours),
    Number(fx.expected.studentA.pendingServiceHours),
  );
});

test('dashboard-consistency: student B dashboard is scoped and shows no A records', async () => {
  const fx = await fixtures();
  const dashboard = await getDashboardSummaryForUser(toAuthUser(fx.studentB));

  assert.equal(dashboard.role, 'Student');
  assert.ok(dashboard.student, 'student dashboard expected');
  assert.equal(dashboard.student.myPendingApplications, Number(fx.expected.studentB.myPendingApplications));
  assert.equal(dashboard.student.myApprovedApplications, Number(fx.expected.studentB.myApprovedApplications));
  // B has verified attendance (4) + approved adjustment (1) = 5; A has 5 verified
  assert.equal(
    Math.round(dashboard.student.verifiedServiceHours),
    Number(fx.expected.studentB.verifiedServiceHours),
  );
  // B has no pending; A has pending 2 — B must not see A's pending hours
  assert.equal(
    Math.round(dashboard.student.pendingServiceHours),
    Number(fx.expected.studentB.pendingServiceHours),
  );
});

test('dashboard-consistency: section representative scoped dashboard matches section 1', async () => {
  const fx = await fixtures();
  const dashboard = await getDashboardSummaryForUser(toAuthUser(fx.sectionRepUser));

  assert.equal(dashboard.role, 'Section Representative');
  assert.ok(dashboard.sectionRepresentative, 'section rep dashboard expected');
  assert.equal(dashboard.sectionRepresentative.assignedSectionId, fx.secMainId);
  assert.equal(
    dashboard.sectionRepresentative.enrolledStudentCount,
    Number(fx.expected.secRep.enrolledStudentCount),
  );
  assert.equal(
    dashboard.sectionRepresentative.sectionApprovedParticipations,
    Number(fx.expected.secRep.approvedParticipations),
  );
  assert.equal(
    Math.round(dashboard.sectionRepresentative.sectionTotalCreditedHours),
    Number(fx.expected.secRep.totalCreditedServiceHours),
  );
  assert.equal(
    dashboard.sectionRepresentative.visiblePublishedTasksCount,
    Number(fx.expected.secRep.visiblePublishedTasksCount),
  );
});

test('dashboard-consistency: credited hours match the authoritative service-hour ledger', async () => {
  const fx = await fixtures();
  const dashboard = await getDashboardSummaryForUser(toAuthUser(fx.studentA));
  assert.ok(dashboard.student, 'student dashboard expected');

  const ledger = await getServiceHoursSummary({ studentId: fx.studentA.id });
  const ledgerRows = ledger.students ?? [];
  assert.equal(ledgerRows.length, 1);
  const ledgerRow = ledgerRows[0];
  const ledgerHours = Math.round((ledgerRow.verifiedAttendanceHours + ledgerRow.approvedAdjustmentHours) * 100) / 100;
  assert.equal(Math.round(dashboard.student.verifiedServiceHours), ledgerHours);
  assert.equal(
    Math.round(dashboard.student.verifiedServiceHours),
    Number(fx.expected.studentA.verifiedServiceHours),
  );
});

test('dashboard-consistency: no double counting of attendance statuses', async () => {
  const fx = await fixtures();
  // For student A: recorded_hours total = verified (5) + rejected (3) + pending (2) = 10
  const recorded = (await query<{ total: string }>(
    `SELECT COALESCE(SUM(recorded_hours), 0)::text AS total
     FROM attendance att
     JOIN task_applications ta ON ta.id = att.application_id
     WHERE ta.student_id = $1`,
    [fx.studentA.id],
  )).rows[0].total;
  const verifiedPlusNonVerified = (await query<{ total: string }>(
    `SELECT (COALESCE(SUM(verified_hours), 0)
       + COALESCE(SUM(recorded_hours) FILTER (WHERE verification_status = 'rejected'), 0)
       + COALESCE(SUM(recorded_hours) FILTER (WHERE verification_status = 'pending'), 0))::text AS total
     FROM attendance att
     JOIN task_applications ta ON ta.id = att.application_id
     WHERE ta.student_id = $1`,
    [fx.studentA.id],
  )).rows[0].total;
  assert.equal(Number(recorded), 10);
  assert.equal(Number(verifiedPlusNonVerified), Number(recorded));
});

test.after(async () => {
  await cleanup();
  await closeDatabasePool();
});
