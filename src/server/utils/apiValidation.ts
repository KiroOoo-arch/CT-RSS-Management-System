import { AppError } from '../middleware/errorHandler.ts';

const STRICT_POSITIVE_INTEGER_PATTERN = /^[0-9]+$/;

export function parseStrictIntParam(raw: unknown, code: string, label: string): number {
  if (typeof raw !== 'string') {
    throw new AppError(400, code, `${label} must be a valid positive integer.`);
  }
  const trimmed = raw.trim();
  if (!STRICT_POSITIVE_INTEGER_PATTERN.test(trimmed)) {
    throw new AppError(400, code, `${label} must be a valid positive integer.`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(400, code, `${label} must be a valid positive integer.`);
  }
  return value;
}

export function parseOptionalIntParam(raw: unknown, code: string, label: string): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new AppError(400, code, `${label} must be a valid positive integer.`);
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  return parseStrictIntParam(trimmed, code, label);
}
