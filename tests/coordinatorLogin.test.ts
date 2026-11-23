// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { loginAs } from './testUtils.ts';

// E2E instance runs on port 3001
const BASE_URL = 'http://localhost:3001';

test('coordinator-login: bootstrap coordinator can authenticate with valid credentials', async () => {
  const { session, json } = await loginAs(BASE_URL, 'demo.coordinator@llcc.edu.ph', 'CTRSS2024Coordinator!');
  assert.ok(session.cookieHeader != null, 'session should have a cookieHeader');
  assert.ok(session.csrfToken != null, 'session should have a csrfToken');
  assert.ok(json?.success === true);
  assert.ok(json?.data?.user?.roles?.includes('RSS Coordinator'));
  assert.equal(json.data.user.accountStatus, 'active');
});

test('coordinator-login: invalid password fails authentication', async () => {
  const { status, json } = await loginAs(BASE_URL, 'demo.coordinator@llcc.edu.ph', 'wrongpassword');
  assert.equal(status, 401);
  assert.ok(json?.success === false);
  assert.ok(json?.error?.code === 'INVALID_CREDENTIALS');
});

test('coordinator-login: non-existent user fails authentication', async () => {
  const { status, json } = await loginAs(BASE_URL, 'nonexistent@llcc.edu.ph', 'anypassword');
  assert.equal(status, 401);
  assert.ok(json?.success === false);
});