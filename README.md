# CT-RSS Management System

**Institution:** Lapu-Lapu City College
**Initial Scope:** College of Technology (multi-college ready)
**Portal:** Student Service Management Portal
**Purpose:** Centralized web-based platform for managing Recognized Student Service (RSS) tasks, student participation, applications, attendance verification, credited service-hour calculations, versioned accomplishment submissions, categorized photo evidence, and official template-based PDF reports.

## Technology Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons.
- **Backend:** Node.js (v22), Express 4, TypeScript (layered routes, controllers, services, middleware).
- **Database:** PostgreSQL (`pg` Pool, 28 approved tables in `database/`).
- **Security:** `bcryptjs` (cost 12), HMAC-SHA256 `HttpOnly` session cookies (`ct_rss_session`), PostgreSQL `users.remember_token` session revocation, `X-CSRF-Token` validation, sliding-window login/register/bootstrap rate limiting, and `audit_logs`.

## Available Scripts

- `npm run dev` — Starts the Express server (`server.ts`) on port `3000` with Vite middleware in development mode.
- `npm run build` — Builds the React frontend bundle into `dist/`.
- `npm run start` — Starts the Express server in production mode (`node server.ts`).
- `npm run preview` — Vite preview.
- `npm run clean` — Removes build output.
- `npm run lint` — Runs TypeScript type-checking (`tsc --noEmit`).
- `npm test` — Runs the end-to-end functional regression suite (`tests/functionalRegression.test.ts`).
- `npm run test:safe` — Runs the attendance suite with the guarded test setup.
- `npm run db:test` — Runs the DB connection check.
- `npm run db:migrate` — Executes `database/02_create_tables.sql` through `05_seed_data.sql` transactionally and verifies all 28 tables exist.
- `npm run db:migrate:test` — Runs migrations through the guarded test setup.
- `npm run db:bootstrap-coordinator` — Provisions the initial `RSS Coordinator` account from `BOOTSTRAP_NAME`, `BOOTSTRAP_EMAIL`, and `BOOTSTRAP_PASSWORD` (refuses default/weak passwords and disables once a Coordinator exists).

## PostgreSQL Setup & Bootstrap

1. Provision a PostgreSQL 14+ database (e.g., running `database/01_create_database.sql` on your PostgreSQL host).
2. Configure runtime environment variables (never commit real credentials):
   - `SQL_HOST`
   - `SQL_PORT` (defaults to `5432`)
   - `SQL_DB_NAME`
   - `SQL_USER`
   - `SQL_PASSWORD`
   - Optional: `SQL_SSL=true`, `SESSION_SECRET` (recommended 32+ character random string in production)
3. Apply schema, constraints, indexes, and verified seed data:
   ```bash
   npm run db:migrate
   ```
4. Create the initial `RSS Coordinator` account once:
   ```bash
   BOOTSTRAP_NAME="CT RSS Coordinator" \
   BOOTSTRAP_EMAIL="coordinator@llcc.edu.ph" \
   BOOTSTRAP_PASSWORD="YourStrongPassword123" \
   npm run db:bootstrap-coordinator
   ```

## Milestone Status

1. **Milestone 1 — Project Foundation:** Completed & verified.
2. **Milestone 2 — PostgreSQL Database, Authentication & RBAC:** Implemented (awaiting review; live DB execution requires PostgreSQL runtime environment variables).
3. **Milestones 3–11:** Recovered and completed (per repository history: `feat: recover and complete CT-RSS milestones 3-11`).

## Environment Variables

See `.env.example` for documented environment keys. Never commit real credentials or secrets.

## Documentation

- [User Manual](docs/USER_MANUAL.md)
- [Student Manual](docs/STUDENT_MANUAL.md)
- [Coordinator Manual](docs/COORDINATOR_MANUAL.md)
- [Account and Roles](docs/ACCOUNT_AND_ROLES.md)
- [Admin Guide](docs/ADMIN_GUIDE.md)
- [Installation and Deployment](docs/INSTALLATION_AND_DEPLOYMENT.md)
- [System Requirements](docs/SYSTEM_REQUIREMENTS.md)

## Troubleshooting

- See the individual manuals for module-specific troubleshooting.
- Health/foundation endpoints: `GET /api/v1/health`, `GET /api/v1/system/foundation`.

## Security Notes

- Deny-by-default authorization with role middleware and ownership checks.
- bcryptjs password hashing, HMAC session cookies, CSRF validation, rate limits, audit logs.
