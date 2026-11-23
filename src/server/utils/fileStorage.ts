import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../middleware/errorHandler.ts';
import type { ReportTemplateConfig } from '../types/api.ts';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const EVIDENCE_DIR = path.join(STORAGE_ROOT, 'evidence');
const REPORTS_DIR = path.join(STORAGE_ROOT, 'reports');
const TEMPLATES_DIR = path.join(STORAGE_ROOT, 'templates');

export const MAX_EVIDENCE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB

const ALLOWED_IMAGE_MIMES = new Map<string, { ext: string; mime: string }>([
  ['image/jpeg', { ext: 'jpg', mime: 'image/jpeg' }],
  ['image/jpg', { ext: 'jpg', mime: 'image/jpeg' }],
  ['image/png', { ext: 'png', mime: 'image/png' }],
  ['image/webp', { ext: 'webp', mime: 'image/webp' }],
]);

async function ensureStorageDirectories(): Promise<void> {
  await Promise.all([
    fs.mkdir(EVIDENCE_DIR, { recursive: true }),
    fs.mkdir(REPORTS_DIR, { recursive: true }),
    fs.mkdir(TEMPLATES_DIR, { recursive: true }),
  ]);
}

export function resolveSafeStoragePath(relativeStoragePath: string): string {
  const normalized = path.normalize(relativeStoragePath).replace(/^([/\\])+/, '');
  const resolved = path.resolve(STORAGE_ROOT, normalized);
  if (!resolved.startsWith(`${STORAGE_ROOT}${path.sep}`) && resolved !== STORAGE_ROOT) {
    throw new AppError(400, 'INVALID_STORAGE_PATH', 'Unsafe file storage path.');
  }
  return resolved;
}

