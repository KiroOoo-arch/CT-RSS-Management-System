import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface ContextualRequest extends Request {
  requestId?: string;
}

export function requestContextMiddleware(
  req: ContextualRequest,
  res: Response,
  next: NextFunction,
): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
