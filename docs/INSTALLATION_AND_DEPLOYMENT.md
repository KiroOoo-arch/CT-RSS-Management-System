# CT-RSS Management System — Installation and Deployment

## Prerequisites

- Node.js 22+ and npm.
- PostgreSQL 14+.
- Git.

## Clone

```bash
git clone https://github.com/KiroOoo-arch/CT-RSS-Management-System.git
cd CT-RSS-Management-System
```

## Dependencies

```bash
npm install
```

## Database Creation

1. Provision a PostgreSQL database.
2. Apply schema: `npm run db:migrate`.

## Environment Setup

1. Copy `.env.example` to `.env`.
2. Configure `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_SSL`, `SESSION_SECRET`, `BOOTSTRAP_NAME`, `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`.
3. Never commit real credentials.

## Migrations

```bash
npm run db:migrate
```

## Bootstrap Initial Account

```bash
BOOTSTRAP_NAME="CT RSS Coordinator" \
BOOTSTRAP_EMAIL="coordinator@llcc.edu.ph" \
BOOTSTRAP_PASSWORD="YourStrongPassword123" \
npm run db:bootstrap-coordinator
```

## Starting Services

```bash
npm run dev    # development (Express + Vite middleware, port 3000)
npm run build  # production frontend build into dist/
npm run start  # production server
```

## Production Deployment Overview

- Build frontend, start Express server, put reverse proxy in front with TLS.

## Build and Verification

```bash
npm run lint
npm run build
npm test
```

## Related Documentation

- [System Requirements](SYSTEM_REQUIREMENTS.md) · [User Manual](USER_MANUAL.md) · [Coordinator Manual](COORDINATOR_MANUAL.md) · [Student Manual](STUDENT_MANUAL.md) · [Account and Roles](ACCOUNT_AND_ROLES.md) · [Admin Guide](ADMIN_GUIDE.md)
