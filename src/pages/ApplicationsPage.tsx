import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Info,
  RefreshCw,
  ShieldAlert,
  Undo2,
  XCircle,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPost } from '../services/apiClient.ts';
import type {
  AcademicYearRecord,
  ApplicationListResponse,
  ApplicationStatus,
  SectionRecord,
  TaskApplicationDetailRecord,
  TaskApplicationRecord,
  TaskListResponse,
  TaskRecord,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, SelectInput, TextareaInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface ApplicationsPageProps {
  mode: 'coordinator' | 'student';
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
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

function renderStatusBadge(status: ApplicationStatus) {
  switch (status) {
    case 'approved':
      return <StatusBadge tone="success" label="Approved" />;
    case 'pending':
      return <StatusBadge tone="warning" label="Pending Review" />;
    case 'rejected':
      return <StatusBadge tone="danger" label="Rejected" />;
    case 'withdrawn':
      return <StatusBadge tone="neutral" label="Withdrawn" />;
    case 'cancelled':
      return <StatusBadge tone="orange" label="Cancelled" />;
    default:
      return <StatusBadge tone="neutral" label={status} />;
  }
}

export function ApplicationsPage({
  mode,
  isAuthenticated,
  onReturnToOverview,
}: ApplicationsPageProps) {
  const isCoordinator = mode === 'coordinator';

  const [applications, setApplications] = useState<TaskApplicationRecord[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');
  const [taskFilter, setTaskFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [ayFilter, setAyFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Coordinator dropdown metadata
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);

  // Detail modal
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TaskApplicationDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Decision / withdraw form
  const [remarks, setRemarks] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCoordinatorMetadata = useCallback(async () => {
    if (!isAuthenticated || !isCoordinator) {
      return;
    }
    try {
      const [tasksRes, sectionsRes, ayRes] = await Promise.all([
        apiGet<TaskListResponse>('/api/v1/coordinator/tasks?page=1&pageSize=100'),
        apiGet<{ sections: SectionRecord[] }>('/api/v1/coordinator/sections'),
        apiGet<{ academicYears: AcademicYearRecord[] }>('/api/v1/coordinator/academic-years'),
      ]);
      setTasks(tasksRes.tasks);
      setSections(sectionsRes.sections);
      setAcademicYears(ayRes.academicYears);
    } catch {
      // Optional metadata; primary queue surfaces its own error
    }
  }, [isAuthenticated, isCoordinator]);

  const loadApplications = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setApplications([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isCoordinator) {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', '15');
        if (search.trim()) {
          params.set('search', search.trim());
        }
        if (statusFilter !== 'all') {
          params.set('status', statusFilter);
        }
        if (taskFilter !== 'all') {
          params.set('taskId', taskFilter);
        }
        if (sectionFilter !== 'all') {
          params.set('sectionId', sectionFilter);
        }
        if (ayFilter !== 'all') {
          params.set('academicYearId', ayFilter);
        }

        const res = await apiGet<ApplicationListResponse>(
          `/api/v1/coordinator/applications?${params.toString()}`,
        );
        setApplications(res.applications);
        setTotalPages(Math.max(1, res.totalPages));
        setTotalCount(res.total);
      } else {
        const params = new URLSearchParams();
        if (statusFilter !== 'all') {
          params.set('status', statusFilter);
        }
        const qs = params.toString();
        const res = await apiGet<{ applications: TaskApplicationRecord[] }>(
          `/api/v1/student/applications${qs ? `?${qs}` : ''}`,
        );
        const queryLower = search.trim().toLowerCase();
        const filtered = queryLower
          ? res.applications.filter(
              (a) =>
                a.taskTitle.toLowerCase().includes(queryLower) ||
                a.categoryName.toLowerCase().includes(queryLower),
            )
          : res.applications;
        setApplications(filtered);
        setTotalPages(1);
        setTotalCount(filtered.length);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load task applications from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    isAuthenticated,
    isCoordinator,
    page,
    search,
    statusFilter,
    taskFilter,
    sectionFilter,
    ayFilter,
  ]);

  useEffect(() => {
    void loadCoordinatorMetadata();
  }, [loadCoordinatorMetadata]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const openDetailModal = async (applicationId: number) => {
    setSelectedAppId(applicationId);
    setDetail(null);
    setDetailError(null);
    setActionError(null);
    setRemarks('');
    setDetailLoading(true);
    try {
      const endpoint = isCoordinator
        ? `/api/v1/coordinator/applications/${applicationId}`
        : `/api/v1/student/applications/${applicationId}`;
      const res = await apiGet<{ application: TaskApplicationDetailRecord }>(endpoint);
      setDetail(res.application);
    } catch (err) {
      setDetailError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load application details and review history.',
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCoordinatorDecision = async (decision: 'approved' | 'rejected') => {
    if (!detail) {
      return;
    }
    if (decision === 'rejected' && !remarks.trim()) {
      setActionError('Rejection remarks are required so the student understands the decision.');
      return;
    }
    setSubmittingAction(true);
    setActionError(null);
    try {
      await apiPost(`/api/v1/coordinator/applications/${detail.id}/decision`, {
        decision,
        remarks: remarks.trim() || undefined,
      });
      setFeedback(
        `Application #${detail.id} (${detail.studentName} — ${detail.taskTitle}) marked ${decision}.`,
      );
      await Promise.all([loadApplications(), openDetailModal(detail.id)]);
    } catch (err) {
      setActionError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to record application decision.',
      );
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleStudentWithdraw = async () => {
    if (!detail) {
      return;
    }
    setSubmittingAction(true);
    setActionError(null);
    try {
      const res = await apiPost<{ application: TaskApplicationDetailRecord }>(
        `/api/v1/student/applications/${detail.id}/withdraw`,
        {
          reason: remarks.trim() || undefined,
        },
      );
      setFeedback(
        `Application for "${detail.taskTitle}" updated to ${res.application.status}.`,
      );
      await Promise.all([loadApplications(), openDetailModal(detail.id)]);
    } catch (err) {
      setActionError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to withdraw or cancel this application.',
      );
    } finally {
      setSubmittingAction(false);
    }
  };

  const columns: Array<TableColumn<TaskApplicationRecord>> = isCoordinator
    ? [
        {
          key: 'student',
          header: 'Student',
          render: (item) => (
            <div className="min-w-[180px]">
              <p className="font-semibold text-[#1E293B]">{item.studentName}</p>
              <p className="font-mono text-xs text-[#64748B] tabular-nums">
                {item.studentNumber} · {item.sectionLabel ?? 'Unassigned Section'}
              </p>
            </div>
          ),
        },
        {
          key: 'task',
          header: 'Task & Capacity',
          render: (item) => (
            <div className="min-w-[200px]">
              <p className="font-medium text-[#1E293B]">{item.taskTitle}</p>
              <p className="text-xs text-[#64748B] tabular-nums">
                {item.categoryName} · Approved{' '}
                {item.taskCapacity !== null
                  ? `${item.taskApprovedCount}/${item.taskCapacity}`
                  : `${item.taskApprovedCount} (Unlimited)`}
              </p>
            </div>
          ),
        },
        {
          key: 'appliedAt',
          header: 'Applied',
          render: (item) => (
            <span className="text-xs text-[#64748B] tabular-nums">
              {formatDateTime(item.appliedAt)}
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (item) => renderStatusBadge(item.status),
        },
        {
          key: 'action',
          header: 'Action',
          align: 'right',
          render: (item) => (
            <Button
              variant="secondary"
              size="sm"
              icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void openDetailModal(item.id)}
            >
              {item.status === 'pending' ? 'Review' : 'Inspect'}
            </Button>
          ),
        },
      ]
    : [
        {
          key: 'task',
          header: 'RSS Task',
          render: (item) => (
            <div className="min-w-[210px]">
              <p className="font-semibold text-[#1E293B]">{item.taskTitle}</p>
              <p className="text-xs text-[#64748B]">
                {item.categoryName} ·{' '}
                {item.taskRequiredHours !== null
                  ? `${item.taskRequiredHours.toFixed(2)} hrs required`
                  : 'Hours unspecified'}
              </p>
            </div>
          ),
        },
        {
          key: 'appliedAt',
          header: 'Submitted',
          render: (item) => (
            <span className="text-xs text-[#64748B] tabular-nums">
              {formatDateTime(item.appliedAt)}
            </span>
          ),
        },
        {
          key: 'remarks',
          header: 'Coordinator Remarks',
          render: (item) => (
            <span className="text-xs text-[#64748B] line-clamp-2 max-w-xs">
              {item.latestRemarks ?? '—'}
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (item) => renderStatusBadge(item.status),
        },
        {
          key: 'action',
          header: 'Action',
          align: 'right',
          render: (item) => (
            <Button
              variant="secondary"
              size="sm"
              icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void openDetailModal(item.id)}
            >
              Details
            </Button>
          ),
        },
      ];

  const canStudentWithdraw =
    detail !== null &&
    (detail.status === 'pending' ||
      (detail.status === 'approved' &&
        detail.verifiedAttendanceCount === 0 &&
        !detail.hasSubmittedAccomplishment));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          'Lapu-Lapu City College',
          isCoordinator ? 'RSS Operations' : 'RSS Participation',
          isCoordinator ? 'Applications' : 'My Applications',
        ]}
        title={isCoordinator ? 'Task Applications Review Queue' : 'My Task Applications'}
        description={
          isCoordinator
            ? 'Review student task applications with transactional capacity enforcement and full review history.'
            : 'Track pending, approved, rejected, withdrawn, or cancelled RSS task applications.'
        }
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadApplications()}
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
                Sign in with an active {isCoordinator ? 'RSS Coordinator' : 'Student'} account to view and manage task applications.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Supported statuses in PostgreSQL: <strong className="text-[#1E293B]">pending</strong>,{' '}
          <strong className="text-[#1E293B]">approved</strong>,{' '}
          <strong className="text-[#1E293B]">rejected</strong>,{' '}
          <strong className="text-[#1E293B]">withdrawn</strong>, and{' '}
          <strong className="text-[#1E293B]">cancelled</strong>.{' '}
          {isCoordinator
            ? 'Approving an application locks the task row to prevent exceeding participant capacity.'
            : 'Pending applications can be withdrawn; approved applications without verified attendance or accomplishments can be cancelled.'}
        </span>
      </div>

      {feedback ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{feedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-medium text-emerald-800 hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
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

      <DataTable
        columns={columns}
        rows={applications}
        rowKey={(row) => String(row.id)}
        loading={loading}
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder={
          isCoordinator
            ? 'Search by student name, student #, or task...'
            : 'Search your applications by task or category...'
        }
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput
              aria-label="Filter by application status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | ApplicationStatus);
                setPage(1);
              }}
              className="w-auto min-w-[150px]"
            >
              <option value="all">All Statuses ({totalCount})</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="cancelled">Cancelled</option>
            </SelectInput>

            {isCoordinator ? (
              <>
                <SelectInput
                  aria-label="Filter by task"
                  value={taskFilter}
                  onChange={(e) => {
                    setTaskFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-auto min-w-[160px] max-w-[220px]"
                >
                  <option value="all">All Tasks</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.title}
                    </option>
                  ))}
                </SelectInput>

                <SelectInput
                  aria-label="Filter by section"
                  value={sectionFilter}
                  onChange={(e) => {
                    setSectionFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-auto min-w-[140px]"
                >
                  <option value="all">All Sections</option>
                  {sections.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.programCode} {s.yearLevelName} {s.name}
                    </option>
                  ))}
                </SelectInput>

                <SelectInput
                  aria-label="Filter by academic year"
                  value={ayFilter}
                  onChange={(e) => {
                    setAyFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-auto min-w-[140px]"
                >
                  <option value="all">All Academic Years</option>
                  {academicYears.map((ay) => (
                    <option key={ay.id} value={String(ay.id)}>
                      {ay.name}
                    </option>
                  ))}
                </SelectInput>
              </>
            ) : null}
          </div>
        }
        emptyTitle="No task applications found"
        emptyDescription={
          isCoordinator
            ? 'No student task applications matched your current search or filter criteria.'
            : 'Apply to an eligible published task under Available Tasks to track your application here.'
        }
      />

      <Modal
        open={selectedAppId !== null}
        onClose={() => {
          setSelectedAppId(null);
          setDetail(null);
        }}
        size="lg"
        title={detail ? `Application #${detail.id} — ${detail.taskTitle}` : 'Application Details'}
        description={
          detail
            ? `${detail.studentName} (${detail.studentNumber}) · ${detail.sectionLabel ?? 'Unassigned Section'}`
            : undefined
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="flex flex-wrap items-center gap-2">
              {isCoordinator && detail?.status === 'pending' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={submittingAction}
                    icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleCoordinatorDecision('approved')}
                  >
                    Approve Application
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={submittingAction}
                    icon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleCoordinatorDecision('rejected')}
                  >
                    Reject
                  </Button>
                </>
              ) : null}
              {!isCoordinator && canStudentWithdraw ? (
                <Button
                  variant="danger"
                  size="sm"
                  loading={submittingAction}
                  icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => void handleStudentWithdraw()}
                >
                  {detail?.status === 'pending' ? 'Withdraw Application' : 'Cancel Participation'}
                </Button>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelectedAppId(null);
                setDetail(null);
              }}
            >
              Close
            </Button>
          </div>
        }
      >
        {detailLoading ? (
          <p className="py-8 text-center text-sm text-[#64748B]">Loading application details...</p>
        ) : detailError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
          >
            {detailError}
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {renderStatusBadge(detail.status)}
              <StatusBadge tone="info" label={`Task: ${detail.taskStatus}`} />
              <StatusBadge
                tone="neutral"
                label={
                  detail.taskCapacity !== null
                    ? `Approved Slots: ${detail.taskApprovedCount}/${detail.taskCapacity}`
                    : `Approved Participants: ${detail.taskApprovedCount}`
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Applicant</p>
                <p className="text-sm font-medium text-[#1E293B]">{detail.studentName}</p>
                <p className="font-mono text-xs text-[#64748B] tabular-nums">
                  {detail.studentNumber} · {detail.studentEmail}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Academic Placement &amp; Dates</p>
                <p className="text-sm font-medium text-[#1E293B]">
                  {detail.sectionLabel ?? 'Unassigned Section'}
                </p>
                <p className="text-xs text-[#64748B] tabular-nums">
                  Applied: {formatDateTime(detail.appliedAt)}
                </p>
              </div>
            </div>

            {detail.applicationMessage ? (
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3.5 space-y-1">
                <p className="text-xs font-semibold text-[#64748B] uppercase">
                  Student Application Message
                </p>
                <p className="whitespace-pre-line text-sm text-[#1E293B]">
                  {detail.applicationMessage}
                </p>
              </div>
            ) : null}

            {(isCoordinator && detail.status === 'pending') || (!isCoordinator && canStudentWithdraw) ? (
              <div className="rounded-lg border border-[#E2E8F0] p-4 space-y-3">
                {actionError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
                  >
                    {actionError}
                  </div>
                ) : null}
                <FormField
                  id="application-action-remarks"
                  label={
                    isCoordinator
                      ? 'Coordinator Review Remarks (Required when rejecting)'
                      : 'Withdrawal / Cancellation Reason (Optional)'
                  }
                >
                  <TextareaInput
                    id="application-action-remarks"
                    rows={3}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder={
                      isCoordinator
                        ? 'Provide approval instructions or clear rejection reason...'
                        : 'Optional reason for withdrawing or cancelling participation...'
                    }
                  />
                </FormField>
              </div>
            ) : !isCoordinator && detail.status === 'approved' ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                <span>
                  This approved participation already has verified attendance ({detail.verifiedAttendanceCount}) or a submitted accomplishment and can no longer be cancelled by the student.
                </span>
              </div>
            ) : null}

            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-[#1E293B]">
                Review &amp; Decision History ({detail.reviews.length})
              </h3>
              {detail.reviews.length === 0 ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-4 text-center text-xs text-[#64748B]">
                  No Coordinator review entries recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {detail.reviews.map((rev) => (
                    <div key={rev.id} className="px-3.5 py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge
                          tone={rev.decision === 'approved' ? 'success' : 'danger'}
                          label={rev.decision === 'approved' ? 'Approved' : 'Rejected'}
                        />
                        <span className="text-xs text-[#64748B] tabular-nums">
                          {rev.reviewedByName} · {formatDateTime(rev.reviewedAt)}
                        </span>
                      </div>
                      {rev.remarks ? (
                        <p className="text-xs text-[#1E293B]">{rev.remarks}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
