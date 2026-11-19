import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { AppError } from '../middleware/errorHandler.ts';
import type { DatabaseReadiness } from '../types/api.ts';

const REQUIRED_DB_ENV_VARS = ['SQL_HOST', 'SQL_DB_NAME', 'SQL_USER', 'SQL_PASSWORD'] as const;
const ALL_DB_ENV_VARS = [
  'SQL_HOST',
  'SQL_PORT',
  'SQL_DB_NAME',
  'SQL_USER',
  'SQL_PASSWORD',
  'SQL_SSL',
] as const;
const TABLE_COUNT_TARGET = 28;

let poolInstance: Pool | null = null;
let poolSignature: string | null = null;

type SslConfig = { rejectUnauthorized: boolean } | undefined;

function resolveSslConfig(rawSsl: string | undefined, host: string): {
  ssl: SslConfig;
  sslDescription: string;
} {
  const normalized = rawSsl?.trim().toLowerCase() ?? '';

  if (normalized === 'false' || normalized === '0' || normalized === 'disable' || normalized === 'off') {
    return { ssl: undefined, sslDescription: 'disabled' };
  }

  if (normalized === 'no-verify' || normalized === 'allow-self-signed') {
    return { ssl: { rejectUnauthorized: false }, sslDescription: 'tls-no-verify' };
  }

  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'require' ||
    normalized === 'verify-full' ||
    normalized === 'verify-ca' ||
    normalized === 'prefer' ||
    normalized === 'sslmode=require' ||
    normalized === 'sslmode=verify-full'
  ) {
    return { ssl: { rejectUnauthorized: true }, sslDescription: 'tls-verified' };
  }

  // Default to verified TLS automatically when connecting to Neon or when SQL_SSL is unspecified on non-local hosts
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (host.length > 0 && !isLocalHost) {
    return { ssl: { rejectUnauthorized: true }, sslDescription: 'tls-verified (auto)' };
  }

  return { ssl: undefined, sslDescription: 'disabled (local)' };
}

function readDbEnv() {
  const host = process.env.SQL_HOST?.trim() ?? '';
  const database = process.env.SQL_DB_NAME?.trim() ?? '';
  const user = process.env.SQL_USER?.trim() ?? '';
  const password = process.env.SQL_PASSWORD ?? '';
  const portRaw = process.env.SQL_PORT?.trim() ?? '';
  const isNumericPort = /^\d+$/.test(portRaw);
  const parsedPort = portRaw && isNumericPort ? Number.parseInt(portRaw, 10) : 5432;
  const portValid =
    !portRaw || (isNumericPort && Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535);
  const port = portValid ? parsedPort : 5432;

  const { ssl, sslDescription } = resolveSslConfig(process.env.SQL_SSL, host);

  const configuredVariables: string[] = [];
  const missingVariables: string[] = [];

  for (const key of ALL_DB_ENV_VARS) {
    const val = process.env[key];
    if (val && val.trim().length > 0) {
      configuredVariables.push(key);
    }
  }

  for (const key of REQUIRED_DB_ENV_VARS) {
    const val = process.env[key];
    if (!val || val.trim().length === 0) {
      missingVariables.push(key);
    }
  }

  return {
    host,
    port,
    portValid,
    database,
    user,
    password,
    ssl,
    sslDescription,
    configuredVariables,
    missingVariables,
  };
}

