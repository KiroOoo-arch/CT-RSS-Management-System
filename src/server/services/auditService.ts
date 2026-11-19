import net from 'node:net';
import type { PoolClient } from 'pg';
import { query } from '../config/database.ts';

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
  client?: PoolClient,
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

  const params = [
    input.userId,
    input.action,
    input.subjectType ?? null,
    input.subjectId ?? null,
    input.oldValues ? JSON.stringify(input.oldValues) : null,
    input.newValues ? JSON.stringify(input.newValues) : null,
    normalizeIpForInet(input.ipAddress),
    input.userAgent ? input.userAgent.slice(0, 500) : null,
  ];

  if (client) {
    await client.query(sql, params);
    return;
  }

  await query(sql, params);
}
