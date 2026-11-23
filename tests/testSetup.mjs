import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

const REQUIRED_TEST_DB = 'ct_rss_test';
const REQUIRED_DB_KEYS = [
  'SQL_HOST',
  'SQL_PORT',
  'SQL_DB_NAME',
  'SQL_USER',
  'SQL_PASSWORD',
  'SQL_SSL',
];
const NON_EMPTY_DB_KEYS = ['SQL_HOST', 'SQL_DB_NAME', 'SQL_USER', 'SQL_PASSWORD'];

function fail(reason) {
  console.error(`[TEST-SETUP] Refusing to run automated tests: ${reason}`);
  process.exit(1);
}

const testEnvPath = path.resolve(process.cwd(), '.env.test');

if (!fs.existsSync(testEnvPath)) {
  fail('.env.test was not found at the project root.');
}

// Preload-safe: any later `import 'dotenv/config'` resolves to .env.test, not .env.
process.env.DOTENV_CONFIG_PATH = testEnvPath;

// Explicitly parse ONLY .env.test. No other environment file is read here.
const envConfig = dotenv.parse(fs.readFileSync(testEnvPath));

// Every database setting must come from .env.test itself (never the shell or .env).
const missingKeys = REQUIRED_DB_KEYS.filter(
  (key) => !Object.prototype.hasOwnProperty.call(envConfig, key),
);
if (missingKeys.length > 0) {
  fail(`.env.test must define every database setting. Missing: ${missingKeys.join(', ')}.`);
}

const emptyKeys = NON_EMPTY_DB_KEYS.filter(
  (key) => String(envConfig[key] ?? '').trim().length === 0,
);
if (emptyKeys.length > 0) {
  fail(`.env.test contains empty database settings. Empty: ${emptyKeys.join(', ')}.`);
}

if (String(envConfig.SQL_DB_NAME).trim() !== REQUIRED_TEST_DB) {
  fail(`SQL_DB_NAME in .env.test must equal "${REQUIRED_TEST_DB}".`);
}

// Applying .env.test values makes them own properties, so later dotenv.config()
// calls (default override:false) cannot supply or replace any SQL_* setting from .env.
for (const key of Object.keys(envConfig)) {
  process.env[key] = envConfig[key];
}

// Test-only application settings: production NODE_ENV/SESSION_SECRET cannot leak in.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

console.log('[TEST-SETUP] Guard active; target database: ct_rss_test; credentials redacted');
