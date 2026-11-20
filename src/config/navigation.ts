import type { NavGroup, RoleName } from '../types/index.ts';

export const ROLE_NAVIGATION: Record<RoleName, NavGroup[]> = {
  'RSS Coordinator': [
    {
      id: 'overview',
      title: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          description:
            'Lapu-Lapu City College CT-RSS operational overview with live database metrics and milestone status.',
          milestoneNumber: 10,
          milestoneLabel: 'Live Role Dashboard',
          emptyStateTitle: 'No operational metrics recorded yet',
          emptyStateDescription:
            'Live database totals for students, tasks, applications, verified hours, and reports populate as workflows are used.',
        },
      ],
    },
    {
      id: 'student-management',
      title: 'Academic & Student Management',
      items: [
        {
          id: 'registrations',
          label: 'Registrations',
          description:
            'Review queue for pending student account registrations with Coordinator approval, rejection, and audit tracking.',
          milestoneNumber: 3,
          milestoneLabel: 'Milestone 3 — Authentication & Authorization',
          emptyStateTitle: 'No pending student registrations yet',
          emptyStateDescription:
            'Student account submissions and Coordinator approval workflows are active.',
          plannedColumns: ['Student Number', 'Full Name', 'Program & Section', 'Submitted At', 'Status', 'Action'],
        },
        {
          id: 'academic-years',
          label: 'Academic Years',
          description:
            'Create and manage institutional academic years, validate date ranges, and designate the single current academic year.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'No academic years created yet',
          emptyStateDescription:
            'Create an academic year to organize student section enrollments and reports.',
        },
        {
          id: 'programs',
          label: 'Programs',
          description:
            'Manage degree programs assigned to Lapu-Lapu City College departments, program codes, and active status.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'No academic programs created yet',
          emptyStateDescription:
            'Create institutional degree programs assigned to College of Technology.',
        },
        {
          id: 'sections',
          label: 'Sections',
          description:
            'Create and manage sections mapped to programs and year levels, and inspect enrolled students per section.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'No sections created yet',
          emptyStateDescription:
            'Create sections under active programs and year levels.',
        },
        {
          id: 'students',
          label: 'Students',
          description:
            'Authorized student directory, Coordinator student registration, profile editing, account status management, and section assignment history.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'No students registered yet',
          emptyStateDescription:
            'Register students or approve student registration requests to populate the student directory.',
        },
      ],
    },
    {
      id: 'rss-operations',
      title: 'RSS Operations',
      items: [
        {
          id: 'tasks-activities',
          label: 'Tasks & Activities',
          description:
            'Create and manage RSS task categories, draft and published tasks, audience visibility targeting, participant capacity, and scheduled task sessions.',
          milestoneNumber: 5,
          milestoneLabel: 'Milestone 5 — RSS Task Management',
          emptyStateTitle: 'No RSS tasks created yet',
          emptyStateDescription:
            'Create task categories and draft or publish RSS tasks with visibility targeting and scheduled sessions.',
        },
        {
          id: 'applications',
          label: 'Applications',
          description:
            'Coordinator review queue for student task applications with capacity locking, review history, and decision remarks.',
          milestoneNumber: 6,
          milestoneLabel: 'Milestone 6 — Application Management',
          emptyStateTitle: 'No applications found',
          emptyStateDescription:
            'Student task applications will appear here as eligible students apply to published RSS tasks.',
        },
        {
          id: 'attendance',
          label: 'Attendance',
          description:
            'Session check-in/check-out attendance roster recording, hours verification, and Coordinator corrections.',
          milestoneNumber: 7,
          milestoneLabel: 'Milestone 7 — Attendance & Service Hours',
          emptyStateTitle: 'No attendance records yet',
          emptyStateDescription:
            'Select a task session to record participant attendance and verify earned service hours.',
        },
        {
          id: 'service-hours',
          label: 'Service Hours',
          description:
            'Official credited service-hour ledger (verified attendance plus approved adjustments) and hour-adjustment approvals.',
          milestoneNumber: 7,
          milestoneLabel: 'Milestone 7 — Attendance & Service Hours',
          emptyStateTitle: 'No verified service-hour records yet',
          emptyStateDescription:
            'Verified attendance hours and approved adjustments automatically compute official student totals here.',
        },
        {
          id: 'accomplishments',
          label: 'Accomplishments',
          description:
            'Review versioned student accomplishment submissions, inspect categorized evidence photos (before, during, after, other), and manage revisions.',
          milestoneNumber: 8,
          milestoneLabel: 'Milestone 8 — Accomplishments & Evidence',
          emptyStateTitle: 'No accomplishments submitted',
          emptyStateDescription:
            'Student accomplishment submissions and uploaded categorized photo evidence will appear here for Coordinator review.',
        },
      ],
    },
    {
      id: 'reports',
      title: 'Reports',
      items: [
        {
          id: 'individual-rss-reports',
          label: 'Individual RSS Reports',
          description:
            'Preview, generate, and archive official individual RSS PDF reports linked to exact approved accomplishment submissions.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No individual RSS reports generated yet',
          emptyStateDescription:
            'Select an approved student and active report template to generate an official Individual RSS PDF report.',
        },
        {
          id: 'section-rss-reports',
          label: 'Section RSS Reports',
          description:
            'Preview, generate, and compare consolidated section RSS PDF reports with report item tracking.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No section RSS reports generated yet',
          emptyStateDescription:
            'Select a section and academic year to preview aggregate participation and generate a consolidated PDF report.',
        },
        {
          id: 'report-templates',
          label: 'Report Templates',
          description:
            'Create, configure, version, and activate official college-specific Lapu-Lapu City College RSS PDF templates.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No official report templates created yet',
          emptyStateDescription:
            'Create an active college report template before generating official Individual or Section RSS PDF reports.',
        },
      ],
    },
    {
      id: 'system',
      title: 'System',
      items: [
        {
          id: 'notifications',
          label: 'Notifications',
          description:
            'In-system workflow notifications for registrations, task applications, attendance verification, accomplishments, and reports.',
          milestoneNumber: 10,
          milestoneLabel: 'Milestone 10 — Dashboards & Notifications',
          emptyStateTitle: 'No notifications yet',
          emptyStateDescription:
            'Workflow notifications triggered by portal activity will appear here.',
        },
        {
          id: 'audit-logs',
          label: 'Audit Logs',
          description:
            'Read-only, immutable audit trail of logins, approvals, role assignments, attendance verifications, and generated reports.',
          milestoneNumber: 11,
          milestoneLabel: 'Milestone 11 — Integration, Testing & Security',
          emptyStateTitle: 'No audit log entries matched',
          emptyStateDescription:
            'System audit records backed by PostgreSQL audit_logs appear here for security and accountability review.',
        },
      ],
    },
  ],
  Student: [
    {
      id: 'overview',
      title: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          description:
            'Personal Student Service portal overview showing verified RSS hours, active applications, and submission status.',
          milestoneNumber: 10,
          milestoneLabel: 'Live Student Dashboard',
          emptyStateTitle: 'Personal RSS metrics load from your records',
          emptyStateDescription:
            'Your verified service hours, applications, and accomplishments appear here.',
        },
      ],
    },
    {
      id: 'student-profile',
      title: 'My Account',
      items: [
        {
          id: 'my-profile',
          label: 'My Profile',
          description:
            'Personal student number, registration approval status, program, year level, and current section.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'Student profile requires authentication',
          emptyStateDescription:
            'Your academic profile and section history are linked to your approved student record.',
        },
      ],
    },
    {
      id: 'rss-operations',
      title: 'RSS Participation',
      items: [
        {
          id: 'tasks-activities',
          label: 'Available Tasks',
          description:
            'Published RSS tasks filtered on the backend for your college, section, and student eligibility with direct application submission.',
          milestoneNumber: 5,
          milestoneLabel: 'Milestone 5 — RSS Task Management',
          emptyStateTitle: 'No RSS tasks available',
          emptyStateDescription:
            'Eligible tasks published by the College of Technology RSS Coordinator will appear here.',
        },
        {
          id: 'applications',
          label: 'My Applications',
          description:
            'Track pending, approved, rejected, withdrawn, or cancelled RSS task applications and Coordinator remarks.',
          milestoneNumber: 6,
          milestoneLabel: 'Milestone 6 — Application Management',
          emptyStateTitle: 'No applications found',
          emptyStateDescription:
            'Apply to an eligible published task under Available Tasks to track your application here.',
        },
        {
          id: 'attendance',
          label: 'Attendance',
          description:
            'Your recorded task session check-ins/check-outs and Coordinator verification status.',
          milestoneNumber: 7,
          milestoneLabel: 'Milestone 7 — Attendance & Service Hours',
          emptyStateTitle: 'No attendance records yet',
          emptyStateDescription:
            'Attendance recorded by the RSS Coordinator for your approved task sessions will appear here.',
        },
        {
          id: 'service-hours',
          label: 'Service Hours',
          description:
            'Official credited RSS total calculated from verified attendance plus approved service-hour adjustments.',
          milestoneNumber: 7,
          milestoneLabel: 'Milestone 7 — Attendance & Service Hours',
          emptyStateTitle: 'No credited service hours recorded yet',
          emptyStateDescription:
            'Verified attendance hours, pending hours, and adjustment requests appear here.',
        },
        {
          id: 'accomplishments',
          label: 'Accomplishments',
          description:
            'Draft accomplishments, upload categorized photo evidence, view immutable submission version history, and respond to revisions.',
          milestoneNumber: 8,
          milestoneLabel: 'Milestone 8 — Accomplishments & Evidence',
          emptyStateTitle: 'No accomplishments submitted',
          emptyStateDescription:
            'Submit your accomplishment report and categorized evidence images for any approved task.',
        },
      ],
    },
    {
      id: 'reports',
      title: 'Reports & Alerts',
      items: [
        {
          id: 'individual-rss-reports',
          label: 'My RSS Reports',
          description:
            'Authorized individual RSS PDF reports generated from your approved accomplishment submissions and printable service summary.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No authorized reports available yet',
          emptyStateDescription:
            'Official Individual RSS PDF reports generated for your approved accomplishments will appear here.',
        },
        {
          id: 'notifications',
          label: 'Notifications',
          description:
            'Personal alerts for registration approval, application outcomes, attendance verification, revisions, and generated reports.',
          milestoneNumber: 10,
          milestoneLabel: 'Milestone 10 — Dashboards & Notifications',
          emptyStateTitle: 'No notifications yet',
          emptyStateDescription:
            'Workflow notifications related to your student service participation will appear here.',
        },
      ],
    },
  ],
  'Section Representative': [
    {
      id: 'overview',
      title: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          description:
            'Read-only section overview scoped strictly to authorized section information and participation summaries.',
          milestoneNumber: 10,
          milestoneLabel: 'Live Section Dashboard',
          emptyStateTitle: 'Section summary loads from your assigned section',
          emptyStateDescription:
            'Permitted aggregate section participation summaries appear here without exposing private student records.',
        },
      ],
    },
    {
      id: 'section-scope',
      title: 'Section Scope (Read-Only)',
      items: [
        {
          id: 'academic-structure',
          label: 'Section Information',
          description:
            'Assigned college, program, year level, section identifier, current academic year, and aggregate participation metrics.',
          milestoneNumber: 4,
          milestoneLabel: 'Section Scope (Read-Only)',
          emptyStateTitle: 'No section assignment linked yet',
          emptyStateDescription:
            'Ask the RSS Coordinator to link your student profile and current section assignment.',
        },
        {
          id: 'tasks-activities',
          label: 'Authorized Tasks',
          description:
            'Read-only view of published RSS tasks visible to your assigned section.',
          milestoneNumber: 5,
          milestoneLabel: 'Milestone 5 — RSS Task Visibility',
          emptyStateTitle: 'No authorized section tasks yet',
          emptyStateDescription:
            'Published tasks targeting your section or all college students appear here.',
        },
        {
          id: 'section-rss-reports',
          label: 'Authorized Summaries',
          description:
            'Read-only section-level participation summaries and official section PDF reports (no approval controls).',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — Section RSS Reports',
          emptyStateTitle: 'No authorized section reports yet',
          emptyStateDescription:
            'Consolidated section PDF reports generated for your assigned section appear here.',
        },
      ],
    },
    {
      id: 'system',
      title: 'System',
      items: [
        {
          id: 'notifications',
          label: 'Notifications',
          description: 'Personal and authorized section workflow notifications.',
          milestoneNumber: 10,
          milestoneLabel: 'Milestone 10 — Notifications',
          emptyStateTitle: 'No notifications yet',
          emptyStateDescription: 'Notifications for your account will appear here.',
        },
      ],
    },
  ],
};
