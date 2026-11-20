import { query } from '../config/database.ts';
import type {
  AuthenticatedUser,
  DashboardSummaryResponse,
  RssReportRecord,
  SectionRepOverviewResponse,
  StudentTaskRecord,
  TaskCategoryRecord,
} from '../types/api.ts';
import { listRssReports } from './reportService.ts';
import { listTaskCategories } from './taskService.ts';

export async function resolveSectionRepAssignedSectionId(
  studentId: number | null | undefined,
): Promise<number | null> {
  if (!studentId) {
    return null;
  }
  const res = await query<{ section_id: number }>(
    `SELECT section_id
     FROM student_section_history
     WHERE student_id = $1 AND is_current = TRUE
     LIMIT 1`,
    [studentId],
  );
  return res.rows[0]?.section_id ? Number(res.rows[0].section_id) : null;
}

export async function getDashboardSummaryForUser(
  user: AuthenticatedUser,
): Promise<DashboardSummaryResponse> {
  const unreadRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM notifications
     WHERE user_id = $1 AND read_at IS NULL`,
    [user.id],
  );
  const unreadNotifications = Number.parseInt(unreadRes.rows[0]?.count ?? '0', 10) || 0;

  if (user.primaryRole === 'RSS Coordinator') {
    const [
      regRes,
      stuRes,
      taskRes,
      appRes,
      attRes,
      adjRes,
      accRes,
      hoursRes,
      repRes,
    ] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM students WHERE registration_status = 'pending'`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM students s
         JOIN users u ON u.id = s.user_id
         WHERE s.registration_status = 'approved' AND u.account_status = 'active' AND u.deleted_at IS NULL`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tasks
         WHERE deleted_at IS NULL AND status IN ('published', 'ongoing')`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM task_applications WHERE status = 'pending'`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM attendance WHERE verification_status = 'pending'`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM service_hour_adjustments WHERE status = 'pending'`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM accomplishments WHERE status = 'submitted'`,
      ),
      query<{ total_hours: string }>(
        `SELECT (
           COALESCE((SELECT SUM(verified_hours) FROM attendance WHERE verification_status = 'verified'), 0)
           + COALESCE((SELECT SUM(adjustment_hours) FROM service_hour_adjustments WHERE status = 'approved'), 0)
         )::text AS total_hours`,
      ),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM rss_reports`),
    ]);

    return {
      role: 'RSS Coordinator',
      coordinator: {
        pendingRegistrations: Number.parseInt(regRes.rows[0]?.count ?? '0', 10) || 0,
        activeStudents: Number.parseInt(stuRes.rows[0]?.count ?? '0', 10) || 0,
        publishedTasks: Number.parseInt(taskRes.rows[0]?.count ?? '0', 10) || 0,
        pendingApplications: Number.parseInt(appRes.rows[0]?.count ?? '0', 10) || 0,
        pendingAttendanceVerifications: Number.parseInt(attRes.rows[0]?.count ?? '0', 10) || 0,
        pendingHourAdjustments: Number.parseInt(adjRes.rows[0]?.count ?? '0', 10) || 0,
        pendingAccomplishmentReviews: Number.parseInt(accRes.rows[0]?.count ?? '0', 10) || 0,
        totalCreditedServiceHours:
          Math.round((Number(hoursRes.rows[0]?.total_hours ?? '0') || 0) * 100) / 100,
        generatedReportsCount: Number.parseInt(repRes.rows[0]?.count ?? '0', 10) || 0,
        unreadNotifications,
      },
    };
  }

  if (user.primaryRole === 'Student') {
    const studentId = user.student?.id ?? 0;
    const secRes = await query<{ college_id: number | null; section_id: number | null }>(
      `SELECT p.college_id, ssh.section_id
       FROM student_section_history ssh
       JOIN sections sec ON sec.id = ssh.section_id
       JOIN programs p ON p.id = sec.program_id
       WHERE ssh.student_id = $1 AND ssh.is_current = TRUE
       LIMIT 1`,
      [studentId],
    );
    const collegeId = secRes.rows[0]?.college_id ? Number(secRes.rows[0].college_id) : null;

    const [tasksRes, appRes, hoursRes, accRes, repRes] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tasks t
         WHERE t.deleted_at IS NULL
           AND t.status = 'published'
           AND (
             (t.visibility = 'all_students' AND ($2::bigint IS NULL OR t.college_id = $2::bigint))
             OR (
               t.visibility = 'specific_sections'
               AND EXISTS (
                 SELECT 1 FROM task_target_sections tts
                 JOIN student_section_history ssh ON ssh.section_id = tts.section_id
                 WHERE tts.task_id = t.id AND ssh.student_id = $1 AND ssh.is_current = TRUE
               )
             )
             OR (
               t.visibility = 'selected_students'
               AND EXISTS (
                 SELECT 1 FROM task_target_students ttu
                 WHERE ttu.task_id = t.id AND ttu.student_id = $1
               )
             )
           )`,
        [studentId, collegeId],
      ),
      query<{ pending: string; approved: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
           COUNT(*) FILTER (WHERE status = 'approved')::text AS approved
         FROM task_applications
         WHERE student_id = $1`,
        [studentId],
      ),
      query<{ verified_att: string; pending_att: string; approved_adj: string }>(
        `SELECT
           COALESCE((
             SELECT SUM(att.verified_hours)
             FROM attendance att
             JOIN task_applications ta ON ta.id = att.application_id
             WHERE ta.student_id = $1 AND att.verification_status = 'verified'
           ), 0)::text AS verified_att,
           COALESCE((
             SELECT SUM(att.recorded_hours)
             FROM attendance att
             JOIN task_applications ta ON ta.id = att.application_id
             WHERE ta.student_id = $1 AND att.verification_status = 'pending'
           ), 0)::text AS pending_att,
           COALESCE((
             SELECT SUM(adj.adjustment_hours)
             FROM service_hour_adjustments adj
             JOIN task_applications ta ON ta.id = adj.application_id
             WHERE ta.student_id = $1 AND adj.status = 'approved'
           ), 0)::text AS approved_adj`,
        [studentId],
      ),
      query<{ draft_rev: string; approved: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE acc.status IN ('draft', 'revision_required'))::text AS draft_rev,
           COUNT(*) FILTER (WHERE acc.status = 'approved')::text AS approved
         FROM accomplishments acc
         JOIN task_applications ta ON ta.id = acc.application_id
         WHERE ta.student_id = $1`,
        [studentId],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM rss_reports rr
         JOIN accomplishment_submissions sub ON sub.id = rr.accomplishment_submission_id
         JOIN accomplishments acc ON acc.id = sub.accomplishment_id
         JOIN task_applications ta ON ta.id = acc.application_id
         WHERE rr.report_type = 'individual' AND ta.student_id = $1`,
        [studentId],
      ),
    ]);

    const verifiedHours =
      (Number(hoursRes.rows[0]?.verified_att ?? '0') || 0) +
      (Number(hoursRes.rows[0]?.approved_adj ?? '0') || 0);

    return {
      role: 'Student',
      student: {
        eligiblePublishedTasks: Number.parseInt(tasksRes.rows[0]?.count ?? '0', 10) || 0,
        myPendingApplications: Number.parseInt(appRes.rows[0]?.pending ?? '0', 10) || 0,
        myApprovedApplications: Number.parseInt(appRes.rows[0]?.approved ?? '0', 10) || 0,
        verifiedServiceHours: Math.round(verifiedHours * 100) / 100,
        pendingServiceHours:
          Math.round((Number(hoursRes.rows[0]?.pending_att ?? '0') || 0) * 100) / 100,
        draftOrRevisionAccomplishments:
          Number.parseInt(accRes.rows[0]?.draft_rev ?? '0', 10) || 0,
        approvedAccomplishments: Number.parseInt(accRes.rows[0]?.approved ?? '0', 10) || 0,
        availableIndividualReports: Number.parseInt(repRes.rows[0]?.count ?? '0', 10) || 0,
        unreadNotifications,
      },
    };
  }

  // Section Representative scoped read-only summary
  const repOverview = await getSectionRepScopedOverview(user);
  if (!repOverview.assigned || !repOverview.section || !repOverview.summary) {
    return {
      role: 'Section Representative',
      sectionRepresentative: {
        assignedSectionId: null,
        assignedSectionLabel: null,
        academicYearName: null,
        enrolledStudentCount: 0,
        visiblePublishedTasksCount: 0,
        sectionApprovedParticipations: 0,
        sectionTotalCreditedHours: 0,
        sectionApprovedAccomplishments: 0,
        authorizedSectionReportsCount: 0,
        unreadNotifications,
      },
    };
  }

  const [tasksRes, repCountRes] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM tasks t
       JOIN programs p ON p.college_id = t.college_id
       JOIN sections sec ON sec.program_id = p.id
       WHERE sec.id = $1
         AND t.deleted_at IS NULL
         AND t.status = 'published'
         AND (
           t.visibility = 'all_students'
           OR (
             t.visibility = 'specific_sections'
             AND EXISTS (
               SELECT 1 FROM task_target_sections tts
               WHERE tts.task_id = t.id AND tts.section_id = $1
             )
           )
         )`,
      [repOverview.section.sectionId],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rss_reports
       WHERE report_type = 'section' AND section_id = $1`,
      [repOverview.section.sectionId],
    ),
  ]);

  return {
    role: 'Section Representative',
    sectionRepresentative: {
      assignedSectionId: repOverview.section.sectionId,
      assignedSectionLabel: `${repOverview.section.programCode} ${repOverview.section.yearLevelName} ${repOverview.section.sectionName}`,
      academicYearName: repOverview.section.academicYearName,
      enrolledStudentCount: repOverview.section.activeEnrolledStudentsCount,
      visiblePublishedTasksCount: Number.parseInt(tasksRes.rows[0]?.count ?? '0', 10) || 0,
      sectionApprovedParticipations: repOverview.summary.approvedApplications,
      sectionTotalCreditedHours: repOverview.summary.totalCreditedServiceHours,
      sectionApprovedAccomplishments: repOverview.summary.approvedAccomplishmentsCount,
      authorizedSectionReportsCount: Number.parseInt(repCountRes.rows[0]?.count ?? '0', 10) || 0,
      unreadNotifications,
    },
  };
}

export async function getSectionRepScopedOverview(
  user: AuthenticatedUser,
): Promise<SectionRepOverviewResponse> {
  const studentId = user.student?.id ?? null;
  if (!studentId) {
    return {
      accessMode: 'read_only',
      role: 'Section Representative',
      assigned: false,
      collegeName: 'College of Technology',
      section: null,
      summary: null,
      message:
        'Your Section Representative account does not have an assigned student section record in student_section_history yet. Ask the RSS Coordinator to link your student profile and current section.',
    };
  }

  const secRes = await query<{
    section_id: number;
    section_name: string;
    program_code: string;
    program_name: string;
    year_level_name: string;
    academic_year_name: string;
    college_name: string;
    enrolled_at: string;
  }>(
    `SELECT
       sec.id AS section_id,
       sec.name AS section_name,
       p.code AS program_code,
       p.name AS program_name,
       yl.name AS year_level_name,
       ay.name AS academic_year_name,
       c.name AS college_name,
       ssh.enrolled_at::text AS enrolled_at
     FROM student_section_history ssh
     JOIN sections sec ON sec.id = ssh.section_id
     JOIN programs p ON p.id = sec.program_id
     JOIN colleges c ON c.id = p.college_id
     JOIN year_levels yl ON yl.id = sec.year_level_id
     JOIN academic_years ay ON ay.id = ssh.academic_year_id
     WHERE ssh.student_id = $1 AND ssh.is_current = TRUE
     LIMIT 1`,
    [studentId],
  );
  const sec = secRes.rows[0];
  if (!sec) {
    return {
      accessMode: 'read_only',
      role: 'Section Representative',
      assigned: false,
      collegeName: 'College of Technology',
      section: null,
      summary: null,
      message:
        'No current active section assignment was found for your profile. Aggregate section views remain restricted until assigned by the RSS Coordinator.',
    };
  }

  const sectionId = Number(sec.section_id);
  const [enrolledRes, appRes, attRes, adjRes, accRes] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(DISTINCT ssh.student_id)::text AS count
       FROM student_section_history ssh
       JOIN students s ON s.id = ssh.student_id
       WHERE ssh.section_id = $1 AND ssh.is_current = TRUE AND s.registration_status = 'approved'`,
      [sectionId],
    ),
    query<{ total: string; approved: string }>(
      `SELECT
         COUNT(DISTINCT ta.id)::text AS total,
         COUNT(DISTINCT ta.id) FILTER (WHERE ta.status = 'approved')::text AS approved
       FROM task_applications ta
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id AND ssh.is_current = TRUE
       WHERE ssh.section_id = $1`,
      [sectionId],
    ),
    query<{ entries: string; hours: string }>(
      `SELECT
         COUNT(DISTINCT att.id)::text AS entries,
         COALESCE(SUM(att.verified_hours), 0)::text AS hours
       FROM attendance att
       JOIN task_applications ta ON ta.id = att.application_id
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id AND ssh.is_current = TRUE
       WHERE ssh.section_id = $1 AND att.verification_status = 'verified'`,
      [sectionId],
    ),
    query<{ hours: string }>(
      `SELECT COALESCE(SUM(adj.adjustment_hours), 0)::text AS hours
       FROM service_hour_adjustments adj
       JOIN task_applications ta ON ta.id = adj.application_id
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id AND ssh.is_current = TRUE
       WHERE ssh.section_id = $1 AND adj.status = 'approved'`,
      [sectionId],
    ),
    query<{ count: string }>(
      `SELECT COUNT(DISTINCT sub.id)::text AS count
       FROM accomplishment_submissions sub
       JOIN accomplishments acc ON acc.id = sub.accomplishment_id
       JOIN task_applications ta ON ta.id = acc.application_id
       JOIN student_section_history ssh ON ssh.student_id = ta.student_id AND ssh.is_current = TRUE
       WHERE ssh.section_id = $1 AND sub.status = 'approved'`,
      [sectionId],
    ),
  ]);

  const totalHours =
    (Number(attRes.rows[0]?.hours ?? '0') || 0) + (Number(adjRes.rows[0]?.hours ?? '0') || 0);

  return {
    accessMode: 'read_only',
    role: 'Section Representative',
    assigned: true,
    collegeName: sec.college_name,
    section: {
      sectionId,
      sectionName: sec.section_name,
      programCode: sec.program_code,
      programName: sec.program_name,
      yearLevelName: sec.year_level_name,
      academicYearName: sec.academic_year_name,
      enrolledAt: sec.enrolled_at,
      activeEnrolledStudentsCount: Number.parseInt(enrolledRes.rows[0]?.count ?? '0', 10) || 0,
    },
    summary: {
      totalApplications: Number.parseInt(appRes.rows[0]?.total ?? '0', 10) || 0,
      approvedApplications: Number.parseInt(appRes.rows[0]?.approved ?? '0', 10) || 0,
      verifiedAttendanceEntries: Number.parseInt(attRes.rows[0]?.entries ?? '0', 10) || 0,
      totalCreditedServiceHours: Math.round(totalHours * 100) / 100,
      approvedAccomplishmentsCount: Number.parseInt(accRes.rows[0]?.count ?? '0', 10) || 0,
    },
    message:
      'Showing read-only aggregate metrics strictly for your assigned section. Private student records and coordinator approval controls are hidden.',
  };
}

