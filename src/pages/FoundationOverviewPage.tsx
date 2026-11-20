import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  Bell,
  CheckSquare,
  ClipboardList,
  Clock,
  Database,
  FileBarChart2,
  Milestone,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { apiGet } from '../services/apiClient.ts';
import type {
  AuthenticatedUser,
  DashboardSummaryResponse,
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
  onNavigate?: (pageId: string) => void;
}

type MilestoneFilter = 'all' | 'completed' | 'in_progress' | 'pending';

const ROLE_WELCOME: Record<RoleName, { heading: string; subtitle: string }> = {
  'RSS Coordinator': {
    heading: 'Coordinator Workspace',
    subtitle:
      'Primary operational authority for registrations, academic structure, task publication, application approvals, attendance verification, accomplishment reviews, and official RSS PDF reports.',
  },
  Student: {
    heading: 'Student Service Portal',
    subtitle:
      'Personal workspace for eligible RSS task discovery, applications, verified service-hour tracking, versioned accomplishment submissions, and authorized individual reports.',
  },
  'Section Representative': {
    heading: 'Section Representative Portal (Read-Only)',
    subtitle:
      'Limited read-only overview scoped strictly to authorized section information, tasks, and permitted aggregate participation summaries without private student details or approval privileges.',
  },
};

export function FoundationOverviewPage({
  user,
  role,
  onChangeDevRole,
  onNavigate,
}: FoundationOverviewPageProps) {
  const [foundation, setFoundation] = useState<FoundationSnapshot | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MilestoneFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 12>(6);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [foundationData, healthData, dashData] = await Promise.all([
        apiGet<FoundationSnapshot>('/api/v1/system/foundation'),
        apiGet<HealthSnapshot>('/api/v1/health'),
        user
          ? apiGet<DashboardSummaryResponse>('/api/v1/dashboard/summary').catch(() => null)
          : Promise.resolve(null),
      ]);
      setFoundation(foundationData);
      setHealth(healthData);
      setDashboardSummary(dashData);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load system dashboard metadata from the backend API.',
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

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
      header: 'Deliverables',
      render: (item) => <span className="text-[#64748B]">{item.summary}</span>,
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

  const coord = dashboardSummary?.coordinator;
  const stu = dashboardSummary?.student;
  const rep = dashboardSummary?.sectionRepresentative;

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
              Modules 1–11 Operational · Live DB
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={loading}
              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void fetchOverview()}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="my-4 h-px w-full bg-[#D6A63C]/70" aria-hidden="true" />

        <div>
          <h1 className="font-[var(--font-display)] text-xl font-bold tracking-tight text-white sm:text-2xl">
            CT-RSS MANAGEMENT SYSTEM
          </h1>
          <p className="mt-1 text-sm text-slate-200">
            Student Service Management Portal — Centralized platform for Recognized Student Service tasks, verified service hours, accomplishments, and official reports.
          </p>
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

      {/* Role Context Card */}
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

      {/* Role-Specific Live Database Operational Metrics (Module 10) */}
      {coord ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Pending Approvals</span>
                <UserCheck className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {coord.pendingRegistrations} / {coord.pendingApplications}
              </p>
              <p className="text-xs text-[#64748B]">
                Registrations / Task Applications awaiting review
              </p>
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate(coord.pendingRegistrations > 0 ? 'registrations' : 'applications')}
                  className="text-xs font-medium text-[#12345A] hover:underline cursor-pointer"
                >
                  Open Review Queue →
                </button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Active Participation</span>
                <Users className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {coord.activeStudents} · {coord.publishedTasks}
              </p>
              <p className="text-xs text-[#64748B]">
                Approved active students · Published/ongoing tasks
              </p>
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate('tasks-activities')}
                  className="text-xs font-medium text-[#12345A] hover:underline cursor-pointer"
                >
                  Manage Tasks →
                </button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Service Hours &amp; Queues</span>
                <Clock className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {coord.totalCreditedServiceHours.toFixed(2)} hrs
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {coord.pendingAttendanceVerifications} attendance · {coord.pendingHourAdjustments} adjustment(s) pending
              </p>
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate('service-hours')}
                  className="text-xs font-medium text-[#12345A] hover:underline cursor-pointer"
                >
                  Open Service Hours →
                </button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Accomplishments &amp; Reports</span>
                <FileBarChart2 className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {coord.pendingAccomplishmentReviews} / {coord.generatedReportsCount}
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                Submitted reviews · Generated PDFs ({coord.unreadNotifications} unread alerts)
              </p>
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate('accomplishments')}
                  className="text-xs font-medium text-[#12345A] hover:underline cursor-pointer"
                >
                  Review Accomplishments →
                </button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {stu ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Verified Service Hours</span>
                <Clock className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {stu.verifiedServiceHours.toFixed(2)} hrs
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                Pending verification: {stu.pendingServiceHours.toFixed(2)} hrs
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Tasks &amp; Applications</span>
                <CheckSquare className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {stu.myApprovedApplications} / {stu.eligiblePublishedTasks}
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                Approved tasks · Eligible open ({stu.myPendingApplications} pending)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Accomplishments</span>
                <Award className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {stu.approvedAccomplishments} Approved
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {stu.draftOrRevisionAccomplishments} draft or revision needed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Reports &amp; Alerts</span>
                <Bell className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {stu.availableIndividualReports} PDFs
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {stu.unreadNotifications} unread notifications
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {rep ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Assigned Section</span>
                <Users className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="text-base font-bold text-[#0B2340]">
                {rep.assignedSectionLabel ?? 'Not Assigned'}
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {rep.enrolledStudentCount} enrolled students · {rep.academicYearName ?? 'No AY'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Visible Tasks</span>
                <ClipboardList className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {rep.visiblePublishedTasksCount}
              </p>
              <p className="text-xs text-[#64748B]">Published tasks for your section</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Section Aggregate Hours</span>
                <Clock className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {rep.sectionTotalCreditedHours.toFixed(2)} hrs
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {rep.sectionApprovedParticipations} approved participations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">Authorized Reports</span>
                <FileBarChart2 className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {rep.authorizedSectionReportsCount} PDFs
              </p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {rep.unreadNotifications} unread notifications
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* System Infrastructure & Readiness Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                System Health &amp; Build
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
              <Milestone className="mr-1 inline h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
              {milestoneStats.completed}/{milestoneStats.total} Milestones Completed · Checked {formattedHealthTime}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 12-Milestone Roadmap */}
      <div className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#1E293B]">
              12-Milestone Implementation Status
            </h2>
            <p className="text-xs text-[#64748B]">
              End-to-end CT-RSS modules backed by the 28-table PostgreSQL schema
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
          onSearchChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
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
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setStatusFilter(tab.id);
                      setPage(1);
                    }}
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
