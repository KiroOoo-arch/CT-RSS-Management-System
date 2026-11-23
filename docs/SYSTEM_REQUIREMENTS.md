# CT-RSS Management System — System Requirements

This document lists the requirements for running the CT-RSS (Recognized Student Service) Management System. Minimum and recommended requirements are listed separately and are grounded in the actual project configuration.

## Minimum Requirements

### Hardware

- **CPU:** 1 modern dual-core processor (2 vCPU).
- **RAM:** 2 GB minimum.
- **Storage:** 1 GB free disk space (application, logs, protected evidence files).
- **Network:** Local network / loopback for local development; outbound HTTPS for font/CDN-free local asset serving.

### Software

- **Supported OS:** Linux, macOS, or Windows (x64) with a Node.js runtime.
- **Node.js:** version 22 (project dependency/runtime expectation; development environment currently runs Node 24).
- **npm:** version bundled with Node.js (11.x in the current environment).
- **Database:** PostgreSQL 14 or newer (project targets PostgreSQL; migrations written for PostgreSQL).
- **Required Node modules:** express, pg, bcryptjs, pdfkit, @google/genai, dotenv, react, react-dom, vite, tailwindcss, typescript, tsx, etc. (see `package.json`).

### Browser

- Current versions of Chrome, Firefox, Edge, or Safari (React 19 + modern CSS/JS requirements).

## Recommended Requirements

- **CPU:** 2 vCPU.
- **RAM:** 4 GB recommended for development with Vite dev server and concurrent tooling.
- **Storage:** SSD with headroom for evidence files and generated PDFs.

## Database Requirements

- PostgreSQL server with the authoritative schema delivered in `database/`:
  - `01_create_database.sql`
  - `02_create_tables.sql`
  - `03_constraints.sql`
  - `04_indexes.sql`
  - `05_seed_data.sql`
  - `06_database_erd.md` (ERD)
  - `DISCREPANCY_REPORT.md`
- Exactly 28 approved tables in the public schema.

## Runtime Requirements

- `SESSION_SECRET` (recommended 32+ character random string in production).
- `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, optional `SQL_SSL`.

## Notes

- Values labeled "minimum" are the smallest configuration in which the shipped feature set is expected to run; values labeled "recommended" reflect a production-oriented setup.
- Exact mandatory hosting requirements may vary by deployment platform; the figures above are grounded in the application's own configuration and are intended as guidance rather than legal deployment specifications.
