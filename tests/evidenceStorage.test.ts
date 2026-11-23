// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  deleteEvidenceFile,
  removeEvidenceDirectoryIfEmpty,
  resolveSafeStoragePath,
  saveEvidenceImageBase64,
} from '../src/server/utils/fileStorage.ts';
import { cleanupWrittenEvidence } from '../src/server/services/accomplishmentService.ts';

const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFf4NwAAAAASUVORK5CYII=';

function storageDirExists(relDir: string): Promise<boolean> {
  return fs
    .access(resolveSafeStoragePath(relDir))
    .then(() => true)
    .catch(() => false);
}

async function listFiles(relDir: string): Promise<string[]> {
  try {
    return await fs.readdir(resolveSafeStoragePath(relDir));
  } catch {
    return [];
  }
}

test('saveEvidenceImageBase64 writes a valid final file atomically', async () => {
  const submissionId = 900000001;
  const relDir = `evidence/submission_${submissionId}`;
  const saved = await saveEvidenceImageBase64({
    submissionId,
    originalFilename: 'proof.png',
    mimeType: 'image/png',
    dataBase64: VALID_PNG_BASE64,
  });

  assert.ok(saved.storagePath.startsWith(`${relDir}/`));
  assert.equal(saved.mimeType, 'image/png');
  assert.equal(saved.fileSize, 68);
  assert.ok(saved.originalFilename.includes('proof'));
  const abs = resolveSafeStoragePath(saved.storagePath);
  const buf = await fs.readFile(abs);
  assert.equal(buf.length, saved.fileSize);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);

  // No temporary file remains alongside the final file.
  const files = await listFiles(relDir);
  assert.ok(files.includes(path.basename(saved.storagePath)));
  assert.ok(!files.some((f) => f.endsWith('.tmp')));

  await cleanupWrittenEvidence([saved.storagePath]);
  assert.equal(await storageDirExists(relDir), false);
});

test('invalid image signature never creates a final file', async () => {
  const submissionId = 900000002;
  const relDir = `evidence/submission_${submissionId}`;
  const before = await listFiles(relDir);
  await assert.rejects(
    saveEvidenceImageBase64({
      submissionId,
      originalFilename: 'bad.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('not an image').toString('base64'),
    }),
    (err: any) => err?.code === 'INVALID_IMAGE_SIGNATURE',
  );
  const after = await listFiles(relDir);
  assert.deepEqual(after, before);
});

test('rename failure leaves no final or temporary file', async () => {
  const submissionId = 900000003;
  const relDir = `evidence/submission_${submissionId}`;
  const originalRename = fs.rename;
  let patched = false;
  try {
    (fs as any).rename = async () => {
      throw new Error('simulated rename failure');
    };
    patched = true;
    await assert.rejects(
      saveEvidenceImageBase64({
        submissionId,
        originalFilename: 'rename.png',
        mimeType: 'image/png',
        dataBase64: VALID_PNG_BASE64,
      }),
      /simulated rename failure/,
    );
  } finally {
    if (patched) (fs as any).rename = originalRename;
  }
  const files = await listFiles(relDir);
  assert.deepEqual(files, []);
});

test('cleanup deletes only tracked files and preserves unrelated evidence', async () => {
  const submissionId = 900000004;
  const relDir = `evidence/submission_${submissionId}`;
  const savedA = await saveEvidenceImageBase64({
    submissionId,
    originalFilename: 'tracked.png',
    mimeType: 'image/png',
    dataBase64: VALID_PNG_BASE64,
  });
  const savedB = await saveEvidenceImageBase64({
    submissionId,
    originalFilename: 'unrelated.png',
    mimeType: 'image/png',
    dataBase64: VALID_PNG_BASE64,
  });

  await cleanupWrittenEvidence([savedA.storagePath]);

  const remaining = await listFiles(relDir);
  assert.ok(remaining.includes(path.basename(savedB.storagePath)));
  assert.ok(!remaining.includes(path.basename(savedA.storagePath)));

  // Final cleanup of the unrelated fixture.
  await cleanupWrittenEvidence([savedB.storagePath]);
  assert.equal(await storageDirExists(relDir), false);
});

test('cleanup ignores ENOENT and never masks errors', async () => {
  await cleanupWrittenEvidence(['evidence/submission_999999999/missing.png']);

  // A non-empty directory cannot be removed; cleanup must still resolve.
  const relDir = 'evidence/submission_999999998';
  const absDir = resolveSafeStoragePath(relDir);
  await fs.mkdir(absDir, { recursive: true });
  const keep = path.join(absDir, 'keep.txt');
  await fs.writeFile(keep, 'x');
  try {
    await removeEvidenceDirectoryIfEmpty(relDir);
    assert.equal((await fs.readFile(keep, 'utf8')), 'x');
  } finally {
    await fs.unlink(keep).catch(() => undefined);
    await fs.rmdir(absDir).catch(() => undefined);
  }
});

test('deleteEvidenceFile refuses to escape the storage root', async () => {
  await assert.rejects(deleteEvidenceFile('../outside.png'));
});
