import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiClientError, apiGet } from '../services/apiClient.ts';
import type { AuditLogListResponse, AuditLogRecord } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { SelectInput, TextInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface AuditLogsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

export function AuditLogsPage({
  isAuthenticated,
  onReturnToOverview,
}: AuditLogsPageProps) {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [subjectTypes, setSubjectTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);

  const loadLogs = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setLogs([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', '20');
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (actionFilter !== 'all') {
        params.set('action', actionFilter);
      }
      if (subjectFilter !== 'all') {
        params.set('subjectType', subjectFilter);
      }
      if (dateFrom) {
        params.set('dateFrom', dateFrom);
      }
      if (dateTo) {
        params.set('dateTo', dateTo);
      }

      const res = await apiGet<AuditLogListResponse>(
        `/api/v1/coordinator/audit-logs?${params.toString()}`,
      );
      setLogs(res.logs);
      setTotalPages(Math.max(1, res.totalPages));
      setActions(res.availableActions);
      setSubjectTypes(res.availableSubjectTypes);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load PostgreSQL audit logs.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, page, search, actionFilter, subjectFilter, dateFrom, dateTo]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const columns: Array<TableColumn<AuditLogRecord>> = [
    {
      key: 'timestamp',
      header: 'Timestamp',
      render: (r) => (
        <span className="font-mono text-xs text-[#64748B] tabular-nums whitespace-nowrap">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (r) => (
        <div className="min-w-[140px]">
          <p className="font-medium text-[#1E293B]">{r.actorName ?? 'System / Unauthenticated'}</p>
          <p className="text-xs text-[#64748B]">{r.actorEmail ?? r.ipAddress ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (r) => <StatusBadge tone="info" label={r.action} />,
    },
    {
      key: 'subject',
      header: 'Subject',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.subjectType ?? '—'}
          {r.subjectId !== null ? ` #${r.subjectId}` : ''}
        </span>
      ),
    },
    {
      key: 'inspect',
      header: 'Payload',
      align: 'right',
      render: (r) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => setSelectedLog(r)}
        >
          Inspect
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'System', 'Audit Logs']}
        title="System Audit Trail (Read-Only)"
        description="Immutable PostgreSQL security and workflow audit logs covering logins, approvals, role assignments, attendance verifications, and generated reports."
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadLogs()}
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
              <p className="font-semibold">Authenticated Coordinator Session Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Sign in with an RSS Coordinator account to inspect immutable audit logs.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Audit logs are strictly read-only. Sensitive keys (passwords, tokens, secrets) are recursively redacted server-side before returning JSONB payloads.
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={logs}
        rowKey={(r) => String(r.id)}
        loading={loading}
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Search actor name, email, action, or subject..."
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput
              aria-label="Filter by audit action"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-auto min-w-[160px]"
            >
              <option value="all">All Actions</option>
              {actions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              aria-label="Filter by subject type"
              value={subjectFilter}
              onChange={(e) => {
                setSubjectFilter(e.target.value);
                setPage(1);
              }}
              className="w-auto min-w-[150px]"
            >
              <option value="all">All Subjects</option>
              {subjectTypes.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </SelectInput>

            <TextInput
              id="audit-from"
              type="date"
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="w-auto"
            />

            <TextInput
              id="audit-to"
              type="date"
              aria-label="To date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="w-auto"
            />
          </div>
        }
        emptyTitle="No audit log entries matched"
        emptyDescription="Audit events recorded by authentication and operational workflows will appear here."
      />

      <Modal
        open={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        size="lg"
        title={selectedLog ? `Audit Event #${selectedLog.id} — ${selectedLog.action}` : 'Audit Entry'}
        description={
          selectedLog
            ? `${selectedLog.actorName ?? 'System'} · ${new Date(selectedLog.createdAt).toLocaleString()}`
            : undefined
        }
        footer={
          <Button variant="secondary" size="sm" onClick={() => setSelectedLog(null)}>
            Close
          </Button>
        }
      >
        {selectedLog ? (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Actor &amp; Network</p>
                <p className="font-medium text-[#1E293B]">
                  {selectedLog.actorName ?? 'System / Unauthenticated'}
                </p>
                <p className="font-mono text-[#64748B]">
                  IP: {selectedLog.ipAddress ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Subject Reference</p>
                <p className="font-mono font-medium text-[#1E293B]">
                  {selectedLog.subjectType ?? 'None'}
                  {selectedLog.subjectId !== null ? ` (#${selectedLog.subjectId})` : ''}
                </p>
                <p className="flex items-center gap-1 text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Redacted server-side payload</span>
                </p>
              </div>
            </div>

            {selectedLog.oldValues ? (
              <div className="space-y-1">
                <p className="font-semibold text-[#64748B] uppercase">Previous Values</p>
                <pre className="overflow-x-auto rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 font-mono text-[11px] text-[#1E293B]">
                  {JSON.stringify(selectedLog.oldValues, null, 2)}
                </pre>
              </div>
            ) : null}

            {selectedLog.newValues ? (
              <div className="space-y-1">
                <p className="font-semibold text-[#64748B] uppercase">Recorded / New Values</p>
                <pre className="overflow-x-auto rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 font-mono text-[11px] text-[#1E293B]">
                  {JSON.stringify(selectedLog.newValues, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
