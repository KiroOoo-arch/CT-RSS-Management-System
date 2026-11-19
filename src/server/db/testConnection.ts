import dotenv from 'dotenv';
import { closeDatabasePool, testDatabaseConnection } from '../config/database.ts';
import { getSessionSecurityStatus } from '../utils/session.ts';

dotenv.config();

async function run(): Promise<void> {
  const result = await testDatabaseConnection();
  const session = getSessionSecurityStatus();

  console.log(
    JSON.stringify(
      {
        engine: 'PostgreSQL',
        connected: result.connected,
        status: result.status,
        sslMode: result.sslMode,
        latencyMs: result.latencyMs,
        tableCount: result.tableCount,
        configuredVariables: result.configuredVariables,
        missingVariables: result.missingVariables,
        sessionSecretConfigured: session.configured,
        sessionMeetsMinimumLength: session.meetsMinimumLength,
        usingEphemeralSessionFallback: session.usingEphemeralFallback,
        message: result.message,
      },
      null,
      2,
    ),
  );

  if (!result.connected) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error(
      '[CT-RSS DB Test] Connection test failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool().catch(() => undefined);
  });
