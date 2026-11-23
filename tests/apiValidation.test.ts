// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/server/middleware/errorHandler.ts';
import { parseOptionalIntParam, parseStrictIntParam } from '../src/server/utils/apiValidation.ts';
import { listAccomplishments } from '../src/server/services/accomplishmentService.ts';
import { listCoordinatorAttendance } from '../src/server/services/attendanceService.ts';
import { listCoordinatorApplications } from '../src/server/services/applicationService.ts';
import { listStudentRegistrations } from '../src/server/services/rbacService.ts';

function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  return promise.then(
    () => assert.fail('expected AppError to be thrown'),
    (err: unknown) => {
      assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
      assert.equal((err as AppError).statusCode, 400);
      assert.equal((err as AppError).code, code);
    },
  );
}

test('api-validation: parseStrictIntParam accepts valid positive integer IDs', () => {
  assert.equal(parseStrictIntParam('42', 'INVALID_STUDENT_ID', 'student identifier'), 42);
  assert.equal(parseStrictIntParam('007', 'INVALID_STUDENT_ID', 'student identifier'), 7);
  assert.equal(parseStrictIntParam('1', 'INVALID_STUDENT_ID', 'student identifier'), 1);
});

test('api-validation: parseStrictIntParam rejects malformed values', async () => {
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam('12abc', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam('12.5', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam('0', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam('-5', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam('99999999999999999999', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam('', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseStrictIntParam(42 as unknown as string, 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
});

test('api-validation: parseOptionalIntParam optional behavior', () => {
  assert.equal(parseOptionalIntParam(undefined, 'INVALID_STUDENT_ID', 'student identifier'), undefined);
  assert.equal(parseOptionalIntParam(null, 'INVALID_STUDENT_ID', 'student identifier'), undefined);
  assert.equal(parseOptionalIntParam('', 'INVALID_STUDENT_ID', 'student identifier'), undefined);
  assert.equal(parseOptionalIntParam('12', 'INVALID_STUDENT_ID', 'student identifier'), 12);
});

test('api-validation: parseOptionalIntParam rejects malformed optional values', async () => {
  await expectAppError(
    Promise.resolve().then(() => parseOptionalIntParam('12abc', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseOptionalIntParam('12.5', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseOptionalIntParam('0', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseOptionalIntParam('-1', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
  await expectAppError(
    Promise.resolve().then(() => parseOptionalIntParam('99999999999999999999', 'INVALID_STUDENT_ID', 'student identifier')),
    'INVALID_STUDENT_ID',
  );
});

test('api-validation: invalid registration status filters are rejected', async () => {
  await expectAppError(listStudentRegistrations('bogus'), 'INVALID_REGISTRATION_STATUS');
  await expectAppError(listStudentRegistrations('pending; DROP TABLE students'), 'INVALID_REGISTRATION_STATUS');
});

test('api-validation: valid registration status filters still return results', async () => {
  const res = await listStudentRegistrations('pending');
  assert.ok(Array.isArray(res));
});

test('api-validation: invalid application status filters are rejected', async () => {
  await expectAppError(listCoordinatorApplications({ status: 'bogus' }), 'INVALID_APPLICATION_STATUS');
  await expectAppError(listCoordinatorApplications({ status: 'not_a_status' }), 'INVALID_APPLICATION_STATUS');
});

test('api-validation: valid application status filters still return results', async () => {
  const res = await listCoordinatorApplications({ status: 'all' });
  assert.ok(Array.isArray(res.applications));
  const approved = await listCoordinatorApplications({ status: 'approved' });
  assert.ok(Array.isArray(approved.applications));
});

test('api-validation: invalid accomplishment status filters are rejected', async () => {
  await expectAppError(listAccomplishments({ status: 'bogus' }), 'INVALID_ACCOMPLISHMENT_STATUS');
  await expectAppError(listAccomplishments({ status: 'not_a_status' }), 'INVALID_ACCOMPLISHMENT_STATUS');
});

test('api-validation: valid accomplishment status filters still return results', async () => {
  const res = await listAccomplishments({ status: 'draft' });
  assert.ok(Array.isArray(res));
  const approved = await listAccomplishments({ status: 'approved' });
  assert.ok(Array.isArray(approved));
});

test('api-validation: invalid attendance verification status filters are rejected', async () => {
  await expectAppError(listCoordinatorAttendance({ verificationStatus: 'bogus' }), 'INVALID_VERIFICATION_STATUS');
  await expectAppError(listCoordinatorAttendance({ verificationStatus: 'not_a_status' }), 'INVALID_VERIFICATION_STATUS');
});

test('api-validation: valid attendance verification status filters still return results', async () => {
  const res = await listCoordinatorAttendance({ verificationStatus: 'pending' });
  assert.ok(Array.isArray(res));
  const verified = await listCoordinatorAttendance({ verificationStatus: 'verified' });
  assert.ok(Array.isArray(verified));
});
