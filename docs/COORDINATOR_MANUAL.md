# CT-RSS Management System — Coordinator Manual

This manual documents the actual RSS Coordinator workflow. It is intended for the person who operates the coordinator console.

Related documents: [User Manual](USER_MANUAL.md) · [Student Manual](STUDENT_MANUAL.md) · [Account and Roles](ACCOUNT_AND_ROLES.md) · [Admin Guide](ADMIN_GUIDE.md) · [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md).

## Coordinator Dashboard

- `GET /api/v1/dashboard/summary` — live coordinator dashboard summary.
- `GET /api/v1/notifications` and notification read endpoints — operational notifications.

## Student Registration Review

1. `GET /api/v1/coordinator/registrations` — list student registrations.
2. `POST /api/v1/coordinator/registrations/:studentId/decision` — approve or reject a pending registration.
3. On approval, the student account is set `active` and the registration `approved`.

## Student Management and Section Assignment

- `GET /api/v1/coordinator/students` — list students.
- `POST /api/v1/coordinator/students` / `PATCH /api/v1/coordinator/students/:studentId` — create/update.
- `POST /api/v1/coordinator/students/:studentId/section-assignment` — assign a section.
- `GET /api/v1/coordinator/sections/:sectionId/students` — section student roster.
- `GET /api/v1/coordinator/academic-metadata`, academic years, programs, sections endpoints for context.

## Task / Activity Creation and Publishing

- Task categories: `POST /api/v1/coordinator/task-categories`, `PATCH /api/v1/coordinator/task-categories/:categoryId`.
- Tasks: `POST /api/v1/coordinator/tasks`, `GET /api/v1/coordinator/tasks`, `GET /api/v1/coordinator/tasks/:taskId`, `PATCH /api/v1/coordinator/tasks/:taskId`, `PATCH /api/v1/coordinator/tasks/:taskId/status`.
- Task sessions: `GET /api/v1/coordinator/tasks/:taskId/sessions`, `POST .../sessions`, `PATCH .../sessions/:sessionId`, `DELETE .../sessions/:sessionId`.

## Application Review

- `GET /api/v1/coordinator/applications` and detail.
- `POST /api/v1/coordinator/applications/:applicationId/decision` — approve or reject an application.

## Attendance and Service Hours

- Sessions and roster: `GET /api/v1/coordinator/tasks/:taskId/sessions`, `GET /api/v1/coordinator/attendance/sessions/:sessionId/roster`.
- Record attendance: `POST /api/v1/coordinator/attendance`.
- Correct attendance: `PATCH /api/v1/coordinator/attendance/:attendanceId`.
- Service hours: `GET /api/v1/coordinator/service-hours`.
- Adjustments: `POST /api/v1/coordinator/service-hours/adjustments`, decision `POST /api/v1/coordinator/service-hours/adjustments/:adjustmentId/decision`.

## Accomplishments and Evidence Review

- Accomplishments: `GET /api/v1/coordinator/accomplishments`, detail, and submission review `POST /api/v1/coordinator/accomplishments/submissions/:submissionId/review`.

## Reports

- Templates: `GET|POST /api/v1/coordinator/report-templates`, `PATCH /api/v1/coordinator/report-templates/:templateId`.
- Reports: `GET /api/v1/coordinator/reports`, individual preview/generate, section preview/generate, status `PATCH /api/v1/coordinator/reports/:reportId/status`.
- Downloads: `GET /api/v1/reports/:reportId/download`.

## Audit Trails

- `GET /api/v1/coordinator/audit-logs`.

## Coordinator vs. Section Representative Capabilities

- Section Representatives have read-only scoped endpoints (`/api/v1/section-rep/overview`, `/api/v1/section-rep/tasks`, `/api/v1/section-rep/reports`) and report/evidence download access.

## Common Errors

- **Registration decisions:** only pending registrations may be decided; re-decisions are rejected.
- **Access:** coordinator-only endpoints require the `RSS Coordinator` role; student self-service endpoints require the `Student` role; ownership checks apply.

## Related Documentation

- [User Manual](USER_MANUAL.md) · [Student Manual](STUDENT_MANUAL.md) · [Account and Roles](ACCOUNT_AND_ROLES.md) · [Admin Guide](ADMIN_GUIDE.md) · [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md)
