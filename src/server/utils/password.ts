import bcrypt from 'bcryptjs';

const BCRYPT_MAX_PASSWORD_BYTES = 72;
const BCRYPT_ROUNDS = 12;

export function getUtf8ByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

export async function hashPassword(plainText: string): Promise<string> {
  if (getUtf8ByteLength(plainText) > BCRYPT_MAX_PASSWORD_BYTES) {
    throw new Error('Password exceeds the maximum supported bcrypt password length of 72 bytes.');
  }
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

export async function verifyPassword(plainText: string, hashed: string): Promise<boolean> {
  if (!plainText || !hashed) {
    return false;
  }
  return bcrypt.compare(plainText, hashed);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (getUtf8ByteLength(password) > BCRYPT_MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${BCRYPT_MAX_PASSWORD_BYTES} bytes.`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number.';
  }
  return null;
}