function sanitizeDatabaseError(error: unknown): { code: string; message: string } {
  const errObj = error as { code?: unknown; message?: unknown } | null;
  const pgCode = typeof errObj?.code === 'string' ? errObj.code : '';
  const rawMsg = typeof errObj?.message === 'string' ? errObj.message.toLowerCase() : '';

  if (pgCode === 'ENOTFOUND' || pgCode === 'EAI_AGAIN') {
    return {
      code: 'DATABASE_HOST_UNREACHABLE',
      message: 'Unable to resolve PostgreSQL host. Verify SQL_HOST configuration.',
    };
  }
  if (pgCode === 'ECONNREFUSED') {
    return {
      code: 'DATABASE_CONNECTION_REFUSED',
      message: 'PostgreSQL connection was refused. Verify SQL_HOST and SQL_PORT.',
    };
  }
  if (pgCode === 'ETIMEDOUT' || rawMsg.includes('timeout') || rawMsg.includes('timed out')) {
    return {
      code: 'DATABASE_TIMEOUT',
      message: 'PostgreSQL connection timed out. Check network reachability and Neon endpoint status.',
    };
  }
  if (pgCode === '28P01' || pgCode === '28000') {
    return {
      code: 'DATABASE_AUTH_FAILED',
      message: 'PostgreSQL authentication failed. Verify SQL_USER and SQL_PASSWORD.',
    };
  }
  if (pgCode === '3D000') {
    return {
      code: 'DATABASE_NOT_FOUND',
      message: 'Configured PostgreSQL database does not exist. Verify SQL_DB_NAME.',
    };
  }
  if (
    pgCode.startsWith('ERR_TLS') ||
    pgCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    pgCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    rawMsg.includes('ssl') ||
    rawMsg.includes('tls') ||
    rawMsg.includes('certificate')
  ) {
    return {
      code: 'DATABASE_SSL_ERROR',
      message: 'PostgreSQL SSL/TLS handshake failed. Verify SQL_SSL configuration for Neon.',
    };
  }
  if (pgCode === '57P01' || pgCode === '57P03' || pgCode === 'ECONNRESET') {
    return {
      code: 'DATABASE_UNAVAILABLE',
      message: 'PostgreSQL server is currently unavailable or restarting.',
    };
  }

  return {
    code: 'DATABASE_UNAVAILABLE',
    message: 'Unable to connect to PostgreSQL server.',
  };
}

export function isDatabaseConfigured(): boolean {
  const env = readDbEnv();
  return env.missingVariables.length === 0 && env.portValid;
}

export function getDatabaseReadiness(): DatabaseReadiness {
  const env = readDbEnv();
  if (env.missingVariables.length > 0) {
    return {
      engine: 'PostgreSQL',
      status: 'not_configured',
      configuredVariables: env.configuredVariables,
      missingVariables: env.missingVariables,
      tableCountTarget: TABLE_COUNT_TARGET,
      actualTableCount: null,
      message: `Missing required PostgreSQL environment variable(s): ${env.missingVariables.join(', ')}.`,
    };
  }

  if (!env.portValid) {
    return {
      engine: 'PostgreSQL',
      status: 'unavailable',
      configuredVariables: env.configuredVariables,
      missingVariables: [],
      tableCountTarget: TABLE_COUNT_TARGET,
      actualTableCount: null,
      message: 'Invalid SQL_PORT configuration. Provide a port between 1 and 65535.',
    };
  }

  return {
    engine: 'PostgreSQL',
    status: 'unavailable',
    configuredVariables: env.configuredVariables,
    missingVariables: [],
    tableCountTarget: TABLE_COUNT_TARGET,
    actualTableCount: null,
    message: 'PostgreSQL configuration detected; run health check to verify live connectivity.',
  };
}

