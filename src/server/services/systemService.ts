import { checkDatabaseHealth } from '../config/database.ts';
import { serverConfig } from '../config/env.ts';
import type { FoundationSnapshot } from '../types/api.ts';

export async function getFoundationSnapshot(): Promise<FoundationSnapshot> {
  const database = await checkDatabaseHealth();

  return {
    systemName: 'CT-RSS Management System',
    institution: 'Lapu-Lapu City College',
    initialScope: 'College of Technology',
    currentMilestone: 2,
    roles: [
      {
        name: 'RSS Coordinator',
        authoritySummary:
          'Primary operational authority for registrations, academic structure, task publication, application approvals, attendance verification, hour adjustments, accomplishment reviews, official templates, and PDF reports.',
      },
      {
        name: 'Student',
        authoritySummary:
          'Registers for approval, browses eligible RSS tasks, submits applications, tracks attendance and verified service hours, submits versioned accomplishments with categorized photo evidence, and views authorized reports.',
      },
      {
        name: 'Section Representative',
        authoritySummary:
          'Read-only section-level visibility for authorized announcements, tasks, and permitted section participation summaries without administrative or approval privileges.',
      },
    ],
    milestones: [
      {
        number: 1,
        title: 'Project Foundation',
        status: 'completed',
        summary: 'Layered architecture, LLCC design system, responsive shell, and API health foundation.',
      },
      {
        number: 2,
        title: 'PostgreSQL Database & Account Security',
        status: 'in_progress',
        summary: '28 approved tables, pg Pool, SQL migrations, real login, HttpOnly sessions, CSRF, rate limiting, and RBAC.',
      },
      {
        number: 3,
        title: 'Registration & Role Lifecycle Expansion',
        status: 'pending',
        summary: 'Extended user directory controls, Coordinator password/account recovery policies, and role audit reviews.',
      },
      {
        number: 4,
        title: 'Academic & Student Management',
        status: 'pending',
        summary: 'Colleges, programs, year levels, academic years, sections, and section history.',
      },
      {
        number: 5,
        title: 'RSS Task Management',
        status: 'pending',
        summary: 'Task categories, visibility targeting, sessions, capacity, and draft-to-publish flow.',
      },
      {
        number: 6,
        title: 'Application Management',
        status: 'pending',
        summary: 'Eligibility checks, duplicate prevention, transactional capacity locking, and reviews.',
      },
      {
        number: 7,
        title: 'Attendance & Service Hours',
        status: 'pending',
        summary: 'Session attendance, verification queue, adjustment requests, and official hour formula.',
      },
      {
        number: 8,
        title: 'Accomplishments & Evidence',
        status: 'pending',
        summary: 'Drafts, immutable submission versioning, categorized evidence gallery, and revision loop.',
      },
      {
        number: 9,
        title: 'RSS PDF Report Generation',
        status: 'pending',
        summary: 'College-specific versioned templates, individual/section reports, and report items.',
      },
      {
        number: 10,
        title: 'Dashboards & Notifications',
        status: 'pending',
        summary: 'Database-backed role dashboards and workflow-triggered in-system notifications.',
      },
      {
        number: 11,
        title: 'Integration, Testing & Security',
        status: 'pending',
        summary: 'End-to-end workflow verification, RBAC security tests, and file access validation.',
      },
      {
        number: 12,
        title: 'Deployment & Documentation',
        status: 'pending',
        summary: 'Production configuration, backup strategy, coordinator/student guides, and sign-off.',
      },
    ],
    database,
    runtime: {
      nodeVersion: process.version,
      environment: serverConfig.nodeEnv,
    },
  };
}
