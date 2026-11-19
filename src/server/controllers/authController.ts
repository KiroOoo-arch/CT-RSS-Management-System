import crypto from 'node:crypto';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { loginWithPassword, logoutSession, registerStudentAccount } from '../services/authService.ts';
import { bootstrapInitialCoordinator, getBootstrapStatus } from '../services/bootstrapService.ts';
import type { ApiSuccessResponse, AuthSessionResponse } from '../types/api.ts';
import { clearAuthCookies, setAuthCookies } from '../utils/session.ts';

function extractClientIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export async function postLogin(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const result = await loginWithPassword({
    email,
    password,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  setAuthCookies(req, res, result.sessionToken, result.csrfToken);

  const response: ApiSuccessResponse<AuthSessionResponse> = {
    success: true,
    data: {
      user: result.user,
      csrfToken: result.csrfToken,
    },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postLogout(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.authUser || !req.sessionId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  await logoutSession({
    userId: req.authUser.id,
    sessionId: req.sessionId,
    sessionExp: req.sessionExp,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  clearAuthCookies(req, res);

  const response: ApiSuccessResponse<{ signedOut: true }> = {
    success: true,
    data: { signedOut: true },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.authUser || !req.csrfToken) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const response: ApiSuccessResponse<AuthSessionResponse> = {
    success: true,
    data: {
      user: req.authUser,
      csrfToken: req.csrfToken,
    },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postRegister(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const result = await registerStudentAccount({
    email: typeof body.email === 'string' ? body.email : '',
    password: typeof body.password === 'string' ? body.password : '',
    studentNumber: typeof body.studentNumber === 'string' ? body.studentNumber : '',
    firstName: typeof body.firstName === 'string' ? body.firstName : '',
    middleName: typeof body.middleName === 'string' ? body.middleName : undefined,
    lastName: typeof body.lastName === 'string' ? body.lastName : '',
    suffix: typeof body.suffix === 'string' ? body.suffix : undefined,
    contactNumber: typeof body.contactNumber === 'string' ? body.contactNumber : undefined,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{
    registration: typeof result;
    message: string;
  }> = {
    success: true,
    data: {
      registration: result,
      message:
        'Registration submitted successfully. Your account is pending verification by the College of Technology RSS Coordinator.',
    },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function getAuthBootstrapStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const status = await getBootstrapStatus();
  const response: ApiSuccessResponse<typeof status> = {
    success: true,
    data: status,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postBootstrapCoordinator(req: AuthenticatedRequest, res: Response): Promise<void> {
  const configuredSecret = process.env.BOOTSTRAP_SECRET?.trim();
  if (!configuredSecret) {
    throw new AppError(
      403,
      'BOOTSTRAP_DISABLED',
      'API Coordinator bootstrap is disabled. Configure BOOTSTRAP_SECRET or use the CLI command npm run db:bootstrap-coordinator.',
    );
  }

  const providedSecret = req.header('x-bootstrap-token') ?? '';
  const expectedBuf = Buffer.from(configuredSecret, 'utf8');
  const providedBuf = Buffer.from(providedSecret, 'utf8');
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    await recordAuditLog({
      userId: null,
      action: 'bootstrap_coordinator_rejected',
      subjectType: 'users',
      subjectId: null,
      newValues: { reason: 'invalid_bootstrap_token' },
      ipAddress: extractClientIp(req),
      userAgent: req.get('user-agent') ?? null,
    }).catch(() => undefined);
    throw new AppError(403, 'INVALID_BOOTSTRAP_TOKEN', 'Invalid bootstrap authorization token.');
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await bootstrapInitialCoordinator({
    name: typeof body.name === 'string' ? body.name : '',
    email: typeof body.email === 'string' ? body.email : '',
    password: typeof body.password === 'string' ? body.password : '',
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.status(201).json(response);
}
