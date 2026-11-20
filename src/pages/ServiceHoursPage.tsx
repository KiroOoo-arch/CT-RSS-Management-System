import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPost } from '../services/apiClient.ts';
import type {
  AcademicYearRecord,
  AdjustmentStatus,
  ServiceHourAdjustmentRecord,
  ServiceHourBreakdownTaskItem,
  ServiceHoursSummaryResponse,
  StudentServiceHoursLedgerItem,
  TaskApplicationRecord,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import {
  FormField,
  SelectInput,
  TextareaInput,
  TextInput,
} from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface ServiceHoursPageProps {
  mode: 'coordinator' | 'student';
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

function renderAdjustmentBadge(status: AdjustmentStatus) {
  switch (status) {
    case 'approved':
      return <StatusBadge tone="success" label="Approved" />;
    case 'rejected':
      return <StatusBadge tone="danger" label="Rejected" />;
    default:
      return <StatusBadge tone="warning" label="Pending Review" />;
  }
}

export function ServiceHoursPage({
  mode,
  isAuthenticated,
  onReturnToOverview,
}: ServiceHoursPageProps) {
  const isCoordinator = mode === 'coordinator';

  const [summary, setSummary] = useState<ServiceHoursSummaryResponse | null>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [approvedApplications, setApprovedApplications] = useState<TaskApplicationRecord[]>([]);
  const [ayFilter, setAyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Adjustment modal
  const [adjModalOpen, setAdjModalOpen] = useState(false);
  const [adjApplicationId, setAdjApplicationId] = useState('');
  const [adjHours, setAdjHours] = useState('1.0');
  const [adjReason, setAdjReason] = useState('');
  const [savingAdj, setSavingAdj] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setSummary(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (ayFilter !== 'all') {
        params.set('academicYearId', ayFilter);
      }
      if (isCoordinator && search.trim()) {
        params.set('search', search.trim());
      }
      const qs = params.toString();

      if (isCoordinator) {
        const [sumRes, ayRes, appsRes] = await Promise.all([
          apiGet<ServiceHoursSummaryResponse>(
            `/api/v1/coordinator/service-hours${qs ? `?${qs}` : ''}`,
          ),
          apiGet<{ academicYears: AcademicYearRecord[] }>('/api/v1/coordinator/academic-years'),
          apiGet<{ applications: TaskApplicationRecord[] }>(
            '/api/v1/coordinator/applications?status=approved&page=1&pageSize=100',
          ),
        ]);
        setSummary(sumRes);
        setAcademicYears(ayRes.academicYears);
        setApprovedApplications(appsRes.applications);
      } else {
        const [sumRes, appsRes] = await Promise.all([
          apiGet<ServiceHoursSummaryResponse>(
            `/api/v1/student/service-hours${qs ? `?${qs}` : ''}`,
          ),
          apiGet<{ applications: TaskApplicationRecord[] }>(
            '/api/v1/student/applications?status=approved',
          ),
        ]);
        setSummary(sumRes);
        setApprovedApplications(appsRes.applications);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load service-hour ledger from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoordinator, ayFilter, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openAdjustmentModal = () => {
    setAdjApplicationId(
      approvedApplications[0] ? String(approvedApplications[0].id) : '',
    );
    setAdjHours('1.0');
    setAdjReason('');
    setAdjError(null);
    setAdjModalOpen(true);
  };

  const handleSubmitAdjustment = async () => {
    if (!adjApplicationId) {
      setAdjError('Select an approved task application.');
      return;
    }
    const parsedHours = Number(adjHours);
    if (!Number.isFinite(parsedHours) || parsedHours === 0) {
      setAdjError('Adjustment hours must be a non-zero number.');
      return;
    }
    if (!isCoordinator && parsedHours <= 0) {
      setAdjError('Student adjustment requests must be greater than 0 hours.');
      return;
    }
    if (!adjReason.trim()) {
      setAdjError('Please provide a clear reason for this hour adjustment.');
      return;
    }

    setSavingAdj(true);
    setAdjError(null);
    try {
      const endpoint = isCoordinator
        ? '/api/v1/coordinator/service-hours/adjustments'
        : '/api/v1/student/service-hours/adjustments';
      await apiPost(endpoint, {
        applicationId: Number(adjApplicationId),
        adjustmentHours: parsedHours,
        reason: adjReason.trim(),
        ...(isCoordinator ? { autoApprove: true } : {}),
      });
      setFeedback(
        isCoordinator
          ? 'Service-hour adjustment applied and ledger recalculated.'
          : 'Service-hour adjustment request submitted for Coordinator approval.',
      );
      setAdjModalOpen(false);
      await loadData();
    } catch (err) {
      setAdjError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to submit service-hour adjustment.',
      );
    } finally {
      setSavingAdj(false);
    }
  };

  const handleAdjustmentDecision = async (
    adjustmentId: number,
    decision: 'approved' | 'rejected',
  ) => {
    setDecidingId(adjustmentId);
    setError(null);
    try {
      await apiPost(`/api/v1/coordinator/service-hours/adjustments/${adjustmentId}/decision`, {
        decision,
      });
      setFeedback(`Adjustment #${adjustmentId} ${decision}.`);
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to decide hour adjustment.',
      );
    } finally {
      setDecidingId(null);
    }
  };

  const studentLedger = summary?.ledger[0] ?? null;

  const ledgerColumns: Array<TableColumn<StudentServiceHoursLedgerItem>> = [
    {
      key: 'student',
      header: 'Student',
      render: (r) => (
        <div className="min-w-[170px]">
          <p className="font-semibold text-[#1E293B]">{r.studentName}</p>
          <p className="font-mono text-xs text-[#64748B] tabular-nums">
            {r.studentNumber} · {r.sectionLabel ?? 'Unassigned Section'}
          </p>
        </div>
      ),
    },
    {
      key: 'verifiedAtt',
      header: 'Verified Attendance',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.verifiedAttendanceHours.toFixed(2)}h ({r.verifiedSessionCount})
        </span>
      ),
    },
    {
      key: 'pendingAtt',
      header: 'Pending Att.',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-amber-800 tabular-nums">
          {r.pendingAttendanceHours.toFixed(2)}h ({r.pendingSessionCount})
        </span>
      ),
    },
    {
      key: 'adj',
      header: 'Approved Adj.',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.approvedAdjustmentHours >= 0 ? '+' : ''}
          {r.approvedAdjustmentHours.toFixed(2)}h
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total Credited',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-sm font-bold text-[#0B2340] tabular-nums">
          {r.totalCreditedHours.toFixed(2)} hrs
        </span>
      ),
    },
  ];

  const breakdownColumns: Array<TableColumn<ServiceHourBreakdownTaskItem>> = [
    {
      key: 'task',
      header: 'Task',
      render: (r) => (
        <div>
          <p className="font-semibold text-[#1E293B]">{r.taskTitle}</p>
          <p className="text-xs text-[#64748B]">{r.categoryName}</p>
        </div>
      ),
    },
    {
      key: 'req',
      header: 'Required',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#64748B] tabular-nums">
          {r.requiredHours !== null ? `${r.requiredHours.toFixed(2)}h` : '—'}
        </span>
      ),
    },
    {
      key: 'ver',
      header: 'Verified Att.',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.verifiedAttendanceHours.toFixed(2)}h
        </span>
      ),
    },
    {
      key: 'pend',
      header: 'Pending',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-amber-800 tabular-nums">
          {r.pendingAttendanceHours.toFixed(2)}h
        </span>
      ),
    },
    {
      key: 'adj',
      header: 'Adjustments',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.approvedAdjustmentHours >= 0 ? '+' : ''}
          {r.approvedAdjustmentHours.toFixed(2)}h
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Credited Total',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-sm font-bold text-[#0B2340] tabular-nums">
          {r.totalCreditedHours.toFixed(2)} hrs
        </span>
      ),
    },
  ];

  const adjustmentColumns: Array<TableColumn<ServiceHourAdjustmentRecord>> = [
    ...(isCoordinator
      ? [
          {
            key: 'student',
            header: 'Student',
            render: (r: ServiceHourAdjustmentRecord) => (
              <div>
                <p className="font-semibold text-[#1E293B]">{r.studentName}</p>
                <p className="font-mono text-xs text-[#64748B] tabular-nums">{r.studentNumber}</p>
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'task',
      header: 'Task & Reason',
      render: (r) => (
        <div className="min-w-[200px]">
          <p className="font-medium text-[#1E293B]">{r.taskTitle}</p>
          <p className="text-xs text-[#64748B]">{r.reason}</p>
        </div>
      ),
    },
    {
      key: 'hours',
      header: 'Adjustment',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-[#1E293B] tabular-nums">
          {r.adjustmentHours >= 0 ? '+' : ''}
          {r.adjustmentHours.toFixed(2)} hrs
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => renderAdjustmentBadge(r.status),
    },
    ...(isCoordinator
      ? [
          {
            key: 'action',
            header: 'Decision',
            align: 'right' as const,
            render: (r: ServiceHourAdjustmentRecord) =>
              r.status === 'pending' ? (
                <div className="inline-flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={decidingId === r.id}
                    onClick={() => void handleAdjustmentDecision(r.id, 'approved')}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={decidingId === r.id}
                    icon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleAdjustmentDecision(r.id, 'rejected')}
                  >
                    Reject
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-[#64748B]">{r.approvedByName ?? 'Reviewed'}</span>
              ),
          },
        ]
      : []),
  ];

  const totalLedgerCredited = (summary?.ledger ?? []).reduce(
    (acc, item) => acc + item.totalCreditedHours,
    0,
  );
  const totalLedgerPending = (summary?.ledger ?? []).reduce(
    (acc, item) => acc + item.pendingAttendanceHours,
    0,
  );
  const pendingAdjustmentsCount = (summary?.adjustments ?? []).filter(
    (a) => a.status === 'pending',
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          'Lapu-Lapu City College',
          isCoordinator ? 'RSS Operations' : 'RSS Participation',
          'Service Hours',
        ]}
        title={isCoordinator ? 'Service Hours Ledger & Adjustments' : 'My Official Service Hours'}
        description="Official credited service-hour totals computed as verified attendance hours plus approved Coordinator adjustments."
        actions={
          <>
            {isAuthenticated ? (
              <>
                <Button
                  variant="primary"
                  size="md"
                  disabled={approvedApplications.length === 0}
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={openAdjustmentModal}
                >
                  {isCoordinator ? 'Apply Adjustment' : 'Request Adjustment'}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={loading}
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void loadData()}
                >
                  Refresh
                </Button>
              </>
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
                Sign in to inspect verified service hours and manage hour-adjustment requests.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Formula: <strong className="text-[#1E293B]">Total Credited Hours = SUM(Verified Attendance) + SUM(Approved Adjustments)</strong>. Pending attendance and pending adjustment requests are tracked separately and never credited until approved.
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

      {isAuthenticated ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">
                  Total Credited
                </span>
                <Clock className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {(isCoordinator
                  ? totalLedgerCredited
                  : (studentLedger?.totalCreditedHours ?? 0)
                ).toFixed(2)}{' '}
                hrs
              </p>
              <p className="text-xs text-[#64748B]">Official verified + adjusted hours</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <span className="text-xs font-semibold text-[#64748B] uppercase">
                Verified Attendance
              </span>
              <p className="font-mono text-2xl font-bold text-emerald-800 tabular-nums">
                {(isCoordinator
                  ? (summary?.ledger ?? []).reduce((a, b) => a + b.verifiedAttendanceHours, 0)
                  : (studentLedger?.verifiedAttendanceHours ?? 0)
                ).toFixed(2)}{' '}
                hrs
              </p>
              <p className="text-xs text-[#64748B]">Confirmed session hours</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <span className="text-xs font-semibold text-[#64748B] uppercase">
                Pending Verification
              </span>
              <p className="font-mono text-2xl font-bold text-amber-800 tabular-nums">
                {(isCoordinator
                  ? totalLedgerPending
                  : (studentLedger?.pendingAttendanceHours ?? 0)
                ).toFixed(2)}{' '}
                hrs
              </p>
              <p className="text-xs text-[#64748B]">Not yet credited</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748B] uppercase">
                  Adjustments
                </span>
                <SlidersHorizontal className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                {pendingAdjustmentsCount} Pending
              </p>
              <p className="text-xs text-[#64748B]">
                {(summary?.adjustments ?? []).length} total adjustment record(s)
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {isCoordinator ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-[#1E293B]">Student Service Hours Ledger</h2>
          <DataTable
            columns={ledgerColumns}
            rows={summary?.ledger ?? []}
            rowKey={(r) => String(r.studentId)}
            loading={loading}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search student ledger by name or student number..."
            toolbarExtra={
              <SelectInput
                aria-label="Filter by academic year"
                value={ayFilter}
                onChange={(e) => setAyFilter(e.target.value)}
                className="w-auto min-w-[160px]"
              >
                <option value="all">All Academic Years</option>
                {academicYears.map((ay) => (
                  <option key={ay.id} value={String(ay.id)}>
                    {ay.name}
                  </option>
                ))}
              </SelectInput>
            }
            emptyTitle="No student service hours recorded yet"
            emptyDescription="Verified attendance entries or approved adjustments will compute student service totals here."
          />
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-[#1E293B]">Service Hours by Task</h2>
          <DataTable
            columns={breakdownColumns}
            rows={summary?.breakdown ?? []}
            rowKey={(r) => String(r.applicationId)}
            loading={loading}
            emptyTitle="No task service hours yet"
            emptyDescription="Your verified attendance and approved adjustments grouped by task will appear here."
          />
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-[#1E293B]">Service Hour Adjustments</h2>
        <DataTable
          columns={adjustmentColumns}
          rows={summary?.adjustments ?? []}
          rowKey={(r) => String(r.id)}
          loading={loading}
          emptyTitle="No service-hour adjustments recorded"
          emptyDescription="Coordinator adjustments and student hour-adjustment requests appear here."
        />
      </div>

      <Modal
        open={adjModalOpen}
        onClose={() => setAdjModalOpen(false)}
        title={isCoordinator ? 'Apply Service-Hour Adjustment' : 'Request Service-Hour Adjustment'}
        description={
          isCoordinator
            ? 'Credit bonus hours or apply a valid deduction (blocking negative total credited hours).'
            : 'Submit a positive service-hour adjustment request for Coordinator approval.'
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAdjModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={savingAdj}
              onClick={() => void handleSubmitAdjustment()}
            >
              {isCoordinator ? 'Apply Adjustment' : 'Submit Request'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {adjError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
            >
              {adjError}
            </div>
          ) : null}

          <FormField id="adj-app" label="Approved Task Participation" required>
            <SelectInput
              id="adj-app"
              value={adjApplicationId}
              onChange={(e) => setAdjApplicationId(e.target.value)}
            >
              {approvedApplications.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {isCoordinator ? `${a.studentName} (${a.studentNumber}) — ` : ''}
                  {a.taskTitle}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <FormField
            id="adj-hours"
            label="Adjustment Hours"
            hint={
              isCoordinator
                ? 'Positive or negative non-zero hours (cannot drive student total below 0).'
                : 'Must be a positive number of hours.'
            }
            required
          >
            <TextInput
              id="adj-hours"
              type="number"
              step="0.25"
              value={adjHours}
              onChange={(e) => setAdjHours(e.target.value)}
            />
          </FormField>

          <FormField id="adj-reason" label="Reason / Justification" required>
            <TextareaInput
              id="adj-reason"
              rows={3}
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Describe the documented reason for this service-hour adjustment..."
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
