# CT-RSS Management System — Admin Guide

This guide documents system administration for the CT-RSS Management System.

## Initial Setup

1. Provision PostgreSQL and apply the authoritative schema (`database/01`–`05`, ERD in `06_database_erd.md`).
2. Configure runtime environment variables (`SQL_*`, `SESSION_SECRET`, `BOOTSTRAP_*`).
3. Bootstrap the initial RSS Coordinator account once.
4. Verify health via `GET /api/v1/health` and foundation metadata via `GET /api/v1/system/foundation`.

## Database Setup

- Migrations: `npm run db:migrate` (idempotent, transactionally applied, verifies all 28 tables).

## Account Administration

- Bootstrap coordinator: `POST /api/v1/auth/bootstrap-coordinator`.
- Registration review and approval: coordinator endpoints.
- Role assignment and status changes: coordinator endpoints.

## Backups, Recovery, Updates

- Backups: use standard PostgreSQL backup procedures for the database and evidence storage (`storage/`).
- Recovery: restore database and evidence storage.
- Updates: pull changes, reinstall dependencies, rebuild frontend, restart services; re-run migrations only if required.

## Logs and Security Practices

- Audit logs: `GET /api/v1/coordinator/audit-logs`.
- Security practices: bcrypt cost 12, HMAC session cookies, CSRF validation, rate limits, deny-by-default authorization.

## Troubleshooting

- Health/foundation failures, migration failures, bootstrap refusal (weak password / already bootstrapped).

## Related Documentation

- [Installation and Deployment](INSTALLATION_AND_DEPLOYMENT.md) · [Account and Roles](ACCOUNT_AND_ROLES.md) · [Coordinator Manual](COORDINATOR_MANUAL.md) · [User Manual](USER_MANUAL.md)
