import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type { NotificationRecord } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface NotificationsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
  onNotificationsChanged?: () => void;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationsPage({
  isAuthenticated,
  onReturnToOverview,
  onNotificationsChanged,
}: NotificationsPageProps) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setNotifications([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{
        notifications: NotificationRecord[];
        unreadCount: number;
      }>(`/api/v1/notifications?status=${filter}&limit=100`);
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load notifications from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, filter]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = async (id: string) => {
    setMarkingId(id);
    try {
      await apiPatch(`/api/v1/notifications/${id}/read`);
      await loadNotifications();
      onNotificationsChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to mark notification as read.',
      );
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await apiPost('/api/v1/notifications/read-all');
      await loadNotifications();
      onNotificationsChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to mark all notifications as read.',
      );
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'System', 'Notifications']}
        title="Notifications Center"
        description="In-system workflow notifications for registrations, task applications, attendance verification, accomplishments, and generated PDF reports."
        actions={
          <>
            {isAuthenticated && unreadCount > 0 ? (
              <Button
                variant="primary"
                size="md"
                loading={markingAll}
                icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void handleMarkAllRead()}
              >
                Mark All Read ({unreadCount})
              </Button>
            ) : null}
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadNotifications()}
              >
                Refresh
              </Button>
            ) : null}
            <Button variant="ghost" size="md" onClick={onReturnToOverview}>
              Overview
            </Button>
          </>
        }
      />

      {!isAuthenticated ? (
        <Card>
          <CardContent className="flex items-start gap-3 text-sm text-[#1E293B]">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Authenticated Session Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Sign in to view and manage your personal notifications.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Filter notifications"
        className="inline-flex rounded-lg border border-[#E2E8F0] bg-white p-1"
      >
        {(
          [
            { id: 'all', label: 'All' },
            { id: 'unread', label: `Unread (${unreadCount})` },
            { id: 'read', label: 'Read' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`min-h-8 rounded-md px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              filter === tab.id
                ? 'bg-[#12345A] text-white'
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="px-5 py-8 text-center text-sm text-[#64748B]">
              Loading notifications...
            </p>
          ) : notifications.length === 0 ? (
            <div className="px-6 py-10 text-center space-y-1.5">
              <Bell className="mx-auto h-6 w-6 text-[#64748B]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#1E293B]">No notifications matched</p>
              <p className="text-xs text-[#64748B]">
                Workflow events triggered across CT-RSS modules appear here automatically.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#E2E8F0]">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between ${
                    !n.readAt ? 'bg-[#F4F6FA]/70' : 'bg-white'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[#1E293B]">{n.title}</p>
                      {!n.readAt ? (
                        <StatusBadge tone="info" label="Unread" />
                      ) : (
                        <StatusBadge tone="neutral" label="Read" />
                      )}
                      <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#64748B]">{n.message}</p>
                  </div>
                  {!n.readAt ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={markingId === n.id}
                      icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => void handleMarkRead(n.id)}
                    >
                      Mark Read
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
