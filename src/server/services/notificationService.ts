import crypto from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { query } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import type { NotificationRecord } from '../types/api.ts';

export interface DbExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface CreateNotificationInput {
  userId: number;
  title: string;
  message: string;
  notificationType: string;
  relatedType?: string | null;
  relatedId?: number | null;
  deduplicateUnread?: boolean;
}

export async function createNotification(
  input: CreateNotificationInput,
  executor: DbExecutor = { query },
): Promise<string | null> {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    return null;
  }

  const title = input.title.trim().slice(0, 200);
  const message = input.message.trim();
  const notificationType = input.notificationType.trim().slice(0, 50);

  if (!title || !message || !notificationType) {
    return null;
  }

  if (input.deduplicateUnread) {
    const existing = await executor.query<{ id: string }>(
      `SELECT id::text AS id
       FROM notifications
       WHERE user_id = $1
         AND notification_type = $2
         AND COALESCE(related_type, '') = COALESCE($3, '')
         AND COALESCE(related_id, 0) = COALESCE($4, 0)
         AND read_at IS NULL
       LIMIT 1`,
      [input.userId, notificationType, input.relatedType ?? null, input.relatedId ?? null],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0]?.id ?? null;
    }
  }

  const id = crypto.randomUUID();
  await executor.query(
    `INSERT INTO notifications (
       id,
       user_id,
       title,
       message,
       notification_type,
       related_type,
       related_id
     )
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.userId,
      title,
      message,
      notificationType,
      input.relatedType ?? null,
      input.relatedId ?? null,
    ],
  );
  return id;
}

export async function notifyActiveCoordinators(
  input: Omit<CreateNotificationInput, 'userId'>,
  executor: DbExecutor = { query },
): Promise<void> {
  const coordinatorsRes = await executor.query<{ id: number }>(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'RSS Coordinator'
       AND u.account_status = 'active'
       AND u.deleted_at IS NULL`,
  );

  for (const coordinator of coordinatorsRes.rows) {
    await createNotification(
      {
        ...input,
        userId: Number(coordinator.id),
      },
      executor,
    );
  }
}

interface NotificationDbRow {
  id: string;
  user_id: number;
  title: string;
  message: string;
  notification_type: string;
  related_type: string | null;
  related_id: number | null;
  read_at: string | null;
  created_at: string;
}

function mapNotificationRow(row: NotificationDbRow): NotificationRecord {
  return {
    id: row.id,
    userId: Number(row.user_id),
    title: row.title,
    message: row.message,
    notificationType: row.notification_type,
    relatedType: row.related_type,
    relatedId: row.related_id !== null ? Number(row.related_id) : null,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function listUserNotifications(input: {
  userId: number;
  status?: 'all' | 'unread' | 'read';
  limit?: number;
}): Promise<{
  notifications: NotificationRecord[];
  unreadCount: number;
}> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const filterSql =
    input.status === 'unread'
      ? 'AND read_at IS NULL'
      : input.status === 'read'
        ? 'AND read_at IS NOT NULL'
        : '';

  const [listRes, unreadRes] = await Promise.all([
    query<NotificationDbRow>(
      `SELECT
         id::text AS id,
         user_id,
         title,
         message,
         notification_type,
         related_type,
         related_id,
         read_at::text AS read_at,
         created_at::text AS created_at
       FROM notifications
       WHERE user_id = $1
         ${filterSql}
       ORDER BY created_at DESC
       LIMIT $2`,
      [input.userId, limit],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [input.userId],
    ),
  ]);

  return {
    notifications: listRes.rows.map(mapNotificationRow),
    unreadCount: Number.parseInt(unreadRes.rows[0]?.count ?? '0', 10) || 0,
  };
}

export async function markNotificationAsRead(input: {
  notificationId: string;
  userId: number;
}): Promise<NotificationRecord> {
  const uuid = input.notificationId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new AppError(400, 'INVALID_NOTIFICATION_ID', 'Invalid notification identifier.');
  }

  const res = await query<NotificationDbRow>(
    `UPDATE notifications
     SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1::uuid AND user_id = $2
     RETURNING
       id::text AS id,
       user_id,
       title,
       message,
       notification_type,
       related_type,
       related_id,
       read_at::text AS read_at,
       created_at::text AS created_at`,
    [uuid, input.userId],
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification record not found.');
  }

  return mapNotificationRow(row);
}

export async function markAllNotificationsAsRead(userId: number): Promise<{ updatedCount: number }> {
  const res = await query<{ count: string }>(
    `WITH updated AS (
       UPDATE notifications
       SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM updated`,
    [userId],
  );
  return {
    updatedCount: Number.parseInt(res.rows[0]?.count ?? '0', 10) || 0,
  };
}
