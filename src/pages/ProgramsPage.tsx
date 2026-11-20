import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Edit3, Plus, RefreshCw } from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type { CollegeRecord, ProgramRecord, YearLevelRecord } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, SelectInput, TextInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface ProgramsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

type StatusFilter = 'all' | 'active' | 'inactive';

interface ProgramFormState {
  collegeId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export function ProgramsPage({ isAuthenticated, onReturnToOverview }: ProgramsPageProps) {
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [colleges, setColleges] = useState<CollegeRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [collegeFilter, setCollegeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<ProgramRecord | null>(null);
  const [form, setForm] = useState<ProgramFormState>({
    collegeId: '',
    code: '',
    name: '',
    isActive: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaultCollegeId = useMemo(() => {
    const ct = colleges.find((c) => c.code === 'CT' && c.isActive);
    const active = colleges.find((c) => c.isActive);
    return String((ct ?? active ?? colleges[0])?.id ?? '');
  }, [colleges]);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setPrograms([]);
      setColleges([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [programsRes, metaRes] = await Promise.all([
        apiGet<{ programs: ProgramRecord[] }>('/api/v1/coordinator/programs'),
        apiGet<{ colleges: CollegeRecord[]; yearLevels: YearLevelRecord[] }>(
          '/api/v1/coordinator/academic-metadata',
        ),
      ]);
      setPrograms(programsRes.programs);
      setColleges(metaRes.colleges);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load academic programs from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredPrograms = useMemo(() => {
    const query = search.trim().toLowerCase();
    return programs.filter((item) => {
      if (collegeFilter !== 'all' && String(item.collegeId) !== collegeFilter) {
        return false;
      }
      if (statusFilter === 'active' && !item.isActive) {
        return false;
      }
      if (statusFilter === 'inactive' && item.isActive) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        item.code.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.collegeName.toLowerCase().includes(query)
      );
    });
  }, [programs, search, collegeFilter, statusFilter]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredPrograms.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredPrograms.slice(start, start + pageSize);
  }, [filteredPrograms, safePage]);

  const openCreateModal = () => {
    setEditingProgram(null);
    setForm({
      collegeId: defaultCollegeId,
      code: '',
      name: '',
      isActive: true,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (program: ProgramRecord) => {
    setEditingProgram(program);
    setForm({
      collegeId: String(program.collegeId),
      code: program.code,
      name: program.name,
      isActive: program.isActive,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const collegeIdNum = Number.parseInt(form.collegeId, 10);
    const normalizedCode = form.code.trim().toUpperCase();
    const trimmedName = form.name.trim();

    if (!collegeIdNum || collegeIdNum <= 0) {
      setFormError('Please select a college.');
      return;
    }
    if (normalizedCode.length < 2 || normalizedCode.length > 30) {
      setFormError('Program code must be 2–30 characters.');
      return;
    }
    if (trimmedName.length < 2 || trimmedName.length > 150) {
      setFormError('Program name must be 2–150 characters.');
      return;
    }

    setSaving(true);
    try {
      if (editingProgram) {
        await apiPatch<{ program: ProgramRecord }>(
          `/api/v1/coordinator/programs/${editingProgram.id}`,
          {
            collegeId: collegeIdNum,
            code: normalizedCode,
            name: trimmedName,
            isActive: form.isActive,
          },
        );
        setSuccessMessage(`Program "${normalizedCode}" updated successfully.`);
      } else {
        await apiPost<{ program: ProgramRecord }>('/api/v1/coordinator/programs', {
          collegeId: collegeIdNum,
          code: normalizedCode,
          name: trimmedName,
          isActive: form.isActive,
        });
        setSuccessMessage(`Program "${normalizedCode}" created successfully.`);
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Unable to save program record.',
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: Array<TableColumn<ProgramRecord>> = [
    {
      key: 'code',
      header: 'Program Code',
      render: (item) => (
        <span className="font-mono text-xs font-semibold text-[#12345A]">{item.code}</span>
      ),
    },
    {
      key: 'name',
      header: 'Program Name',
      render: (item) => <span className="font-medium text-[#1E293B]">{item.name}</span>,
    },
    {
      key: 'college',
      header: 'College',
      render: (item) => (
        <span className="text-xs text-[#64748B]">
          {item.collegeCode} · {item.collegeName}
        </span>
      ),
    },
    {
      key: 'sectionCount',
      header: 'Sections',
      render: (item) => (
        <span className="text-xs text-[#64748B] tabular-nums">{item.sectionCount}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) =>
        item.isActive ? (
          <StatusBadge tone="success" label="Active" />
        ) : (
          <StatusBadge tone="neutral" label="Inactive" />
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (item) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => openEditModal(item)}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'RSS Coordinator', 'Programs']}
        title="Degree Program Management"
        description="Maintain official Lapu-Lapu City College programs, unique program codes, and active status."
        actions={
          <>
            {isAuthenticated ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  loading={loading}
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void loadData()}
                >
                  Refresh
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={openCreateModal}
                >
                  New Program
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
                Sign in as an RSS Coordinator with a connected PostgreSQL database to manage institutional degree programs.
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
        searchPlaceholder="Search by program code or name..."
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput
              aria-label="Filter by college"
              value={collegeFilter}
              onChange={(e) => {
                setCollegeFilter(e.target.value);
                setPage(1);
              }}
              className="w-auto min-w-[180px]"
            >
              <option value="all">All Colleges</option>
              {colleges.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.code} — {c.name}
                </option>
              ))}
            </SelectInput>

            <div
              role="group"
              aria-label="Filter programs by status"
              className="inline-flex rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-1"
            >
              {(['all', 'active', 'inactive'] as StatusFilter[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab);
                    setPage(1);
                  }}
                  className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium capitalize whitespace-nowrap transition-colors cursor-pointer ${
                    statusFilter === tab
                      ? 'bg-[#12345A] text-white'
                      : 'text-[#64748B] hover:text-[#1E293B]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        }
        emptyTitle="No programs found"
        emptyDescription={
          isAuthenticated
            ? 'Create a degree program under the College of Technology to organize sections and students.'
            : 'Program records load once an RSS Coordinator signs in.'
        }
        emptyAction={
          isAuthenticated ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={openCreateModal}
            >
              Create Program
            </Button>
          ) : undefined
        }
      />

      <Modal
        open={formOpen}
        onClose={() => {
          if (!saving) {
            setFormOpen(false);
          }
        }}
        title={editingProgram ? `Edit Program — ${editingProgram.code}` : 'Create Program'}
        description="Program codes are normalized uppercase and must be unique within the selected college."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="program-form"
              variant="primary"
              size="sm"
              loading={saving}
            >
              {editingProgram ? 'Save Changes' : 'Create Program'}
            </Button>
          </div>
        }
      >
        <form id="program-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {formError}
            </div>
          ) : null}

          <FormField id="program-college" label="College" required>
            <SelectInput
              id="program-college"
              value={form.collegeId}
              onChange={(e) => setForm((prev) => ({ ...prev, collegeId: e.target.value }))}
              disabled={saving}
              required
            >
              <option value="">Select college...</option>
              {colleges.map((c) => (
                <option
                  key={c.id}
                  value={String(c.id)}
                  disabled={!c.isActive && String(c.id) !== form.collegeId}
                >
                  {c.code} — {c.name}
                  {!c.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <FormField
            id="program-code"
            label="Program Code"
            required
            hint="Short institutional abbreviation (e.g. BSIT, BTVTED, BIT-FSM)."
          >
            <TextInput
              id="program-code"
              value={form.code}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
              }
              placeholder="BSIT"
              maxLength={30}
              disabled={saving}
              required
            />
          </FormField>

          <FormField id="program-name" label="Program Full Name" required>
            <TextInput
              id="program-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Bachelor of Science in Information Technology"
              maxLength={150}
              disabled={saving}
              required
            />
          </FormField>

          <label className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 text-sm text-[#1E293B] cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              disabled={saving}
              className="mt-0.5 h-4 w-4 rounded border-[#E2E8F0] text-[#12345A] focus:ring-[#12345A]"
            />
            <span>
              <span className="font-medium">Active Program</span>
              <span className="block text-xs text-[#64748B]">
                Only active programs can receive new sections and new student enrollments.
              </span>
            </span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