export async function listSectionRepScopedTasks(user: AuthenticatedUser): Promise<{
  assigned: boolean;
  sectionLabel: string | null;
  tasks: StudentTaskRecord[];
  categories: TaskCategoryRecord[];
}> {
  const overview = await getSectionRepScopedOverview(user);
  if (!overview.assigned || !overview.section) {
    return { assigned: false, sectionLabel: null, tasks: [], categories: [] };
  }

  const sectionId = overview.section.sectionId;
  const [tasksRes, categories] = await Promise.all([
    query<{
      id: number;
      college_id: number;
      college_code: string;
      college_name: string;
      category_id: number;
      category_name: string;
      title: string;
      description: string;
      location: string | null;
      visibility: 'all_students' | 'specific_sections' | 'selected_students';
      capacity: number | null;
      approved_count: string;
      required_hours: string | null;
      application_start: string | null;
      application_deadline: string | null;
      activity_start: string | null;
      activity_end: string | null;
      status: 'published';
      session_count: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         t.id,
         t.college_id,
         c.code AS college_code,
         c.name AS college_name,
         t.category_id,
         tc.name AS category_name,
         t.title,
         t.description,
         t.location,
         t.visibility,
         t.capacity,
         (
           SELECT COUNT(*)::text
           FROM task_applications ta
           WHERE ta.task_id = t.id AND ta.status = 'approved'
         ) AS approved_count,
         t.required_hours::text AS required_hours,
         t.application_start::text AS application_start,
         t.application_deadline::text AS application_deadline,
         t.activity_start::text AS activity_start,
         t.activity_end::text AS activity_end,
         t.status,
         (
           SELECT COUNT(*)::text FROM task_sessions ts WHERE ts.task_id = t.id
         ) AS session_count,
         t.created_at::text AS created_at,
         t.updated_at::text AS updated_at
       FROM tasks t
       JOIN colleges c ON c.id = t.college_id
       JOIN task_categories tc ON tc.id = t.category_id
       JOIN programs p ON p.college_id = c.id
       JOIN sections sec ON sec.program_id = p.id
       WHERE sec.id = $1
         AND t.deleted_at IS NULL
         AND t.status = 'published'
         AND (
           t.visibility = 'all_students'
           OR (
             t.visibility = 'specific_sections'
             AND EXISTS (
               SELECT 1 FROM task_target_sections tts
               WHERE tts.task_id = t.id AND tts.section_id = $1
             )
           )
         )
       ORDER BY t.application_deadline ASC NULLS LAST, t.created_at DESC`,
      [sectionId],
    ),
    listTaskCategories(true),
  ]);

  const tasks: StudentTaskRecord[] = tasksRes.rows.map((r) => {
    const cap = r.capacity !== null ? Number(r.capacity) : null;
    const appCnt = Number.parseInt(r.approved_count ?? '0', 10) || 0;
    return {
      id: Number(r.id),
      collegeId: Number(r.college_id),
      collegeCode: r.college_code,
      collegeName: r.college_name,
      categoryId: Number(r.category_id),
      categoryName: r.category_name,
      title: r.title,
      description: r.description,
      location: r.location,
      visibility: r.visibility,
      eligibilityReason:
        r.visibility === 'all_students' ? 'Open to All College Students' : 'Targeted to Your Section',
      capacity: cap,
      approvedCount: appCnt,
      remainingCapacity: cap !== null ? Math.max(0, cap - appCnt) : null,
      isFull: cap !== null && appCnt >= cap,
      requiredHours: r.required_hours !== null ? Number(r.required_hours) : null,
      applicationStart: r.application_start,
      applicationDeadline: r.application_deadline,
      activityStart: r.activity_start,
      activityEnd: r.activity_end,
      status: r.status,
      sessionCount: Number.parseInt(r.session_count ?? '0', 10) || 0,
      myApplicationStatus: null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  return {
    assigned: true,
    sectionLabel: `${overview.section.programCode} ${overview.section.yearLevelName} ${overview.section.sectionName}`,
    tasks,
    categories,
  };
}

export async function listSectionRepScopedReports(user: AuthenticatedUser): Promise<{
  assigned: boolean;
  sectionLabel: string | null;
  reports: RssReportRecord[];
}> {
  const overview = await getSectionRepScopedOverview(user);
  if (!overview.assigned || !overview.section) {
    return { assigned: false, sectionLabel: null, reports: [] };
  }
  const reports = await listRssReports({
    reportType: 'section',
    sectionId: overview.section.sectionId,
  });
  return {
    assigned: true,
    sectionLabel: `${overview.section.programCode} ${overview.section.yearLevelName} ${overview.section.sectionName}`,
    reports,
  };
}