function detectImageMimeFromMagicBytes(buf: Buffer): string | null {
  if (buf.length < 12) {
    return null;
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function sanitizeOriginalFilename(rawName: string): string {
  const base = path.basename(rawName || 'evidence').replace(/[^\w.\- ()]/g, '_').trim();
  return (base || 'evidence').slice(0, 255);
}

export async function saveEvidenceImageBase64(input: {
  submissionId: number;
  originalFilename: string;
  mimeType: string;
  dataBase64: string;
}): Promise<{
  storagePath: string;
  mimeType: string;
  fileSize: number;
  originalFilename: string;
}> {
  await ensureStorageDirectories();

  const declaredMime = input.mimeType.trim().toLowerCase();
  const mimeMeta = ALLOWED_IMAGE_MIMES.get(declaredMime);
  if (!mimeMeta) {
    throw new AppError(
      400,
      'INVALID_FILE_TYPE',
      'Only JPEG, PNG, and WebP images are permitted for accomplishment evidence.',
    );
  }

  let base64Payload = input.dataBase64.trim();
  const dataUriPrefix = /^data:image\/[a-zA-Z0-9+.-]+;base64,/.exec(base64Payload);
  if (dataUriPrefix) {
    base64Payload = base64Payload.slice(dataUriPrefix[0].length);
  }
  base64Payload = base64Payload.replace(/\s+/g, '');

  if (!base64Payload || !/^[A-Za-z0-9+/=]+$/.test(base64Payload)) {
    throw new AppError(400, 'INVALID_FILE_DATA', 'Uploaded image encoding is invalid.');
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  if (buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Uploaded evidence image cannot be empty.');
  }
  if (buffer.length > MAX_EVIDENCE_IMAGE_BYTES) {
    throw new AppError(
      400,
      'FILE_TOO_LARGE',
      'Each evidence image must not exceed 5 MB.',
    );
  }

  const detectedMime = detectImageMimeFromMagicBytes(buffer);
  if (!detectedMime || !ALLOWED_IMAGE_MIMES.has(detectedMime)) {
    throw new AppError(
      400,
      'INVALID_IMAGE_SIGNATURE',
      'The uploaded file content is not a valid JPEG, PNG, or WebP image.',
    );
  }

  const verifiedMeta = ALLOWED_IMAGE_MIMES.get(detectedMime)!;
  const subdir = path.join('evidence', `submission_${input.submissionId}`);
  const absSubdir = resolveSafeStoragePath(subdir);
  await fs.mkdir(absSubdir, { recursive: true });

  const safeFilename = `${crypto.randomUUID()}.${verifiedMeta.ext}`;
  const relativeStoragePath = path.join(subdir, safeFilename);
  const absFilePath = resolveSafeStoragePath(relativeStoragePath);
  const tempFilePath = `${absFilePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(tempFilePath, buffer);
    await fs.rename(tempFilePath, absFilePath);
  } catch (err) {
    await fs.unlink(tempFilePath).catch(() => undefined);
    throw err;
  }

  return {
    storagePath: relativeStoragePath.replace(/\\/g, '/'),
    mimeType: verifiedMeta.mime,
    fileSize: buffer.length,
    originalFilename: sanitizeOriginalFilename(input.originalFilename),
  };
}

export async function deleteEvidenceFile(relativeStoragePath: string): Promise<void> {
  try {
    const absPath = resolveSafeStoragePath(relativeStoragePath);
    await fs.unlink(absPath);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'ENOENT') {
      throw err;
    }
  }
}

export async function removeEvidenceDirectoryIfEmpty(relativeDirectory: string): Promise<void> {
  try {
    const absPath = resolveSafeStoragePath(relativeDirectory);
    await fs.rmdir(absPath);
  } catch {
    // Ignore missing or non-empty directories.
  }
}

export async function readStoredFileBuffer(relativeStoragePath: string): Promise<Buffer> {
  const absPath = resolveSafeStoragePath(relativeStoragePath);
  try {
    return await fs.readFile(absPath);
  } catch {
    throw new AppError(404, 'FILE_NOT_FOUND', 'Requested file is not available in storage.');
  }
}

export async function saveGeneratedReportPdf(input: {
  reportType: 'individual' | 'section';
  referenceCode: string;
  buffer: Buffer;
}): Promise<{ storagePath: string; fileHash: string }> {
  await ensureStorageDirectories();

  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const safeRef = input.referenceCode.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${input.reportType}_${safeRef}_${Date.now()}_${sha256.slice(0, 8)}.pdf`;
  const relativeStoragePath = path.join('reports', fileName).replace(/\\/g, '/');
  const absPath = resolveSafeStoragePath(relativeStoragePath);
  await fs.writeFile(absPath, input.buffer);

  return {
    storagePath: relativeStoragePath,
    fileHash: sha256,
  };
}

export const DEFAULT_TEMPLATE_CONFIG: ReportTemplateConfig = {
  reportType: 'both',
  subtitle: 'College of Technology — Recognized Student Service (CT-RSS) Official Report',
  headerNote: 'Lapu-Lapu City College · Carajay, Gun-ob, Lapu-Lapu City',
  footerNote:
    'Generated by CT-RSS Management System. Official credited service hours include only verified attendance and approved adjustments.',
  signatoryTitle: 'College of Technology RSS Coordinator',
  includeSections: {
    attendanceSummary: true,
    serviceHoursBreakdown: true,
    accomplishmentNarrative: true,
    evidenceCountSummary: true,
    sectionComparison: false,
  },
};

export async function saveTemplateConfigFile(input: {
  collegeId: number;
  templateName: string;
  templateVersion: string;
  config: ReportTemplateConfig;
}): Promise<string> {
  await ensureStorageDirectories();
  const slug = input.templateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const verSlug = input.templateVersion
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 24);
  const fileName = `college_${input.collegeId}_${slug || 'template'}_v${verSlug}_${Date.now()}.json`;
  const relativeStoragePath = path.join('templates', fileName).replace(/\\/g, '/');
  const absPath = resolveSafeStoragePath(relativeStoragePath);
  await fs.writeFile(absPath, JSON.stringify(input.config, null, 2), 'utf8');
  return relativeStoragePath;
}

export async function readTemplateConfigFile(
  relativeStoragePath: string,
): Promise<ReportTemplateConfig> {
  try {
    const absPath = resolveSafeStoragePath(relativeStoragePath);
    const raw = await fs.readFile(absPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ReportTemplateConfig>;
    return {
      reportType:
        parsed.reportType === 'individual' || parsed.reportType === 'section'
          ? parsed.reportType
          : 'both',
      subtitle:
        typeof parsed.subtitle === 'string' && parsed.subtitle.trim()
          ? parsed.subtitle.trim()
          : DEFAULT_TEMPLATE_CONFIG.subtitle,
      headerNote:
        typeof parsed.headerNote === 'string' && parsed.headerNote.trim()
          ? parsed.headerNote.trim()
          : DEFAULT_TEMPLATE_CONFIG.headerNote,
      footerNote:
        typeof parsed.footerNote === 'string' && parsed.footerNote.trim()
          ? parsed.footerNote.trim()
          : DEFAULT_TEMPLATE_CONFIG.footerNote,
      signatoryTitle:
        typeof parsed.signatoryTitle === 'string' && parsed.signatoryTitle.trim()
          ? parsed.signatoryTitle.trim()
          : DEFAULT_TEMPLATE_CONFIG.signatoryTitle,
      includeSections: {
        attendanceSummary:
          parsed.includeSections?.attendanceSummary ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.attendanceSummary,
        serviceHoursBreakdown:
          parsed.includeSections?.serviceHoursBreakdown ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.serviceHoursBreakdown,
        accomplishmentNarrative:
          parsed.includeSections?.accomplishmentNarrative ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.accomplishmentNarrative,
        evidenceCountSummary:
          parsed.includeSections?.evidenceCountSummary ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.evidenceCountSummary,
        sectionComparison:
          parsed.includeSections?.sectionComparison ??
          DEFAULT_TEMPLATE_CONFIG.includeSections.sectionComparison,
      },
    };
  } catch {
    return DEFAULT_TEMPLATE_CONFIG;
  }
}
