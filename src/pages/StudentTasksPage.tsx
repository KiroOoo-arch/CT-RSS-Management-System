import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Info,
  MapPin,
  RefreshCw,
  Send,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPost } from '../services/apiClient.ts';
import type {
  StudentTaskDetailRecord,
  StudentTaskRecord,
  TaskCategoryRecord,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, SelectInput, TextareaInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface StudentTasksPageProps {
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

function renderApplicationBadge(status: string | null) {
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
      return <StatusBadge tone="neutral" label="Cancelled" />;
    default:
      return <StatusBadge tone="info" label="Not Applied" />;
  }
}

export function StudentTasksPage({
  isAuthenticated,
  onReturnToOverview,
}: StudentTasksPageProps) {
  const [tasks, setTasks] = useState<StudentTaskRecord[]>([]);
  const [categories, setCategories] = useState<TaskCategoryRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<StudentTaskDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [applicationMessage, setApplicationMessage] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setTasks([]);
      setCategories([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (categoryFilter !== 'all') {
        params.set('categoryId', categoryFilter);
      }
      const queryStr = params.toString();
      const res = await apiGet<{
        tasks: StudentTaskRecord[];
        categories: TaskCategoryRecord[];
      }>(`/api/v1/student/tasks${queryStr ? `?${queryStr}` : ''}`);
      setTasks(res.tasks);
      setCategories(res.categories);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load available RSS tasks from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, search, categoryFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openDetailModal = async (taskId: number) => {
    setSelectedTaskId(taskId);
    setTaskDetail(null);
    setDetailError(null);
    setApplyError(null);
    setApplicationMessage('');
    setDetailLoading(true);
    try {
      const res = await apiGet<{ task: StudentTaskDetailRecord }>(`/api/v1/student/tasks/${taskId}`);
      setTaskDetail(res.task);
    } catch (err) {
      setDetailError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load RSS task details and scheduled sessions.',
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApplyToTask = async () => {
    if (!taskDetail) {
      return;
    }
    setApplying(true);
    setApplyError(null);
    try {
      await apiPost(`/api/v1/student/tasks/${taskDetail.id}/apply`, {
        applicationMessage: applicationMessage.trim() || undefined,
      });
      setFeedback(`Application submitted for "${taskDetail.title}". You can track it in My Applications.`);
      await Promise.all([loadTasks(), openDetailModal(taskDetail.id)]);
    } catch (err) {
      setApplyError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to submit your task application.',
      );
    } finally {
      setApplying(false);
    }
  };

  const getApplyUnavailableReason = (task: StudentTaskDetailRecord): string | null => {
    if (task.myApplicationStatus === 'pending') {
      return 'Your application is already submitted and awaiting Coordinator review.';
    }
    if (task.myApplicationStatus === 'approved') {
      return 'Your application for this RSS task is already approved.';
    }
    if (task.myApplicationStatus === 'rejected') {
      return 'Your previous application for this task was rejected by the Coordinator.';
    }
    if (task.isFull) {
      return 'This RSS task has reached its maximum approved participant capacity.';
    }
    const now = Date.now();
    if (task.applicationStart && now < new Date(task.applicationStart).getTime()) {
      return `Applications open on ${formatDateTime(task.applicationStart)}.`;
    }
    if (task.applicationDeadline && now > new Date(task.applicationDeadline).getTime()) {
      return 'The application deadline for this RSS task has already passed.';
    }
    return null;
  };

  const canApply = (task: StudentTaskDetailRecord): boolean =>
    getApplyUnavailableReason(task) === null;

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return tasks.slice(start, start + pageSize);
  }, [tasks, safePage]);

  const columns: Array<TableColumn<StudentTaskRecord>> = [
    {
      key: 'title',
      header: 'Task & Category',
      render: (item) => (
        <div className="min-w-[200px]">
          <p className="font-semibold text-[#1E293B]">{item.title}</p>
          <p className="mt-0.5 text-xs text-[#64748B]">
            {item.categoryName} · {item.collegeCode}
            {item.location ? ` · ${item.location}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'eligibility',
      header: 'Eligibility',
      render: (item) => <span className="text-xs font-medium text-[#12345A]">{item.eligibilityReason}</span>,
    },
    {
      key: 'hours',
      header: 'Required Hours',
      render: (item) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {item.requiredHours !== null ? `${item.requiredHours.toFixed(2)} hrs` : 'Unspecified'}
        </span>
      ),
    },
    {
      key: 'deadline',
      header: 'Application Deadline',
      render: (item) => (
        <span className="text-xs text-[#64748B] tabular-nums">
          {formatDateTime(item.applicationDeadline)}
        </span>
      ),
    },
    {
      key: 'capacity',
      header: 'Slots',
      render: (item) => {
        if (item.capacity === null) {
          return <StatusBadge tone="info" label="Unlimited" />;
        }
        if (item.isFull) {
          return <StatusBadge tone="danger" label={`Full (0/${item.capacity})`} />;
        }
        return (
          <StatusBadge
            tone="success"
            label={`${item.remainingCapacity} of ${item.capacity} left`}
          />
        );
      },
    },
    {
      key: 'myStatus',
      header: 'My Application',
      render: (item) => renderApplicationBadge(item.myApplicationStatus),
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
          View &amp; Apply
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'Student', 'Available Tasks']}
        title="Available RSS Tasks"
        description="Published Recognized Student Service activities filtered by your college, current section, and individual eligibility."
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadTasks()}
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
              <p className="font-semibold">Authenticated Student Session Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Sign in with an approved Student account to browse published RSS tasks eligible for your section and submit applications.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Only <strong className="text-[#1E293B]">published</strong> tasks matching your eligibility are shown. Open any task to inspect scheduled sessions and submit your application.
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
        rows={paginatedRows}
        rowKey={(row) => String(row.id)}
        loading={loading}
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Search eligible tasks by title, category, or location..."
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <SelectInput
            aria-label="Filter by task category"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-[180px]"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={String(cat.id)}>
                {cat.name}
              </option>
            ))}
          </SelectInput>
        }
        emptyTitle="No eligible RSS tasks available"
        emptyDescription={
          isAuthenticated
            ? 'No published RSS tasks currently match your college, section, or individual targeting criteria.'
            : 'Eligible RSS tasks will load once an approved student signs in.'
        }
      />

      <Modal
        open={selectedTaskId !== null}
        onClose={() => {
          setSelectedTaskId(null);
          setTaskDetail(null);
        }}
        size="lg"
        title={taskDetail ? taskDetail.title : 'RSS Task Details'}
        description={
          taskDetail
            ? `${taskDetail.categoryName} · ${taskDetail.collegeName} (${taskDetail.collegeCode})`
            : undefined
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <span className="text-xs text-[#64748B]">
              {taskDetail
                ? `Current Application Status: ${taskDetail.myApplicationStatus ?? 'Not Applied'}`
                : ''}
            </span>
            <div className="flex items-center gap-2">
              {taskDetail && canApply(taskDetail) ? (
                <Button
                  variant="primary"
                  size="sm"
                  loading={applying}
                  icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => void handleApplyToTask()}
                >
                  Submit Application
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedTaskId(null);
                  setTaskDetail(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        }
      >
        {detailLoading ? (
          <p className="py-8 text-center text-sm text-[#64748B]">Loading task details and schedule...</p>
        ) : detailError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
          >
            {detailError}
          </div>
        ) : taskDetail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success" label="Published" />
              <StatusBadge tone="info" label={taskDetail.eligibilityReason} />
              {renderApplicationBadge(taskDetail.myApplicationStatus)}
              {taskDetail.capacity === null ? (
                <StatusBadge tone="neutral" label="Unlimited Slots" />
              ) : taskDetail.isFull ? (
                <StatusBadge tone="danger" label={`Full (0 of ${taskDetail.capacity} left)`} />
              ) : (
                <StatusBadge
                  tone="success"
                  label={`${taskDetail.remainingCapacity} of ${taskDetail.capacity} slots remaining`}
                />
              )}
            </div>

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-4 space-y-2">
              <p className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Task Description
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[#1E293B]">
                {taskDetail.description}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Location</p>
                <p className="flex items-center gap-1.5 text-sm font-medium text-[#1E293B]">
                  <MapPin className="h-3.5 w-3.5 text-[#12345A] shrink-0" aria-hidden="true" />
                  <span>{taskDetail.location ?? 'To be announced'}</span>
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Required Service Hours</p>
                <p className="flex items-center gap-1.5 text-sm font-medium text-[#1E293B] tabular-nums">
                  <Clock className="h-3.5 w-3.5 text-[#12345A] shrink-0" aria-hidden="true" />
                  <span>
                    {taskDetail.requiredHours !== null
                      ? `${taskDetail.requiredHours.toFixed(2)} hours`
                      : 'Not specified'}
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Application Window</p>
                <p className="text-xs text-[#1E293B] tabular-nums">
                  Opens: {formatDateTime(taskDetail.applicationStart)}
                </p>
                <p className="text-xs font-medium text-[#12345A] tabular-nums">
                  Deadline: {formatDateTime(taskDetail.applicationDeadline)}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-1">
                <p className="font-semibold text-[#64748B]">Activity Window</p>
                <p className="text-xs text-[#1E293B] tabular-nums">
                  Starts: {formatDateTime(taskDetail.activityStart)}
                </p>
                <p className="text-xs text-[#1E293B] tabular-nums">
                  Ends: {formatDateTime(taskDetail.activityEnd)}
                </p>
              </div>
            </div>

            {canApply(taskDetail) ? (
              <div className="rounded-lg border border-[#E2E8F0] p-4 space-y-3">
                <p className="text-xs font-semibold tracking-wide text-[#12345A] uppercase">
                  Submit Task Application
                </p>
                {applyError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
                  >
                    {applyError}
                  </div>
                ) : null}
                <FormField
                  id="student-application-message"
                  label="Application Message (Optional)"
                  hint="Add availability notes or relevant skills for the RSS Coordinator."
                >
                  <TextareaInput
                    id="student-application-message"
                    rows={3}
                    value={applicationMessage}
                    onChange={(e) => setApplicationMessage(e.target.value)}
                    placeholder="Optional note regarding your availability or interest..."
                  />
                </FormField>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-3.5 py-3 text-xs text-[#64748B]">
                <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
                <span>{getApplyUnavailableReason(taskDetail)}</span>
              </div>
            )}

            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-[#1E293B]">
                Scheduled Sessions ({taskDetail.sessions.length})
              </h3>

              {taskDetail.sessions.length === 0 ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-5 text-center text-xs text-[#64748B]">
                  No specific task sessions have been scheduled yet.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {taskDetail.sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-col gap-1.5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-[#1E293B]">{session.sessionTitle}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748B]">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
                            {session.sessionDate}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                            <Clock className="h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
                            {session.startTime} – {session.endTime}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
                            {session.location}
                          </span>
                        </p>
                      </div>
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
