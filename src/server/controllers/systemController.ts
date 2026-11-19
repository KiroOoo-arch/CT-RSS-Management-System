import type { Response } from 'express';
import { checkDatabaseHealth } from '../config/database.ts';
import type { ContextualRequest } from '../middleware/requestContext.ts';
import { getFoundationSnapshot } from '../services/systemService.ts';
import type { ApiSuccessResponse, DatabaseReadiness, FoundationSnapshot } from '../types/api.ts';
import { getSessionSecurityStatus } from '../utils/session.ts';

export async function getHealth(req: ContextualRequest, res: Response): Promise<void> {
  const db = await checkDatabaseHealth();
  const session = getSessionSecurityStatus();
  const response: ApiSuccessResponse<{
    status: 'ok';
    service: string;
    timestamp: string;
    database: DatabaseReadiness;
    session: {
      configured: boolean;
      meetsMinimumLength: boolean;
      usingEphemeralFallback: boolean;
    };
  }> = {
    success: true,
    data: {
      status: 'ok',
      service: 'ct-rss-management-system',
      timestamp: new Date().toISOString(),
      database: db,
      session,
    },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getFoundation(req: ContextualRequest, res: Response): Promise<void> {
  const snapshot = await getFoundationSnapshot();
  const response: ApiSuccessResponse<FoundationSnapshot> = {
    success: true,
    data: snapshot,
    requestId: req.requestId,
  };
  res.json(response);
}
