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
            'Lapu-Lapu City College CT-RSS foundation overview, live API readiness, and 12-milestone roadmap.',
          milestoneNumber: 1,
          milestoneLabel: 'Milestone 1 — Project Foundation',
          emptyStateTitle: 'Coordinator operational metrics connect in Milestone 10',
          emptyStateDescription:
            'Live database totals for students, tasks, applications, verified hours, and reviews will appear once Milestones 2–10 are completed.',
        },
      ],
    },
    {
      id: 'student-management',
      title: 'Student Management',
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
            'Student account submissions and Coordinator approval workflows will be enabled after Milestone 2 (Database) and Milestone 3 (Authentication).',
          plannedColumns: ['Student Number', 'Full Name', 'Program & Section', 'Submitted At', 'Status', 'Action'],
        },
        {
          id: 'students',
          label: 'Students',
          description:
            'Authorized student directory, profile records, section history, and credited RSS hour totals.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'No students registered yet',
          emptyStateDescription:
            'Student profiles, academic filtering, and historical section records will populate here in Milestone 4.',
          plannedColumns: ['Student No.', 'Name', 'Program', 'Year & Section', 'Verified Hours', 'Status'],
        },
        {
          id: 'academic-structure',
          label: 'Academic Structure',
          description:
            'Manage Colleges (starting with College of Technology), Programs, Year Levels, Academic Years, and Sections.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'Academic structure is not populated yet',
          emptyStateDescription:
            'Colleges, programs, year levels, academic years, and historical section assignments will be managed here in Milestone 4.',
          plannedColumns: ['Unit Type', 'Code', 'Name', 'Parent Scope', 'Status'],
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
            'Manage RSS task categories, draft/published tasks, visibility targeting (all, section, individual), capacity, and scheduled sessions.',
          milestoneNumber: 5,
          milestoneLabel: 'Milestone 5 — RSS Task Management',
          emptyStateTitle: 'No RSS tasks created yet',
          emptyStateDescription:
            'Task category creation, task drafting, target visibility, and session scheduling will be implemented in Milestone 5.',
          plannedColumns: ['Task Title', 'Category', 'Visibility', 'Capacity', 'Deadline', 'Status'],
        },
        {
          id: 'applications',
          label: 'Applications',
          description:
            'Coordinator review queue for student task applications with capacity locking and decision remarks.',
          milestoneNumber: 6,
          milestoneLabel: 'Milestone 6 — Application Management',
          emptyStateTitle: 'No applications found',
          emptyStateDescription:
            'Student task applications and Coordinator approval/rejection reviews will be implemented in Milestone 6.',
          plannedColumns: ['Applicant', 'Task', 'Applied At', 'Status', 'Review'],
        },
        {
          id: 'attendance',
          label: 'Attendance',
          description:
            'Session check-in/check-out attendance records and Coordinator verification queue.',
          milestoneNumber: 7,
          milestoneLabel: 'Milestone 7 — Attendance & Service Hours',
          emptyStateTitle: 'No attendance records yet',
          emptyStateDescription:
            'Session attendance recording and Coordinator verification will be built in Milestone 7.',
          plannedColumns: ['Student', 'Task Session', 'Date', 'Recorded Hrs', 'Verified Hrs', 'Status'],
        },
        {
          id: 'service-hours',
          label: 'Service Hours',
          description:
            'Official credited service-hour ledger (verified attendance plus approved adjustments) and hour-adjustment requests.',
          milestoneNumber: 7,
          milestoneLabel: 'Milestone 7 — Attendance & Service Hours',
          emptyStateTitle: 'No verified service-hour records yet',
          emptyStateDescription:
            'Credited service-hour totals and positive/negative adjustment approvals will be implemented in Milestone 7.',
          plannedColumns: ['Student', 'Verified Attendance', 'Approved Adjustments', 'Total Credited', 'Status'],
        },
        {
          id: 'accomplishments',
          label: 'Accomplishments',
          description:
            'Review versioned student accomplishment submissions, categorized evidence photos (before, during, after, other), and revision requests.',
          milestoneNumber: 8,
          milestoneLabel: 'Milestone 8 — Accomplishments & Evidence',
          emptyStateTitle: 'No accomplishments submitted',
          emptyStateDescription:
            'Submission version review, categorized photo gallery inspection, and revision workflows arrive in Milestone 8.',
          plannedColumns: ['Student', 'Task', 'Version', 'Activity Date', 'Status', 'Action'],
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
            'Generate and archive individual official RSS PDF reports linked to exact approved accomplishment submissions.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No individual RSS reports generated yet',
          emptyStateDescription:
            'Individual PDF report generation using official college templates will be implemented in Milestone 9.',
          plannedColumns: ['Student', 'Submission Version', 'Template Version', 'Generated At', 'Status'],
        },
        {
          id: 'section-rss-reports',
          label: 'Section RSS Reports',
          description:
            'Generate consolidated section RSS PDF reports tracking exact included submissions through report items.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No section RSS reports generated yet',
          emptyStateDescription:
            'Consolidated section PDF reports and academic-year archival will be implemented in Milestone 9.',
          plannedColumns: ['Section', 'Academic Year', 'Template Version', 'Generated At', 'Status'],
        },
        {
          id: 'report-templates',
          label: 'Report Templates',
          description:
            'Upload, version, and activate official college-specific Lapu-Lapu City College RSS PDF templates.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No official report templates uploaded yet',
          emptyStateDescription:
            'College-specific template upload and version preservation will be implemented in Milestone 9.',
          plannedColumns: ['Template Name', 'College', 'Version', 'Active', 'Uploaded At'],
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
            'In-system notifications for registrations, task applications, attendance verification, and accomplishment submissions.',
          milestoneNumber: 10,
          milestoneLabel: 'Milestone 10 — Dashboards & Notifications',
          emptyStateTitle: 'No notifications yet',
          emptyStateDescription:
            'Database-backed notifications will be enabled in Milestone 10.',
        },
        {
          id: 'audit-logs',
          label: 'Audit Logs',
          description:
            'Read-only, immutable audit trail of sensitive approvals, role assignments, verification decisions, and generated reports.',
          milestoneNumber: 11,
          milestoneLabel: 'Milestone 11 — Integration, Testing & Security',
          emptyStateTitle: 'No audit log entries recorded yet',
          emptyStateDescription:
            'Read-only audit records backed by the audit_logs JSONB table activate alongside authenticated workflows.',
          plannedColumns: ['Timestamp', 'Actor', 'Action', 'Subject', 'Details'],
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
            'Personal Student Service portal overview showing verified RSS hours, active tasks, and submission status.',
          milestoneNumber: 1,
          milestoneLabel: 'Milestone 1 — Project Foundation',
          emptyStateTitle: 'Personal RSS metrics connect in Milestone 10',
          emptyStateDescription:
            'Your verified service hours, applications, and upcoming task sessions will load once authentication and PostgreSQL modules are built.',
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
          emptyStateTitle: 'Student profile requires authentication (Milestone 3)',
          emptyStateDescription:
            'Your academic profile and section history will appear here once student authentication is active.',
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
            'Published RSS tasks filtered on the backend for your college, section, and student eligibility.',
          milestoneNumber: 5,
          milestoneLabel: 'Milestone 5 — RSS Task Management',
          emptyStateTitle: 'No RSS tasks available',
          emptyStateDescription:
            'Eligible tasks published by the College of Technology Coordinator will appear here in Milestone 5.',
          plannedColumns: ['Task Title', 'Category', 'Required Hours', 'Deadline', 'Slots', 'Action'],
        },
        {
          id: 'applications',
          label: 'My Applications',
          description:
            'Track your pending, approved, rejected, or withdrawn RSS task applications.',
          milestoneNumber: 6,
          milestoneLabel: 'Milestone 6 — Application Management',
          emptyStateTitle: 'No applications found',
          emptyStateDescription:
            'Your task applications and Coordinator review remarks will appear here in Milestone 6.',
          plannedColumns: ['Task', 'Applied Date', 'Status', 'Coordinator Remarks'],
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
            'Recorded attendance and verified hours per session will appear here in Milestone 7.',
          plannedColumns: ['Activity', 'Session Date', 'Recorded Hrs', 'Verified Hrs', 'Status'],
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
            'Your verified attendance hours and approved adjustments will appear here in Milestone 7.',
        },
        {
          id: 'accomplishments',
          label: 'Accomplishments',
          description:
            'Draft accomplishments, upload categorized photo evidence, view submission version history, and respond to revisions.',
          milestoneNumber: 8,
          milestoneLabel: 'Milestone 8 — Accomplishments & Evidence',
          emptyStateTitle: 'No accomplishments submitted',
          emptyStateDescription:
            'Accomplishment drafting, photo evidence uploads, and immutable version history arrive in Milestone 8.',
          plannedColumns: ['Activity', 'Version', 'Submitted At', 'Status'],
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
            'Authorized individual RSS PDF reports generated from your approved accomplishment submissions.',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No authorized reports available yet',
          emptyStateDescription:
            'Approved individual RSS PDF reports will be available for download here in Milestone 9.',
        },
        {
          id: 'notifications',
          label: 'Notifications',
          description:
            'Personal alerts for registration approval, task eligibility, application outcomes, attendance, and revisions.',
          milestoneNumber: 10,
          milestoneLabel: 'Milestone 10 — Dashboards & Notifications',
          emptyStateTitle: 'No notifications yet',
          emptyStateDescription:
            'Workflow notifications will appear here once operational modules are connected.',
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
          milestoneNumber: 1,
          milestoneLabel: 'Milestone 1 — Project Foundation',
          emptyStateTitle: 'Section summary connects in Milestone 10',
          emptyStateDescription:
            'Permitted aggregate section participation summaries will appear here without exposing private student records.',
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
            'Assigned college, program, year level, section identifier, and current academic year.',
          milestoneNumber: 4,
          milestoneLabel: 'Milestone 4 — Academic & Student Management',
          emptyStateTitle: 'No section assignment linked yet',
          emptyStateDescription:
            'Authorized section scope details will populate once authentication and academic records are active.',
        },
        {
          id: 'tasks-activities',
          label: 'Authorized Tasks',
          description:
            'Read-only view of published RSS tasks visible to your assigned section.',
          milestoneNumber: 5,
          milestoneLabel: 'Milestone 5 — RSS Task Management',
          emptyStateTitle: 'No authorized section tasks yet',
          emptyStateDescription:
            'Published tasks targeting your section or all students will appear here in Milestone 5.',
        },
        {
          id: 'section-rss-reports',
          label: 'Authorized Summaries',
          description:
            'Read-only section-level participation summaries permitted by Coordinator policies (no approval controls).',
          milestoneNumber: 9,
          milestoneLabel: 'Milestone 9 — RSS PDF Report Generation',
          emptyStateTitle: 'No authorized summary reports yet',
          emptyStateDescription:
            'Authorized section summaries will appear here in Milestone 9.',
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
          description: 'Authorized section announcements and task updates.',
          milestoneNumber: 10,
          milestoneLabel: 'Milestone 10 — Dashboards & Notifications',
          emptyStateTitle: 'No notifications yet',
          emptyStateDescription:
            'Section notifications will appear here once operational modules are connected.',
        },
      ],
    },
  ],
};
