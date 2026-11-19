import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Database,
  Layers,
  Milestone,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { apiGet } from '../services/apiClient.ts';
import type {
  AuthenticatedUser,
  FoundationSnapshot,
  HealthSnapshot,
  MilestoneItem,
  RoleName,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
import { CollegeLogo } from '../components/ui/CollegeLogo.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface FoundationOverviewPageProps {
  user: AuthenticatedUser | null;
  role: RoleName;
  onChangeDevRole?: (role: RoleName) => void;
}

type MilestoneFilter = 'all' | 'completed' | 'in_progress' | 'pending';

const ROLE_WELCOME: Record<RoleName, { heading: string; subtitle: string }> = {
  'RSS Coordinator': {
    heading: 'Coordinator Workspace',
    subtitle:
      'Primary operational authority for registrations, academic structure, task publication, attendance verification, accomplishment reviews, and official RSS PDF reports.',
  },
  Student: {
    heading: 'Student Service Portal',
    subtitle:
      'Personal workspace for eligible RSS task discovery, applications, verified service-hour tracking, versioned accomplishment submissions, and authorized individual reports.',
  },
  'Section Representative': {
    heading: 'Section Representative Portal (Read-Only)',
    subtitle:
      'Limited read-only overview scoped to authorized section information, tasks, and permitted participation summaries without approval or modification privileges.',
  },
};

