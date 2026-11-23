// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt, { truncates } from 'bcryptjs';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../src/server/utils/password.ts';

const BCRYPT_MAX_BYTES = 72;

test('password-hardening: normal hash and verify round-trips', async () => {
  const hash = await hashPassword('StudentPass#2026!');
  assert.ok(hash.startsWith('$2'));
  assert.equal(await verifyPassword('StudentPass#2026!', hash), true);
  assert.equal(await verifyPassword('WrongPassword#999', hash), false);
});

test('password-hardening: password at the 72-byte boundary is accepted without truncation', async () => {
  const boundary = 'Aa1!'.repeat(18); // 72 ASCII characters / 72 UTF-8 bytes
  assert.equal(Buffer.byteLength(boundary, 'utf8'), 72);
  assert.equal(truncates(boundary), false);
  assert.equal(validatePasswordStrength(boundary), null);
  const hash = await hashPassword(boundary);
  assert.equal(await verifyPassword(boundary, hash), true);
});

test('password-hardening: password exceeding 72 UTF-8 bytes is rejected', async () => {
  const over = 'Aa1!'.repeat(18) + 'X'; // 73 ASCII characters / 73 UTF-8 bytes
  assert.equal(truncates(over), true);
  const err = validatePasswordStrength(over);
  assert.ok(err !== null, 'password over 72 bytes must fail validation');
  await assert.rejects(() => hashPassword(over));
});

test('password-hardening: multibyte password within 72 characters but over 72 bytes is rejected', async () => {
  const multibyte = 'Ä'.repeat(40) + 'z9Xq8W7eR6tY5uI4oP3aS2dF1gH0jK';
  assert.ok(multibyte.length <= 72);
  assert.ok(Buffer.byteLength(multibyte, 'utf8') > 72);
  const err = validatePasswordStrength(multibyte);
  assert.ok(err !== null, 'multibyte password over 72 bytes must fail validation');
  await assert.rejects(() => hashPassword(multibyte));
});

test('password-hardening: legacy bcrypt hash remains verifiable and invalid passwords fail', async () => {
  const legacyHash = await bcrypt.hash('LegacyPass#2026!', 10);
  assert.ok(legacyHash.startsWith('$2b$'));
  assert.equal(await verifyPassword('LegacyPass#2026!', legacyHash), true);
  assert.equal(await verifyPassword('WrongPassword#999', legacyHash), false);
});

test('password-hardening: bcrypt silently truncates above 72 bytes, so long passwords must be rejected', async () => {
  const pwA = 'Aa1!'.repeat(18) + 'A'; // 73 bytes
  const pwB = 'Aa1!'.repeat(18) + 'B'; // 73 bytes, differs from pwA only after byte 72
  const hash = await bcrypt.hash(pwA, 12);
  assert.equal(
    await verifyPassword(pwB, hash),
    true,
    'bcrypt truncates at 72 bytes, so pwB must match pwA when only the tail differs',
  );
});

test('password-hardening: registration validation boundaries', () => {
  assert.ok(validatePasswordStrength('Ab1!efghi') !== null, 'password under 10 chars must be rejected');
  assert.equal(validatePasswordStrength('Str0ngPass!abc'), null, 'valid password must pass');
  assert.ok(
    validatePasswordStrength('Aa1!'.repeat(18) + 'X') !== null,
    'password over 72 bytes must be rejected',
  );
  assert.ok(
    validatePasswordStrength('str0ngpass!abc') !== null,
    'password missing uppercase must be rejected',
  );
});
