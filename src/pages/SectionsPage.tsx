import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Info,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type {
  AcademicYearRecord,
  CollegeRecord,
  ProgramRecord,
  SectionRecord,
  SectionStudentItem,
  YearLevelRecord,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, SelectInput, TextInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface SectionsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

type StatusFilter = 'all' | 'active' | 'inactive';

interface SectionFormState {
  programId: string;
  yearLevelId: string;
  name: string;
  isActive: boolean;
}

export function SectionsPage({ isAuthenticated, onReturnToOverview }: SectionsPageProps) {
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [yearLevels, setYearLevels] = useState<YearLevelRecord[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);

  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('all');
  const [yearLevelFilter, setYearLevelFilter] = useState('all');
  const [academicYearCountFilter, setAcademicYearCountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<SectionRecord | null>(null);
  const [form, setForm] = useState<SectionFormState>({
    programId: '',
    yearLevelId: '',
    name: '',
    isActive: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [rosterSection, setRosterSection] = useState<SectionRecord | null>(null);
  const [rosterStudents, setRosterStudents] = useState<SectionStudentItem[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setSections([]);
      setPrograms([]);
      setYearLevels([]);
      setAcademicYears([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const sectionUrl =
        academicYearCountFilter !== 'all'
          ? `/api/v1/coordinator/sections?academicYearId=${encodeURIComponent(academicYearCountFilter)}`
          : '/api/v1/coordinator/sections';

      const [sectionsRes, programsRes, metaRes, ayRes] = await Promise.all([
        apiGet<{ sections: SectionRecord[] }>(sectionUrl),
        apiGet<{ programs: ProgramRecord[] }>('/api/v1/coordinator/programs'),
        apiGet<{ colleges: CollegeRecord[]; yearLevels: YearLevelRecord[] }>(
          '/api/v1/coordinator/academic-metadata',
        ),
        apiGet<{ academicYears: AcademicYearRecord[] }>('/api/v1/coordinator/academic-years'),
      ]);

      setSections(sectionsRes.sections);
      setPrograms(programsRes.programs);
      setYearLevels(metaRes.yearLevels);
      setAcademicYears(ayRes.academicYears);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load section records from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, academicYearCountFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sections.filter((item) => {
      if (programFilter !== 'all' && String(item.programId) !== programFilter) {
        return false;
      }
      if (yearLevelFilter !== 'all' && String(item.yearLevelId) !== yearLevelFilter) {
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
        item.name.toLowerCase().includes(query) ||
        item.programCode.toLowerCase().includes(query) ||
        item.programName.toLowerCase().includes(query) ||
        item.yearLevelName.toLowerCase().includes(query)
      );
    });
  }, [sections, search, programFilter, yearLevelFilter, statusFilter]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredSections.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredSections.slice(start, start + pageSize);
  }, [filteredSections, safePage]);

  const openCreateModal = () => {
    const firstActiveProgram = programs.find((p) => p.isActive);
    setEditingSection(null);
    setForm({
      programId: firstActiveProgram ? String(firstActiveProgram.id) : '',
      yearLevelId: yearLevels[0] ? String(yearLevels[0].id) : '',
      name: '',
      isActive: true,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (section: SectionRecord) => {
    setEditingSection(section);
    setForm({
      programId: String(section.programId),
      yearLevelId: String(section.yearLevelId),
      name: section.name,
      isActive: section.isActive,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openRosterModal = async (section: SectionRecord) => {
    setRosterSection(section);
    setRosterStudents([]);
    setRosterError(null);
    setRosterLoading(true);
    try {
      const url =
        academicYearCountFilter !== 'all'
          ? `/api/v1/coordinator/sections/${section.id}/students?academicYearId=${encodeURIComponent(academicYearCountFilter)}`
          : `/api/v1/coordinator/sections/${section.id}/students`;
      const res = await apiGet<{ section: SectionRecord; students: SectionStudentItem[] }>(url);
      setRosterStudents(res.students);
    } catch (err) {
      setRosterError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load enrolled students for this section.',
      );
    } finally {
      setRosterLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const programIdNum = Number.parseInt(form.programId, 10);
    const yearLevelIdNum = Number.parseInt(form.yearLevelId, 10);
    const trimmedName = form.name.trim();

    if (!programIdNum || programIdNum <= 0) {
      setFormError('Please select a degree program.');
      return;
    }
    if (!yearLevelIdNum || yearLevelIdNum <= 0) {
      setFormError('Please select a year level.');
      return;
    }
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setFormError('Section name must be 1–50 characters.');
      return;
    }

    setSaving(true);
    try {
      if (editingSection) {
        await apiPatch<{ section: SectionRecord }>(
          `/api/v1/coordinator/sections/${editingSection.id}`,
          {
            programId: programIdNum,
            yearLevelId: yearLevelIdNum,
            name: trimmedName,
            isActive: form.isActive,
          },
        );
        setSuccessMessage(`Section "${trimmedName}" updated successfully.`);
      } else {
        await apiPost<{ section: SectionRecord }>('/api/v1/coordinator/sections', {
          programId: programIdNum,
          yearLevelId: yearLevelIdNum,
          name: trimmedName,
          isActive: form.isActive,
        });
        setSuccessMessage(`Section "${trimmedName}" created successfully.`);
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Unable to save section record.',
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: Array<TableColumn<SectionRecord>> = [
    {
      key: 'name',
      header: 'Section',
      render: (item) => <span className="font-semibold text-[#1E293B]">{item.name}</span>,
    },
    {
      key: 'program',
      header: 'Program',
      render: (item) => (
        <div>
          <span className="font-mono text-xs font-semibold text-[#12345A]">
            {item.programCode}
          </span>
          <span className="ml-2 text-xs text-[#64748B]">{item.programName}</span>
        </div>
      ),
    },
    {
      key: 'yearLevel',
      header: 'Year Level',
      render: (item) => <span className="text-sm text-[#1E293B]">{item.yearLevelName}</span>,
    },
    {
      key: 'enrolled',
      header: 'Current Enrolled',
      render: (item) => (
        <span className="font-mono text-xs font-medium text-[#12345A] tabular-nums">
          {item.currentStudentCount}
        </span>
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
        <div className="inline-flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => void openRosterModal(item)}
          >
            Students
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openEditModal(item)}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'RSS Coordinator', 'Sections']}
        title="Section Management"
        description="Configure sections per degree program and year level, and inspect current student enrollments."
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
                  New Section
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
                Sign in as an RSS Coordinator with a connected PostgreSQL database to manage sections and view enrolled students.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Sections are uniquely defined by <strong className="text-[#1E293B]">(Program, Year Level, Section Name)</strong>. Student placements per Academic Year are tracked chronologically in <code className="font-mono text-[#12345A]">student_section_history</code>. Note: The approved 28-table schema does not include section capacity limits or a fixed academic-year column on <code className="font-mono text-[#12345A]">sections</code>.
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
        searchPlaceholder="Search by section name or program..."
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput
              aria-label="Filter by program"
              value={programFilter}
              onChange={(e) => {
                setProgramFilter(e.target.value);
                setPage(1);
              }}
              className="w-auto min-w-[150px]"
            >
              <option value="all">All Programs</option>
              {programs.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.code}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              aria-label="Filter by year level"
              value={yearLevelFilter}
              onChange={(e) => {
                setYearLevelFilter(e.target.value);
                setPage(1);
              }}
              className="w-auto min-w-[130px]"
            >
              <option value="all">All Year Levels</option>
              {yearLevels.map((yl) => (
                <option key={yl.id} value={String(yl.id)}>
                  {yl.name}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              aria-label="Count enrollments by academic year"
              value={academicYearCountFilter}
              onChange={(e) => {
                setAcademicYearCountFilter(e.target.value);
                setPage(1);
              }}
              className="w-auto min-w-[170px]"
            >
              <option value="all">Enrollments: All Current</option>
              {academicYears.map((ay) => (
                <option key={ay.id} value={String(ay.id)}>
                  AY {ay.name}
                  {ay.isCurrent ? ' (Current)' : ''}
                </option>
              ))}
            </SelectInput>

            <div
              role="group"
              aria-label="Filter sections by status"
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
        emptyTitle="No sections found"
        emptyDescription={
          isAuthenticated
            ? 'Create sections under active programs and year levels to organize student placements.'
            : 'Section records load once an RSS Coordinator signs in.'
        }
        emptyAction={
          isAuthenticated ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={openCreateModal}
            >
              Create Section
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
        title={editingSection ? `Edit Section — ${editingSection.name}` : 'Create Section'}
        description="Assign the section to an active degree program and year level."
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
              form="section-form"
              variant="primary"
              size="sm"
              loading={saving}
            >
              {editingSection ? 'Save Changes' : 'Create Section'}
            </Button>
          </div>
        }
      >
        <form id="section-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {formError}
            </div>
          ) : null}

          <FormField
            id="section-program"
            label="Program"
            required
            hint={
              programs.filter((p) => p.isActive).length === 0
                ? 'No active programs exist yet. Create an active program first.'
                : undefined
            }
          >
            <SelectInput
              id="section-program"
              value={form.programId}
              onChange={(e) => setForm((prev) => ({ ...prev, programId: e.target.value }))}
              disabled={saving}
              required
            >
              <option value="">
                {programs.filter((p) => p.isActive).length === 0
                  ? 'No active programs available'
                  : 'Select program...'}
              </option>
              {programs.map((p) => (
                <option
                  key={p.id}
                  value={String(p.id)}
                  disabled={!p.isActive && String(p.id) !== form.programId}
                >
                  {p.code} — {p.name}
                  {!p.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <FormField id="section-year-level" label="Year Level" required>
            <SelectInput
              id="section-year-level"
              value={form.yearLevelId}
              onChange={(e) => setForm((prev) => ({ ...prev, yearLevelId: e.target.value }))}
              disabled={saving}
              required
            >
              <option value="">Select year level...</option>
              {yearLevels.map((yl) => (
                <option key={yl.id} value={String(yl.id)}>
                  {yl.name}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <FormField
            id="section-name"
            label="Section Name"
            required
            hint="Must be unique within the selected program and year level (e.g. 1A, BSIT-1A)."
          >
            <TextInput
              id="section-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="1A"
              maxLength={50}
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
              <span className="font-medium">Active Section</span>
              <span className="block text-xs text-[#64748B]">
                Only active sections can accept new student placements or transfers.
              </span>
            </span>
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(rosterSection)}
        onClose={() => setRosterSection(null)}
        title={rosterSection ? `Enrolled Students — ${rosterSection.name}` : 'Enrolled Students'}
        description={
          rosterSection
            ? `${rosterSection.programCode} · ${rosterSection.yearLevelName} (${rosterSection.programName})`
            : undefined
        }
        footer={
          <Button variant="secondary" size="sm" onClick={() => setRosterSection(null)}>
            Close
          </Button>
        }
      >
        {rosterLoading ? (
          <p className="py-6 text-center text-sm text-[#64748B]">Loading section roster...</p>
        ) : rosterError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
          >
            {rosterError}
          </div>
        ) : rosterStudents.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-8 text-center">
            <p className="text-sm font-medium text-[#1E293B]">No students currently assigned</p>
            <p className="mt-1 text-xs text-[#64748B]">
              Students assigned or transferred to this section will appear here with their academic year and enrollment date.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
            {rosterStudents.map((stu) => (
              <div key={stu.studentId} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#1E293B]">{stu.fullName}</p>
                  <p className="font-mono text-xs text-[#64748B] tabular-nums">
                    {stu.studentNumber} · AY {stu.academicYearName} · Enrolled {stu.enrolledAt}
                  </p>
                </div>
                <StatusBadge
                  tone={
                    stu.accountStatus === 'active'
                      ? 'success'
                      : stu.accountStatus === 'suspended'
                        ? 'orange'
                        : stu.accountStatus === 'deactivated'
                          ? 'danger'
                          : 'warning'
                  }
                  label={stu.accountStatus}
                />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
