import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler.ts';

interface BucketEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly message: string;
  private readonly buckets = new Map<string, BucketEntry>();

  constructor(options: { maxAttempts: number; windowMs: number; message: string }) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowMs;
    this.message = options.message;
  }

  public consume(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const cutoff = nowMs - this.windowMs;
    const entry = this.buckets.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    if (entry.timestamps.length >= this.maxAttempts) {
      const oldest = entry.timestamps[0] ?? nowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(key, entry);
      return { allowed: false, retryAfterSeconds };
    }

    entry.timestamps.push(nowMs);
    this.buckets.set(key, entry);

    if (this.buckets.size > 2000) {
      for (const [bucketKey, bucketValue] of this.buckets.entries()) {
        if (bucketValue.timestamps.every((ts) => ts <= cutoff)) {
          this.buckets.delete(bucketKey);
        }
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  public reset(): void {
    this.buckets.clear();
  }
}

export const loginRateLimiter = new SlidingWindowRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  message: 'Too many sign-in attempts. Please wait before trying again.',
});

export const bootstrapRateLimiter = new SlidingWindowRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Too many bootstrap attempts. Please try again later.',
});

export const registerRateLimiter = new SlidingWindowRateLimiter({
  maxAttempts: 8,
  windowMs: 15 * 60 * 1000,
  message: 'Too many registration requests from this network. Please wait before retrying.',
});

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimitMiddleware(
  limiter: SlidingWindowRateLimiter,
  keySuffixFn?: (req: Request) => string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const suffix = keySuffixFn ? keySuffixFn(req) : '';
    const key = suffix ? `${ip}:${suffix}` : ip;
    const check = limiter.consume(key);

    if (!check.allowed) {
      res.setHeader('Retry-After', String(check.retryAfterSeconds));
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          `Too many requests. Please retry after ${check.retryAfterSeconds} seconds.`,
        ),
      );
      return;
    }

    next();
  };
}
