import dotenv from 'dotenv';
import { closeDatabasePool, isDatabaseConfigured } from '../config/database.ts';
import { bootstrapInitialCoordinator } from '../services/bootstrapService.ts';

dotenv.config();

async function run(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'PostgreSQL is not configured. Provide SQL_HOST, SQL_DB_NAME, SQL_USER, and SQL_PASSWORD first.',
    );
  }

  const name = process.env.BOOTSTRAP_NAME?.trim() ?? '';
  const email = process.env.BOOTSTRAP_EMAIL?.trim() ?? '';
  const password = process.env.BOOTSTRAP_PASSWORD ?? '';

  if (!name || !email || !password) {
    throw new Error(
      'Missing required environment variables: BOOTSTRAP_NAME, BOOTSTRAP_EMAIL, and BOOTSTRAP_PASSWORD must be provided explicitly.',
    );
  }

  const result = await bootstrapInitialCoordinator({
    name,
    email,
    password,
  });

  console.log(
    `[CT-RSS Bootstrap] Created initial RSS Coordinator account: ${result.email} (user ID ${result.userId}).`,
  );
}

run()
  .then(() => closeDatabasePool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(
      '[CT-RSS Bootstrap] Error:',
      error instanceof Error ? error.message : error,
    );
    await closeDatabasePool().catch(() => undefined);
    process.exit(1);
  });
