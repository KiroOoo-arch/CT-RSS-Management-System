# CT-RSS Management System — User Manual

This manual is intended for users of the CT-RSS (Recognized Student Service) Management System portal. It covers access, authentication, dashboard use, modules, notifications, tasks, and troubleshooting.

Related documents: [Coordinator Manual](COORDINATOR_MANUAL.md) · [Student Manual](STUDENT_MANUAL.md) · [Account and Roles](ACCOUNT_AND_ROLES.md) · [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md) · [System Requirements](SYSTEM_REQUIREMENTS.md).

## Accessing the Application

1. Start the application (see [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md)).
2. Open the application URL (development default: `http://localhost:3000`).
3. The application exposes an API under `/api/v1/` and serves the React interface.

## Logging In and Logging Out

1. Open the login screen and submit email and password.
2. The server issues an HMAC-SHA256 signed HttpOnly session cookie (`ct_rss_session`) plus a CSRF token; state-changing requests must send the `X-CSRF-Token` header.
3. Login, registration, and bootstrap endpoints are rate limited (sliding window).
4. Logout clears the session server-side.

### Account Status

- Accounts may be `pending`, `active`, `suspended`, or `deactivated`.
- Student accounts remain registration-pending until an RSS Coordinator approves the registration.
- Pending, suspended, or deactivated accounts cannot access portal features.

## Dashboard

- `GET /api/v1/dashboard/summary` returns the live role dashboard summary.
- The dashboard summarizes the caller's modules (coordinator, student, section representative).

## Using Modules

### Coordinator

- Registrations review, academic years/programs/sections, student management and section assignment, task management, task sessions, applications decisions, attendance and service hours, accomplishments and evidence, report templates and generated reports, audit logs.

### Student

- Task browsing and application, applications list/detail/withdraw, attendance, service hours, accomplishments (draft/submit), own reports.

### Section Representative

- Read-only scoped overview, tasks, and reports for their section.

## Notifications

- `GET /api/v1/notifications` lists notifications.
- `PATCH /api/v1/notifications/:notificationId/read` marks one read.
- `POST /api/v1/notifications/read-all` marks all read.

## Viewing Tasks

- Coordinator: task categories, task CRUD, task status, task sessions.
- Student: task list and task detail, then apply via `POST /api/v1/student/tasks/:taskId/apply`.

## Troubleshooting Common Issues

- **Login failures:** verify credentials; rate limits may apply; account must be `active` and (for students) registration-approved.
- **Empty modules:** verify role assignment and account status.
- **Session/CSRF errors:** send the issued CSRF token on state-changing requests.

## Related Documentation

- [Coordinator Manual](COORDINATOR_MANUAL.md)
- [Student Manual](STUDENT_MANUAL.md)
- [Account and Roles](ACCOUNT_AND_ROLES.md)
- [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md)
