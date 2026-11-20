import net from 'node:net';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type { AuditLogListResponse, AuditLogRecord } from '../types/api.ts';

interface DbExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface AuditLogInput {
  userId: number | null;
  action: string;
  subjectType?: string | null;
  subjectId?: number | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|cookie|session|credential|auth_key|private_key/i;

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[TRUNCATED]';
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeJsonValue(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 497)}...`;
  }
  return value;
}

function sanitizeJsonObject(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  return sanitizeJsonValue(obj, 0) as Record<string, unknown>;
}

function normalizeIpForInet(rawIp: string | null | undefined): string | null {
  if (!rawIp) {
    return null;
  }
  const trimmed = rawIp.split(',')[0]?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  const stripped = trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
  return net.isIP(stripped) !== 0 ? stripped : null;
}

export async function recordAuditLog(
  input: AuditLogInput,
  client?: DbExecutor,
): Promise<void> {
  const sql = `
    INSERT INTO audit_logs (
      user_id,
      action,
      subject_type,
      subject_id,
      old_values,
      new_values,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet, $8)
  `;

  const sanitizedOld = sanitizeJsonObject(input.oldValues);
  const sanitizedNew = sanitizeJsonObject(input.newValues);

  const params = [
    input.userId,
    input.action,
    input.subjectType ?? null,
    input.subjectId ?? null,
    sanitizedOld ? JSON.stringify(sanitizedOld) : null,
    sanitizedNew ? JSON.stringify(sanitizedNew) : null,
    normalizeIpForInet(input.ipAddress),
    input.userAgent ? input.userAgent.slice(0, 500) : null,
  ];

  if (client) {
    await client.query(sql, params);
    return;
  }

  await query(sql, params);
}

interface AuditLogDbRow {
  id: number;
  user_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  subject_type: string | null;
  subject_id: number | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

function parseOptionalDateFilter(value: string | undefined, label: string): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be formatted as YYYY-MM-DD.`);
  }
  return trimmed;
}

export async function listAuditLogs(input: {
  search?: string;
  action?: string;
  subjectType?: string;
  subjectId?: number;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}): Promise<AuditLogListResponse> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  const dateFrom = parseOptionalDateFilter(input.dateFrom, 'Date from');
  const dateTo = parseOptionalDateFilter(input.dateTo, 'Date to');
  if (dateFrom && dateTo && dateTo < dateFrom) {
    throw new AppError(400, 'INVALID_DATE_RANGE', 'End date cannot precede start date.');
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim()}%`);
    const ref = `$${params.length}`;
    conditions.push(
      `(al.action ILIKE ${ref} OR COALESCE(al.subject_type, '') ILIKE ${ref} OR COALESCE(u.name, '') ILIKE ${ref} OR COALESCE(u.email, '') ILIKE ${ref} OR COALESCE(al.new_values::text, '') ILIKE ${ref} OR COALESCE(al.old_values::text, '') ILIKE ${ref})`,
    );
  }

  if (input.action && input.action.trim().length > 0 && input.action !== 'all') {
    params.push(input.action.trim());
    conditions.push(`al.action = $${params.length}`);
  }

  if (input.subjectType && input.subjectType.trim().length > 0 && input.subjectType !== 'all') {
    params.push(input.subjectType.trim());
    conditions.push(`al.subject_type = $${params.length}`);
  }

  if (input.subjectId !== undefined && Number.isInteger(input.subjectId) && input.subjectId > 0) {
    params.push(input.subjectId);
    conditions.push(`al.subject_id = $${params.length}`);
  }

  if (input.userId !== undefined && Number.isInteger(input.userId) && input.userId > 0) {
    params.push(input.userId);
    conditions.push(`al.user_id = $${params.length}`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`al.created_at >= $${params.length}::date`);
  }

  if (dateTo) {
    params.push(dateTo);
    conditions.push(`al.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${whereSql}`,
    params,
  );
  const total = Number.parseInt(countRes.rows[0]?.count ?? '0', 10) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const dataParams = [...params, pageSize, offset];
  const limitRef = `$${dataParams.length - 1}`;
  const offsetRef = `$${dataParams.length}`;

  const [rowsRes, actionsRes, subjectsRes] = await Promise.all([
    query<AuditLogDbRow>(
      `SELECT
         al.id,
         al.user_id,
         u.name AS actor_name,
         u.email AS actor_email,
         al.action,
         al.subject_type,
         al.subject_id,
         al.old_values,
         al.new_values,
         host(al.ip_address) AS ip_address,
         al.user_agent,
         al.created_at::text AS created_at
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereSql}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ${limitRef} OFFSET ${offsetRef}`,
      dataParams,
    ),
    query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action ASC LIMIT 200`,
    ),
    query<{ subject_type: string }>(
      `SELECT DISTINCT subject_type FROM audit_logs WHERE subject_type IS NOT NULL ORDER BY subject_type ASC LIMIT 100`,
    ),
  ]);

  const logs: AuditLogRecord[] = rowsRes.rows.map((row) => ({
    id: Number(row.id),
    userId: row.user_id !== null ? Number(row.user_id) : null,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id !== null ? Number(row.subject_id) : null,
    oldValues: sanitizeJsonObject(row.old_values),
    newValues: sanitizeJsonObject(row.new_values),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }));

  return {
    logs,
    total,
    page: Math.min(page, totalPages),
    pageSize,
    totalPages,
    availableActions: actionsRes.rows.map((r) => r.action),
    availableSubjectTypes: subjectsRes.rows.map((r) => r.subject_type),
  };
}
