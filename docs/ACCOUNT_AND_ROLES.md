# CT-RSS Management System — Account and Roles

## Verified Roles

The system implements three application roles:

| Role | Code | Scope |
| --- | --- | --- |
| RSS Coordinator | `RSS Coordinator` | Full operational authority across students, tasks, applications, attendance, accomplishments, reports, audit logs. |
| Student | `Student` | Own data only: tasks, applications, attendance, service hours, accomplishments, own reports. |
| Section Representative | `Section Representative` | Read-only scoped access: section overview, tasks, reports, evidence/report downloads. |

## Account Statuses

- `pending`
- `active`
- `suspended`
- `deactivated`

Student registration statuses: `pending` / `approved` (with coordinator decisions recorded).

## Responsibilities and Access Restrictions

- **RSS Coordinator:** manages registrations, students, sections, tasks, applications, attendance, service hours, accomplishments, reports, audit logs; issues role assignments and account status changes.
- **Student:** self-service access to own tasks/applications/attendance/service hours/accomplishments/reports.
- **Section Representative:** read-only, scoped views.

Cross-role restrictions: students and section representatives cannot access another student's record; coordinator-only endpoints require the `RSS Coordinator` role; ownership checks apply for student-scoped endpoints.

## Account Creation and Approval Process

1. Initial coordinator bootstrap via `POST /api/v1/auth/bootstrap-coordinator` (one-time; `BOOTSTRAP_NAME`, `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`; refuses weak passwords; disables once a Coordinator exists).
2. Student registration via `POST /api/v1/auth/register` → pending.
3. Coordinator approval via `POST /api/v1/coordinator/registrations/:studentId/decision`.
4. Coordinator role assignment via `POST /api/v1/coordinator/users/:userId/roles`.
5. Coordinator account status changes via `PATCH /api/v1/coordinator/users/:userId/status`.

## Password and Session Security

- bcryptjs hashing (cost 12).
- HMAC-SHA256 signed HttpOnly session cookie (`ct_rss_session`) with PostgreSQL `users.remember_token` session revocation.
- `X-CSRF-Token` validation on state-changing requests.
- Sliding-window rate limiting on login/register/bootstrap.

## Password Reset

No public password-reset endpoint is implemented in the current release; password recovery is handled through the deployment's administrative procedures.

## Initial Administrator Setup

- Bootstrap the initial RSS Coordinator account once via environment-driven bootstrap endpoint.

## Related Documentation

- [User Manual](USER_MANUAL.md) · [Coordinator Manual](COORDINATOR_MANUAL.md) · [Student Manual](STUDENT_MANUAL.md) · [Admin Guide](ADMIN_GUIDE.md) · [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md)