export function getPool(): Pool {
  const env = readDbEnv();
  if (env.missingVariables.length > 0) {
    throw new AppError(
      503,
      'DATABASE_NOT_CONFIGURED',
      `PostgreSQL database is not configured. Missing: ${env.missingVariables.join(', ')}.`,
    );
  }
  if (!env.portValid) {
    throw new AppError(
      500,
      'DATABASE_CONFIG_INVALID',
      'Invalid SQL_PORT configuration. Provide a valid TCP port number.',
    );
  }

  const nextSignature = `${env.host}:${env.port}:${env.database}:${env.user}:${env.sslDescription}`;
  if (poolInstance && poolSignature !== nextSignature) {
    const stalePool = poolInstance;
    poolInstance = null;
    poolSignature = null;
    void stalePool.end().catch(() => undefined);
  }

  if (!poolInstance) {
    poolInstance = new Pool({
      host: env.host,
      port: env.port,
      database: env.database,
      user: env.user,
      password: env.password,
      ssl: env.ssl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
      keepAlive: true,
    });
    poolSignature = nextSignature;

    poolInstance.on('error', (err) => {
      const sanitized = sanitizeDatabaseError(err);
      console.error(`[CT-RSS PostgreSQL Pool Error] ${sanitized.code}: ${sanitized.message}`);
    });
  }

  return poolInstance;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  const pool = getPool();
  try {
    return await pool.query<T>(text, params ? [...params] : undefined);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const code = (error as { code?: string })?.code ?? '';
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === '57P01' ||
      code === '57P03' ||
      code === '28P01' ||
      code === '28000' ||
      code === '3D000' ||
      code.startsWith('ERR_TLS')
    ) {
      const sanitized = sanitizeDatabaseError(error);
      throw new AppError(503, sanitized.code, sanitized.message);
    }
    throw error;
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    const sanitized = sanitizeDatabaseError(error);
    throw new AppError(503, sanitized.code, sanitized.message);
  }

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures after an aborted connection
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function testDatabaseConnection(): Promise<{
  connected: boolean;
  status: DatabaseReadiness['status'];
  sslMode: string;
  latencyMs: number | null;
  tableCount: number | null;
  configuredVariables: string[];
  missingVariables: string[];
  message: string;
}> {
  const env = readDbEnv();
  if (env.missingVariables.length > 0) {
    return {
      connected: false,
      status: 'not_configured',
      sslMode: env.sslDescription,
      latencyMs: null,
      tableCount: null,
      configuredVariables: env.configuredVariables,
      missingVariables: env.missingVariables,
      message: `Missing required PostgreSQL environment variable(s): ${env.missingVariables.join(', ')}.`,
    };
  }

  if (!env.portValid) {
    return {
      connected: false,
      status: 'unavailable',
      sslMode: env.sslDescription,
      latencyMs: null,
      tableCount: null,
      configuredVariables: env.configuredVariables,
      missingVariables: [],
      message: 'Invalid SQL_PORT configuration. Provide a valid port between 1 and 65535.',
    };
  }

  const startedAt = Date.now();
  try {
    await query<{ ok: number }>('SELECT 1 AS ok');
    const latencyMs = Date.now() - startedAt;

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const parsedCount = Number.parseInt(countRes.rows[0]?.count ?? '0', 10);
    const tableCount = Number.isFinite(parsedCount) ? parsedCount : 0;

    return {
      connected: true,
      status: 'connected',
      sslMode: env.sslDescription,
      latencyMs,
      tableCount,
      configuredVariables: env.configuredVariables,
      missingVariables: [],
      message:
        tableCount === TABLE_COUNT_TARGET
          ? 'PostgreSQL connected and all 28 approved tables are present.'
          : `PostgreSQL connected (${tableCount} of ${TABLE_COUNT_TARGET} tables found; migrations not yet executed).`,
    };
  } catch (error) {
    const sanitized =
      error instanceof AppError
        ? { code: error.code, message: error.message }
        : sanitizeDatabaseError(error);
    return {
      connected: false,
      status: 'unavailable',
      sslMode: env.sslDescription,
      latencyMs: null,
      tableCount: null,
      configuredVariables: env.configuredVariables,
      missingVariables: [],
      message: sanitized.message,
    };
  }
}

export async function checkDatabaseHealth(): Promise<DatabaseReadiness> {
  const result = await testDatabaseConnection();
  return {
    engine: 'PostgreSQL',
    status: result.status,
    configuredVariables: result.configuredVariables,
    missingVariables: result.missingVariables,
    tableCountTarget: TABLE_COUNT_TARGET,
    actualTableCount: result.tableCount,
    message: result.message,
  };
}

export async function closeDatabasePool(): Promise<void> {
  if (poolInstance) {
    const pool = poolInstance;
    poolInstance = null;
    poolSignature = null;
    await pool.end();
  }
}
