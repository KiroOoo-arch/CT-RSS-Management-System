import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Edit3,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type { AcademicYearPeriodStatus, AcademicYearRecord } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, TextInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface AcademicYearsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

type PeriodFilter = 'all' | AcademicYearPeriodStatus;

interface AcademicYearFormState {
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

const EMPTY_FORM: AcademicYearFormState = {
  name: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
};

function renderPeriodBadge(status: AcademicYearPeriodStatus) {
  switch (status) {
    case 'current':
      return <StatusBadge tone="success" label="Current" />;
    case 'upcoming':
      return <StatusBadge tone="info" label="Upcoming" />;
    case 'past':
      return <StatusBadge tone="neutral" label="Past" />;
    default:
      return <StatusBadge tone="warning" label="Inactive" />;
  }
}

export function AcademicYearsPage({
  isAuthenticated,
  onReturnToOverview,
}: AcademicYearsPageProps) {
  const [rows, setRows] = useState<AcademicYearRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AcademicYearRecord | null>(null);
  const [form, setForm] = useState<AcademicYearFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(false);

  const [confirmCurrentRow, setConfirmCurrentRow] = useState<AcademicYearRecord | null>(null);
  const [settingCurrent, setSettingCurrent] = useState(false);

  const loadAcademicYears = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ academicYears: AcademicYearRecord[] }>(
        '/api/v1/coordinator/academic-years',
      );
      setRows(res.academicYears);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load academic years from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadAcademicYears();
  }, [loadAcademicYears]);

  const currentAcademicYear = useMemo(
    () => rows.find((item) => item.isCurrent) ?? null,
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((item) => {
      if (periodFilter !== 'all' && item.periodStatus !== periodFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        item.name.toLowerCase().includes(query) ||
        item.startDate.includes(query) ||
        item.endDate.includes(query)
      );
    });
  }, [rows, search, periodFilter]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage]);

  const openCreateModal = () => {
    setEditingRow(null);
    setForm({
      ...EMPTY_FORM,
      isCurrent: rows.length === 0,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (row: AcademicYearRecord) => {
    setEditingRow(row);
    setForm({
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      isCurrent: row.isCurrent,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const trimmedName = form.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 20) {
      setFormError('Academic year name must be 2–20 characters (e.g. 2026-2027).');
      return;
    }
    if (!form.startDate || !form.endDate) {
      setFormError('Both start date and end date are required.');
      return;
    }
    if (form.endDate <= form.startDate) {
      setFormError('Academic year end date must be strictly after the start date.');
      return;
    }

    setSavingForm(true);
    try {
      if (editingRow) {
        await apiPatch<{ academicYear: AcademicYearRecord }>(
          `/api/v1/coordinator/academic-years/${editingRow.id}`,
          {
            name: trimmedName,
            startDate: form.startDate,
            endDate: form.endDate,
            isCurrent: form.isCurrent,
          },
        );
        setSuccessMessage(`Academic year "${trimmedName}" updated successfully.`);
      } else {
        await apiPost<{ academicYear: AcademicYearRecord }>(
          '/api/v1/coordinator/academic-years',
          {
            name: trimmedName,
            startDate: form.startDate,
            endDate: form.endDate,
            isCurrent: form.isCurrent,
          },
        );
        setSuccessMessage(`Academic year "${trimmedName}" created successfully.`);
      }
      setFormOpen(false);
      await loadAcademicYears();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to save academic year record.',
      );
    } finally {
      setSavingForm(false);
    }
  };

  const handleConfirmSetCurrent = async () => {
    if (!confirmCurrentRow) {
      return;
    }
    setSettingCurrent(true);
    setError(null);
    try {
      await apiPost<{ academicYear: AcademicYearRecord }>(
        `/api/v1/coordinator/academic-years/${confirmCurrentRow.id}/set-current`,
      );
      setSuccessMessage(
        `"${confirmCurrentRow.name}" is now designated as the active current academic year.`,
      );
      setConfirmCurrentRow(null);
      await loadAcademicYears();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update current academic year.',
      );
      setConfirmCurrentRow(null);
    } finally {
      setSettingCurrent(false);
    }
  };

  const columns: Array<TableColumn<AcademicYearRecord>> = [
    {
      key: 'name',
      header: 'Academic Year',
      render: (item) => (
        <div>
          <p className="font-semibold text-[#1E293B]">{item.name}</p>
          <p className="text-xs text-[#64748B]">
            {item.isCurrent ? 'Active institutional cycle' : 'Historical / scheduled cycle'}
          </p>
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Date Range',
      render: (item) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {item.startDate} to {item.endDate}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => renderPeriodBadge(item.periodStatus),
    },
    {
      key: 'records',
      header: 'Linked Records',
      render: (item) => (
        <span className="text-xs text-[#64748B] tabular-nums">
          {item.studentAssignmentCount} section assignments · {item.reportCount} reports
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (item) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openEditModal(item)}
          >
            Edit
          </Button>
          {!item.isCurrent ? (
            <Button
              variant="primary"
              size="sm"
              icon={<CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => setConfirmCurrentRow(item)}
            >
              Set Current
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'RSS Coordinator', 'Academic Years']}
        title="Academic Year Management"
        description="Define institutional academic cycles, validate date boundaries, and designate the single active current academic year."
        actions={
          <>
            {isAuthenticated ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  loading={loading}
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void loadAcademicYears()}
                >
                  Refresh
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={openCreateModal}
                >
                  New Academic Year
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
              <p className="font-semibold">Authenticated Coordinator Session Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Sign in as an RSS Coordinator with a connected PostgreSQL database to manage institutional academic years.
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

      {successMessage ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs font-medium text-emerald-800 underline hover:text-emerald-950 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
            Total Academic Years
          </p>
          <p className="mt-1 text-2xl font-bold text-[#12345A] tabular-nums">{rows.length}</p>
        </div>
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
            Active Current Cycle
          </p>
          <p className="mt-1 text-lg font-bold text-[#12345A]">
            {currentAcademicYear ? currentAcademicYear.name : 'None Designated'}
          </p>
          {currentAcademicYear ? (
            <p className="mt-0.5 font-mono text-xs text-[#64748B] tabular-nums">
              {currentAcademicYear.startDate} to {currentAcademicYear.endDate}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
            Upcoming / Historical Cycles
          </p>
          <p className="mt-1 text-2xl font-bold text-[#12345A] tabular-nums">
            {rows.filter((r) => !r.isCurrent).length}
          </p>
        </div>
      </div>

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
        searchPlaceholder="Search by academic year name or date..."
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <div
            role="group"
            aria-label="Filter academic years by status"
            className="inline-flex flex-wrap rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-1"
          >
            {(['all', 'current', 'upcoming', 'past', 'inactive'] as PeriodFilter[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setPeriodFilter(tab);
                  setPage(1);
                }}
                className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium capitalize whitespace-nowrap transition-colors cursor-pointer ${
                  periodFilter === tab
                    ? 'bg-[#12345A] text-white'
                    : 'text-[#64748B] hover:text-[#1E293B]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        }
        emptyTitle="No academic years recorded"
        emptyDescription={
          isAuthenticated
            ? 'Create the first academic year to enable student section assignments.'
            : 'Academic year records load once an RSS Coordinator signs in.'
        }
        emptyAction={
          isAuthenticated ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={openCreateModal}
            >
              Create Academic Year
            </Button>
          ) : undefined
        }
      />

      <Modal
        open={formOpen}
        onClose={() => {
          if (!savingForm) {
            setFormOpen(false);
          }
        }}
        title={editingRow ? `Edit Academic Year — ${editingRow.name}` : 'Create Academic Year'}
        description="Only one academic year may be marked as current at a time. Historical records remain preserved."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={savingForm}
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="academic-year-form"
              variant="primary"
              size="sm"
              loading={savingForm}
            >
              {editingRow ? 'Save Changes' : 'Create Academic Year'}
            </Button>
          </div>
        }
      >
        <form id="academic-year-form" onSubmit={(e) => void handleSubmitForm(e)} className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {formError}
            </div>
          ) : null}

          <FormField
            id="ay-name"
            label="Academic Year Name"
            required
            hint="Standard institutional format (e.g. 2026-2027)."
          >
            <TextInput
              id="ay-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="2026-2027"
              maxLength={20}
              disabled={savingForm}
              required
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ay-start" label="Start Date" required>
              <TextInput
                id="ay-start"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                disabled={savingForm}
                required
              />
            </FormField>
            <FormField id="ay-end" label="End Date" required>
              <TextInput
                id="ay-end"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                disabled={savingForm}
                required
              />
            </FormField>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 text-sm text-[#1E293B] cursor-pointer">
            <input
              type="checkbox"
              checked={form.isCurrent}
              onChange={(e) => setForm((prev) => ({ ...prev, isCurrent: e.target.checked }))}
              disabled={savingForm}
              className="mt-0.5 h-4 w-4 rounded border-[#E2E8F0] text-[#12345A] focus:ring-[#12345A]"
            />
            <span>
              <span className="font-medium">Set as Current Academic Year</span>
              <span className="block text-xs text-[#64748B]">
                Automatically clears the current flag from any previously active academic year in a single transaction.
              </span>
            </span>
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmCurrentRow)}
        onClose={() => {
          if (!settingCurrent) {
            setConfirmCurrentRow(null);
          }
        }}
        title="Confirm Current Academic Year Change"
        description={
          confirmCurrentRow
            ? `${confirmCurrentRow.name} (${confirmCurrentRow.startDate} to ${confirmCurrentRow.endDate})`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={settingCurrent}
              onClick={() => setConfirmCurrentRow(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={settingCurrent}
              onClick={() => void handleConfirmSetCurrent()}
            >
              Confirm Set Current
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[#64748B]">
          Designating <strong className="text-[#1E293B]">{confirmCurrentRow?.name}</strong> as the
          current academic year will deactivate the current flag on{' '}
          <strong className="text-[#1E293B]">
            {currentAcademicYear ? currentAcademicYear.name : 'the previous cycle'}
          </strong>{' '}
          while preserving all existing student section assignments and reports.
        </p>
      </Modal>
    </div>
  );
}