export function FoundationOverviewPage({
  user,
  role,
  onChangeDevRole,
}: FoundationOverviewPageProps) {
  const [foundation, setFoundation] = useState<FoundationSnapshot | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MilestoneFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 12>(12);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [foundationData, healthData] = await Promise.all([
        apiGet<FoundationSnapshot>('/api/v1/system/foundation'),
        apiGet<HealthSnapshot>('/api/v1/health'),
      ]);
      setFoundation(foundationData);
      setHealth(healthData);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load system foundation metadata from the backend API.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const activeRoleSummary = useMemo(() => {
    return foundation?.roles.find((entry) => entry.name === role);
  }, [foundation, role]);

  const filteredMilestones = useMemo(() => {
    if (!foundation) {
      return [];
    }
    const query = search.trim().toLowerCase();
    return foundation.milestones.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        item.title.toLowerCase().includes(query) ||
        item.summary.toLowerCase().includes(query) ||
        `m${String(item.number).padStart(2, '0')}`.includes(query) ||
        String(item.number).includes(query)
      );
    });
  }, [foundation, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMilestones.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedMilestones = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredMilestones.slice(start, start + pageSize);
  }, [filteredMilestones, safePage, pageSize]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusFilterChange = (nextFilter: MilestoneFilter) => {
    setStatusFilter(nextFilter);
    setPage(1);
  };

  const milestoneStats = useMemo(() => {
    const list = foundation?.milestones ?? [];
    const completed = list.filter((m) => m.status === 'completed').length;
    const active = list.filter((m) => m.status === 'in_progress').length;
    const planned = list.filter((m) => m.status === 'pending').length;
    return { total: list.length || 12, completed, active, planned };
  }, [foundation]);

  const milestoneColumns: Array<TableColumn<MilestoneItem>> = [
    {
      key: 'number',
      header: 'Milestone',
      render: (item) => (
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
            item.status === 'in_progress'
              ? 'bg-[#12345A] text-white'
              : item.status === 'completed'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-[#F4F6FA] text-[#64748B]'
          }`}
        >
          M{String(item.number).padStart(2, '0')}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Phase',
      render: (item) => (
        <span
          className={
            item.status === 'in_progress'
              ? 'font-semibold text-[#12345A]'
              : 'font-medium text-[#1E293B]'
          }
        >
          {item.title}
        </span>
      ),
    },
    {
      key: 'summary',
      header: 'Planned Deliverables',
      render: (item) => <span className="text-[#64748B]">{item.summary}</span>,
    },
    {
      key: 'completion',
      header: 'Completion',
      render: (item) => (
        <span className="text-xs text-[#64748B]">
          {item.status === 'completed'
            ? 'Verified & Approved'
            : item.status === 'in_progress'
              ? 'In Progress'
              : 'Not Started'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (item) => {
        if (item.status === 'completed') {
          return <StatusBadge tone="success" label="Completed" />;
        }
        if (item.status === 'in_progress') {
          return <StatusBadge tone="warning" label="In Progress" />;
        }
        return <StatusBadge tone="neutral" label="Planned" />;
      },
    },
  ];

  const welcomeCopy = ROLE_WELCOME[role];
  const formattedHealthTime = health?.timestamp
    ? new Date(health.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

  const dbStatus = foundation?.database.status;
  const dbBadge =
    dbStatus === 'connected'
      ? { tone: 'success' as const, label: 'Connected' }
      : dbStatus === 'unavailable'
        ? { tone: 'danger' as const, label: 'Unreachable' }
        : { tone: 'neutral' as const, label: 'Not Configured' };

  return (
    <div className="space-y-6">
      {/* Official Institutional Branding Banner */}
      <section className="rounded-lg border border-[#0B2340] bg-[#0B2340] p-5 text-white sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <CollegeLogo size="lg" />
            <div className="min-w-0">
              <p className="font-[var(--font-display)] text-base font-bold tracking-wide text-white sm:text-lg">
                LAPU-LAPU CITY COLLEGE
              </p>
              <p className="text-xs font-medium tracking-wider text-[#D6A63C] uppercase sm:text-sm">
                College of Technology
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <span className="inline-flex items-center rounded-md border border-[#D6A63C]/40 bg-[#12345A] px-3 py-1.5 text-xs font-semibold text-[#D6A63C] whitespace-nowrap">
              Milestone 2 · Database &amp; Auth Security
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={loading}
              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void fetchOverview()}
            >
              Refresh Status
            </Button>
          </div>
        </div>

        <div className="my-4 h-px w-full bg-[#D6A63C]/70" aria-hidden="true" />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-[var(--font-display)] text-xl font-bold tracking-tight text-white sm:text-2xl">
              CT-RSS MANAGEMENT SYSTEM
            </h1>
            <p className="mt-1 text-sm text-slate-200">
              Student Service Management Portal — Centralized platform for Recognized Student Service workflows, verified hours, and official reports.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Backend API connection error</p>
              <p className="mt-0.5 text-red-800">{error}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void fetchOverview()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Role Context Card (Authenticated account or DEV-only preview switcher) */}
      <Card>
        <CardHeader
          title={welcomeCopy.heading}
          description={
            user
              ? `Signed in as ${user.name} (${user.email}) · Active Role: ${user.primaryRole}`
              : `Unauthenticated Development Preview Scope: ${role}`
          }
          action={
            user ? (
              <StatusBadge tone="success" label={`Verified ${user.primaryRole}`} />
            ) : import.meta.env.DEV && onChangeDevRole ? (
              <div
                role="group"
                aria-label="Development preview role switcher"
                className="inline-flex flex-wrap rounded-lg bg-[#F4F6FA] p-1 border border-[#E2E8F0]"
              >
                {(['RSS Coordinator', 'Student', 'Section Representative'] as RoleName[]).map(
                  (item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onChangeDevRole(item)}
                      className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        role === item
                          ? 'bg-[#12345A] text-white'
                          : 'text-[#64748B] hover:text-[#1E293B]'
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
            ) : null
          }
        />
        <CardContent>
          <p className="text-sm leading-relaxed text-[#64748B]">
            {activeRoleSummary?.authoritySummary ?? welcomeCopy.subtitle}
          </p>
        </CardContent>
      </Card>

      {/* Six Clean Status Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Authentication &amp; RBAC
              </span>
              <ShieldCheck className="h-4 w-4 text-[#285680]" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-bold text-[#1E293B]">
                {user ? 'Session Active' : 'Unauthenticated Preview'}
              </p>
              <StatusBadge
                tone={user ? 'success' : 'warning'}
                label={user ? user.accountStatus : 'Dev Preview'}
              />
            </div>
            <p className="text-xs text-[#64748B]">
              HttpOnly Cookie + CSRF + Rate Limiting · 3 Approved Roles
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Frontend
              </span>
              <Layers className="h-4 w-4 text-[#285680]" aria-hidden="true" />
            </div>
            <p className="text-base font-bold text-[#1E293B]">React 19 · TypeScript</p>
            <p className="text-xs text-[#64748B]">
              Vite 8 · Tailwind CSS v4 · Responsive LLCC Portal
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Backend
              </span>
              <Server className="h-4 w-4 text-[#285680]" aria-hidden="true" />
            </div>
            <p className="text-base font-bold text-[#1E293B]">
              Express 4 · {foundation?.runtime.nodeVersion ?? 'Node.js 22'}
            </p>
            <p className="text-xs text-[#64748B]">
              Versioned REST API (<span className="font-mono">/api/v1</span>) · Auth &amp; RBAC Middleware
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Database Readiness
              </span>
              <Database className="h-4 w-4 text-[#285680]" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-bold text-[#1E293B] tabular-nums">
                PostgreSQL (
                {foundation?.database.actualTableCount !== null &&
                foundation?.database.actualTableCount !== undefined
                  ? `${foundation.database.actualTableCount}/${foundation.database.tableCountTarget}`
                  : `${foundation?.database.tableCountTarget ?? 28}`}{' '}
                Tables)
              </p>
              <StatusBadge tone={dbBadge.tone} label={dbBadge.label} />
            </div>
            <p className="text-xs text-[#64748B]">
              {foundation?.database.message ?? 'Checking PostgreSQL configuration...'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Current Milestone
              </span>
              <Milestone className="h-4 w-4 text-[#285680]" aria-hidden="true" />
            </div>
            <p className="text-base font-bold text-[#1E293B] tabular-nums">
              M02 of {milestoneStats.total} — Database &amp; Security
            </p>
            <p className="text-xs text-[#64748B] tabular-nums">
              {milestoneStats.completed} completed · {milestoneStats.active} in progress ·{' '}
              {milestoneStats.planned} planned
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                System Health
              </span>
              <Activity className="h-4 w-4 text-[#285680]" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-bold text-[#1E293B]">
                {loading ? 'Checking...' : health?.status === 'ok' ? 'API Operational' : 'Unavailable'}
              </p>
              <StatusBadge
                tone={health?.status === 'ok' ? 'success' : loading ? 'info' : 'danger'}
                label={health?.status === 'ok' ? 'HTTP 200' : loading ? 'Checking' : 'Error'}
              />
            </div>
            <p className="text-xs text-[#64748B] tabular-nums">
              Endpoint <span className="font-mono">/api/v1/health</span> · Checked {formattedHealthTime}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 12-Milestone Roadmap */}
      <div className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#1E293B]">
              12-Milestone Development Roadmap
            </h2>
            <p className="text-xs text-[#64748B]">
              Milestone-gated implementation schedule · Future milestones remain Not Started until prior milestone sign-off
            </p>
          </div>
          <div className="text-xs font-medium text-[#12345A] tabular-nums">
            Progress: {milestoneStats.completed}/{milestoneStats.total} Completed ({milestoneStats.active} Active)
          </div>
        </div>

        <DataTable
          columns={milestoneColumns}
          rows={paginatedMilestones}
          rowKey={(item) => String(item.number)}
          loading={loading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder="Search milestones by number, phase, or scope..."
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          toolbarExtra={
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Filter milestones by status"
                className="inline-flex flex-wrap rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-1"
              >
                {(
                  [
                    { id: 'all', label: `All (${milestoneStats.total})` },
                    { id: 'completed', label: `Done (${milestoneStats.completed})` },
                    { id: 'in_progress', label: `Active (${milestoneStats.active})` },
                    { id: 'pending', label: `Planned (${milestoneStats.planned})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleStatusFilterChange(tab.id)}
                    className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-[#12345A] text-white'
                        : 'text-[#64748B] hover:text-[#1E293B]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPageSize((prev) => (prev === 12 ? 6 : 12));
                  setPage(1);
                }}
                className="min-h-9 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#1E293B] hover:bg-[#F4F6FA] whitespace-nowrap cursor-pointer"
              >
                Show: {pageSize === 12 ? 'All 12' : '6 / page'}
              </button>
            </div>
          }
          emptyTitle="No matching milestones"
          emptyDescription="No milestones matched your current search or filter selection."
          emptyAction={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setPage(1);
              }}
            >
              Reset Filters
            </Button>
          }
        />
      </div>
    </div>
  );
}
