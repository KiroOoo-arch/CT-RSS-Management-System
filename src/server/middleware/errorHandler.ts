import type { NextFunction, Request, Response } from 'express';
import type { ContextualRequest } from './requestContext.ts';
import type { ApiErrorResponse } from '../types/api.ts';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export function asyncHandler(
  fn: (req: ContextualRequest, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: ContextualRequest, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function apiNotFoundHandler(req: ContextualRequest, res: Response): void {
  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `API endpoint ${req.method} ${req.originalUrl} does not exist.`,
    },
    requestId: req.requestId,
  };
  res.status(404).json(payload);
}

export function globalErrorHandler(
  err: unknown,
  req: ContextualRequest,
  res: Response,
  _next: NextFunction,
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_SERVER_ERROR';
  const message = isAppError
    ? err.message
    : 'An unexpected server error occurred. Please try again.';

  if (!isAppError) {
    console.error('[CT-RSS Server Error]', err);
  }

  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
    requestId: req.requestId,
  };

  res.status(statusCode).json(payload);
}
