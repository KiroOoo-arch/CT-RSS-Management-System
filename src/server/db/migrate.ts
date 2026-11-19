import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  closeDatabasePool,
  isDatabaseConfigured,
  withTransaction,
} from '../config/database.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATABASE_DIR = path.resolve(__dirname, '../../../database');

const MIGRATION_FILES = [
  '02_create_tables.sql',
  '03_constraints.sql',
  '04_indexes.sql',
  '05_seed_data.sql',
] as const;

export async function runMigrations(): Promise<{ executedFiles: string[]; tableCount: number }> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'PostgreSQL is not configured. Set SQL_HOST, SQL_PORT (optional, default 5432), SQL_DB_NAME, SQL_USER, and SQL_PASSWORD before running migrations.',
    );
  }

  const executedFiles: string[] = [];

  const tableCount = await withTransaction(async (client) => {
    for (const fileName of MIGRATION_FILES) {
      const fullPath = path.join(DATABASE_DIR, fileName);
      const sql = await fs.readFile(fullPath, 'utf8');
      await client.query(sql);
      executedFiles.push(fileName);
    }

    const res = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    return Number.parseInt(res.rows[0]?.count ?? '0', 10);
  });

  if (tableCount !== 28) {
    throw new Error(
      `Schema verification failed: expected exactly 28 tables in public schema, found ${tableCount}.`,
    );
  }

  return { executedFiles, tableCount };
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  runMigrations()
    .then(({ executedFiles, tableCount }) => {
      console.log(
        `[CT-RSS DB Migrate] Successfully executed ${executedFiles.join(', ')}. Verified ${tableCount} tables.`,
      );
      return closeDatabasePool();
    })
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('[CT-RSS DB Migrate] Migration failed:', error instanceof Error ? error.message : error);
      await closeDatabasePool().catch(() => undefined);
      process.exit(1);
    });
}
