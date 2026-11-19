# System Architecture — CT-RSS Management System

## 1. Layered Architecture

The system separates presentation, API routing, authentication/CSRF/rate-limit middleware, domain services, PostgreSQL database access, and protected file storage:

```
Browser (React 19 + TypeScript + Tailwind CSS v4)
  │
  ▼  JSON + HttpOnly Session Cookie + X-CSRF-Token (/api/v1/*)
Express Server (server.ts, port 3000)
  ├── Middleware (requestContext, rateLimit, requireAuth, requireCsrf, requireRole, requireStudentOwnership, errorHandler)
  ├── Routes (/api/v1/health, /api/v1/system/foundation, /api/v1/auth/*, /api/v1/coordinator/*, /api/v1/student/*, /api/v1/section-rep/*)
  ├── Controllers (HTTP parsing, cookie handling & response envelopes)
  ├── Services (authService, bootstrapService, rbacService, auditService, systemService)
  ├── Database Layer (src/server/config/database.ts pg Pool + 28 approved PostgreSQL tables)
  └── Protected Storage (Evidence images, report templates, generated PDFs — M08–M09)
```

## 2. Project Folder Structure

- `server.ts` — Express + Vite dev/production entry point on port `3000`, `/favicon.ico` handler, and graceful `SIGINT`/`SIGTERM` pool shutdown.
- `database/` — Authoritative 28-table PostgreSQL DDL (`01`–`05`), ERD (`06_database_erd.md`), and discrepancy report.
- `src/server/config/` — Startup env loader (`env.ts`) and object-method `pg.Pool` manager (`database.ts`).
- `src/server/db/` — CLI scripts for idempotent migrations (`migrate.ts`) and one-time Coordinator bootstrap (`bootstrapCoordinator.ts`).
- `src/server/utils/` — `bcryptjs` password hashing (`password.ts`) and HMAC-SHA256 signed session + CSRF token utilities (`session.ts`).
- `src/server/middleware/` — Request context, sliding-window rate limiter, `requireAuth`, `requireCsrf`, `requireRole`, `requireStudentOwnership`, error handling.
- `src/server/controllers/` & `src/server/services/` — Authentication, Coordinator bootstrap, registration review, role assignment, status management, and audit logging.
- `src/pages/` — `LoginPage.tsx`, `RegistrationsPage.tsx`, `FoundationOverviewPage.tsx`, `ModuleShellPage.tsx`.

## 3. PostgreSQL & Session Security Design (Exact 28-Table Constraint)

- **Strict 28-Table Schema:** No extra `sessions` or `schema_migrations` tables are added. Migrations (`02`–`05`) are written idempotently (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded constraint blocks) and verified to produce exactly 28 base tables in `public`.
- **Session Persistence & Logout Invalidation:** Active sessions issue an HMAC-SHA256 signed `HttpOnly` cookie (`ct_rss_session`) containing `{ uid, sid, iat, exp }`. The SHA-256 digest of `sid` is stored in `users.remember_token`, verified on every authenticated request via `timingSafeEqual`, and cleared (`NULL`) + memory-revoked on `POST /api/v1/auth/logout`.
- **CSRF Protection:** Authenticated state-changing requests (`POST`, `PATCH`, `PUT`, `DELETE`) verify `X-CSRF-Token` against an HMAC-SHA256 token bound to `(userId, sid)` via `timingSafeEqual`.
- **Account & Registration Gate:** Login and session checks strictly enforce `users.account_status = 'active'` and, for Students, `students.registration_status = 'approved'`.
- **Approved Roles Only:** `RSS Coordinator`, `Student`, and `Section Representative`.

## 4. UI Design System

- **Typography:** `Plus Jakarta Sans` (headings/navigation), `DM Sans` (body prose), `JetBrains Mono` (tabular numerals & identifiers).
- **Color Palette:** Lapu-Lapu City College institutional palette — Deep Navy (`#0B2340`), Primary Navy (`#12345A`), Slate Blue (`#285680`), Warm Gold (`#D6A63C`), Cool Gray Background (`#F4F6FA`), White Surface (`#FFFFFF`), Dark Slate Text (`#1E293B`), and Neutral Borders (`#E2E8F0`).
