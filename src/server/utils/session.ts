import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'ct_rss_session';
export const CSRF_COOKIE_NAME = 'ct_rss_csrf';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export interface SessionPayload {
  uid: number;
  sid: string;
  iat: number;
  exp: number;
}

const EPHEMERAL_SECRET = crypto.randomBytes(32);

function getSessionSecret(): Buffer {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return crypto.createHash('sha256').update(configured).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET must be configured with at least 16 characters in production.',
    );
  }
  return EPHEMERAL_SECRET;
}

export function getSessionSecurityStatus(): {
  configured: boolean;
  meetsMinimumLength: boolean;
  usingEphemeralFallback: boolean;
} {
  const configured = process.env.SESSION_SECRET?.trim() ?? '';
  const isConfigured = configured.length > 0;
  const meetsMinimumLength = configured.length >= 16;
  return {
    configured: isConfigured,
    meetsMinimumLength,
    usingEphemeralFallback: !meetsMinimumLength,
  };
}

const revokedSessions = new Map<string, number>();

function pruneRevokedSessions(nowSeconds: number): void {
  if (revokedSessions.size < 250) {
    return;
  }
  for (const [sid, exp] of revokedSessions.entries()) {
    if (exp <= nowSeconds) {
      revokedSessions.delete(sid);
    }
  }
}

export function revokeSessionId(sid: string, expSeconds?: number): void {
  const nowSeconds = Math.floor(Date.now() / 1000);
  pruneRevokedSessions(nowSeconds);
  revokedSessions.set(sid, expSeconds ?? nowSeconds + SESSION_TTL_SECONDS);
}

export function isSessionRevoked(sid: string): boolean {
  const exp = revokedSessions.get(sid);
  if (exp === undefined) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp <= nowSeconds) {
    revokedSessions.delete(sid);
    return false;
  }
  return true;
}

export function hashSessionId(sid: string): string {
  return crypto.createHash('sha256').update(sid).digest('hex');
}

function signBase64Url(data: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
}

export function createSessionToken(userId: number): {
  token: string;
  payload: SessionPayload;
  sidHash: string;
  csrfToken: string;
} {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sid = crypto.randomBytes(24).toString('base64url');
  const payload: SessionPayload = {
    uid: userId,
    sid,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signBase64Url(encoded);
  const token = `${encoded}.${signature}`;
  return {
    token,
    payload,
    sidHash: hashSessionId(sid),
    csrfToken: deriveCsrfToken(userId, sid),
  };
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex === token.length - 1) {
    return null;
  }

  const encoded = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);
  const expectedSig = signBase64Url(encoded);

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<SessionPayload>;
    if (
      typeof parsed.uid !== 'number' ||
      !Number.isInteger(parsed.uid) ||
      parsed.uid <= 0 ||
      typeof parsed.sid !== 'string' ||
      parsed.sid.length < 16 ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSeconds) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

export function deriveCsrfToken(userId: number, sid: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`csrf:${userId}:${sid}`)
    .digest('base64url');
}

export function verifyCsrfToken(userId: number, sid: string, providedToken: string | undefined): boolean {
  if (!providedToken || typeof providedToken !== 'string') {
    return false;
  }
  const expected = deriveCsrfToken(userId, sid);
  const a = Buffer.from(providedToken, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function safeCompareHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  const parts = header.split(';');
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

type ExtendedCookieOptions = CookieOptions & { partitioned?: boolean };

function isHttpsRequest(req: Request): boolean {
  if (req.secure) {
    return true;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    const tokens = forwardedProto.split(',').map((token) => token.trim().toLowerCase());
    if (tokens.includes('https')) {
      return true;
    }
  } else if (Array.isArray(forwardedProto)) {
    const hasHttps = forwardedProto.some((entry) =>
      entry
        .split(',')
        .map((token) => token.trim().toLowerCase())
        .includes('https'),
    );
    if (hasHttps) {
      return true;
    }
  }

  const forwarded = req.headers['forwarded'];
  if (typeof forwarded === 'string' && /proto=https\b/i.test(forwarded)) {
    return true;
  }

  const forwardedSsl = req.headers['x-forwarded-ssl'];
  if (typeof forwardedSsl === 'string' && forwardedSsl.trim().toLowerCase() === 'on') {
    return true;
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.toLowerCase().startsWith('https://')) {
    return true;
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.toLowerCase().startsWith('https://')) {
    return true;
  }

  return false;
}

function buildCookieOptions(req: Request, httpOnly: boolean): ExtendedCookieOptions {
  const secure = isHttpsRequest(req);
  const options: ExtendedCookieOptions = {
    httpOnly,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
  };
  if (secure) {
    options.partitioned = true;
  }
  return options;
}

export function setAuthCookies(req: Request, res: Response, sessionToken: string, csrfToken: string): void {
  const maxAgeMs = SESSION_TTL_SECONDS * 1000;

  res.cookie(SESSION_COOKIE_NAME, sessionToken, {
    ...buildCookieOptions(req, true),
    maxAge: maxAgeMs,
  });

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    ...buildCookieOptions(req, false),
    maxAge: maxAgeMs,
  });
}

export function clearAuthCookies(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, buildCookieOptions(req, true));
  res.clearCookie(CSRF_COOKIE_NAME, buildCookieOptions(req, false));
}
