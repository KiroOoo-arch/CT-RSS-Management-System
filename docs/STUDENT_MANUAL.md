# CT-RSS Management System — Student Manual

This manual documents the actual student workflow of the CT-RSS Management System. Only implemented functionality is described; unavailable functionality is marked.

## Overview

Students participate in Recognized Student Service (RSS) tasks, apply through task applications, attend sessions, earn credited service hours, submit accomplishment records with evidence, and receive official reports.

## Registration

1. Register via `POST /api/v1/auth/register`.
2. The account and student registration start in `pending` status.
3. The RSS Coordinator reviews and approves via `POST /api/v1/coordinator/registrations/:studentId/decision`.
4. On approval, the student account becomes `active` and the registration becomes `approved`.

## Login

1. Log in via `POST /api/v1/auth/login` with email and password.
2. Access portal features only when the account is `active` and the student registration is `approved`.

## Student Dashboard and Profile

- Live dashboard summary: `GET /api/v1/dashboard/summary`.
- Own profile: `GET /api/v1/student/profile` (coordinator access to a scoped student record: `GET /api/v1/students/:studentId/profile`).

## Available Tasks

- List: `GET /api/v1/student/tasks`.
- Detail: `GET /api/v1/student/tasks/:taskId`.
- Apply: `POST /api/v1/student/tasks/:taskId/apply`.
- Withdraw application: `POST /api/v1/student/applications/:applicationId/withdraw`.

## Applications and Status

- Applications list: `GET /api/v1/student/applications`.
- Application detail: `GET /api/v1/student/applications/:applicationId`.
- Approved applications: those approved by the coordinator through the decision workflow.

## Attendance and Credited Hours

- Attendance list: `GET /api/v1/student/attendance`.
- Service hours: `GET /api/v1/student/service-hours`.
- Service-hour adjustment request: `POST /api/v1/student/service-hours/adjustments`.

## Accomplishments and Evidence

- Accomplishments list: `GET /api/v1/student/accomplishments`.
- Accomplishment detail: `GET /api/v1/student/accomplishments/:accomplishmentId`.
- Draft: `POST /api/v1/student/accomplishments/draft`.
- Submit: `POST /api/v1/student/accomplishments/submit`.

## Reports and Records Available to Students

- Own reports: `GET /api/v1/student/reports`.
- Report download: `GET /api/v1/reports/:reportId/download` (ownership/authorization verified).
- Evidence file: `GET /api/v1/evidence/:imageId/file` (authorization verified).

## Notifications

- `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:notificationId/read`, `POST /api/v1/notifications/read-all`.

## Common Problems

- **Cannot log in / cannot access features:** account must be `active` and registration `approved`.
- **Task not appearing:** tasks are assigned through coordinator task publication and eligibility rules.
- **Evidence or report access denied:** authorization is deny-by-default and ownership-verified.

## Related Documentation

- [User Manual](USER_MANUAL.md) · [Coordinator Manual](COORDINATOR_MANUAL.md) · [Account and Roles](ACCOUNT_AND_ROLES.md) · [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md)
