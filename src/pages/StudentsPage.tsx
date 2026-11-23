import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  History,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type {
  AcademicYearRecord,
  AccountStatus,
  CollegeRecord,
  ProgramRecord,
  SectionRecord,
  StudentDetailRecord,
  StudentDirectoryRecord,
  StudentListResponse,
  YearLevelRecord,
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

interface StudentsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

interface StudentCreateFormState {
  studentNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  sex: string;
  birthDate: string;
  contactNumber: string;
  email: string;
  password: string;
  accountStatus: 'active' | 'pending';
  sectionId: string;
  academicYearId: string;
  enrolledAt: string;
}

interface StudentEditFormState {
  studentNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  sex: string;
  birthDate: string;
  contactNumber: string;
  email: string;
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderAccountStatusBadge(status: AccountStatus) {
  switch (status) {
    case 'active':
      return <StatusBadge tone="success" label="Active" />;
    case 'pending':
      return <StatusBadge tone="warning" label="Pending" />;
    case 'suspended':
      return <StatusBadge tone="orange" label="Suspended" />;
    default:
      return <StatusBadge tone="danger" label="Deactivated" />;
  }
}

function renderRegistrationStatusBadge(status: StudentDirectoryRecord['registrationStatus']) {
  switch (status) {
    case 'approved':
      return <StatusBadge tone="success" label="Approved" />;
    case 'rejected':
      return <StatusBadge tone="danger" label="Rejected" />;
    default:
      return <StatusBadge tone="warning" label="Pending" />;
  }
}

export function StudentsPage({ isAuthenticated, onReturnToOverview }: StudentsPageProps) {
  const [students, setStudents] = useState<StudentDirectoryRecord[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);

  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [yearLevels, setYearLevels] = useState<YearLevelRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);

  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [yearLevelFilter, setYearLevelFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [academicYearFilter, setAcademicYearFilter] = useState('');
  const [accountStatusFilter, setAccountStatusFilter] = useState('all');
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState('all');

  // Create student modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<StudentCreateFormState>({
    studentNumber: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    sex: '',
    birthDate: '',
    contactNumber: '',
    email: '',
    password: '',
    accountStatus: 'active',
    sectionId: '',
    academicYearId: '',
    enrolledAt: getTodayIso(),
  });
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit student modal
  const [editingStudent, setEditingStudent] = useState<StudentDirectoryRecord | null>(null);
  const [editForm, setEditForm] = useState<StudentEditFormState>({
    studentNumber: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    sex: '',
    birthDate: '',
    contactNumber: '',
    email: '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Detail & section history modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<StudentDetailRecord | null>(null);

  // Section assign / transfer modal
  const [transferStudent, setTransferStudent] = useState<StudentDirectoryRecord | null>(null);
  const [transferSectionId, setTransferSectionId] = useState('');
  const [transferAcademicYearId, setTransferAcademicYearId] = useState('');
  const [transferEffectiveDate, setTransferEffectiveDate] = useState(getTodayIso());
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Account status modal
  const [statusStudent, setStatusStudent] = useState<StudentDirectoryRecord | null>(null);
  const [targetAccountStatus, setTargetAccountStatus] = useState<
    'active' | 'suspended' | 'deactivated'
  >('active');
  const [statusReason, setStatusReason] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const currentAyId = useMemo(() => {
    const current = academicYears.find((ay) => ay.isCurrent);
    return current ? String(current.id) : academicYears[0] ? String(academicYears[0].id) : '';
  }, [academicYears]);

  const loadReferenceMetadata = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }
    try {
      const [programsRes, metaRes, sectionsRes, ayRes] = await Promise.all([
        apiGet<{ programs: ProgramRecord[] }>('/api/v1/coordinator/programs'),
        apiGet<{ colleges: CollegeRecord[]; yearLevels: YearLevelRecord[] }>(
          '/api/v1/coordinator/academic-metadata',
        ),
        apiGet<{ sections: SectionRecord[] }>('/api/v1/coordinator/sections'),
        apiGet<{ academicYears: AcademicYearRecord[] }>('/api/v1/coordinator/academic-years'),
      ]);
      setPrograms(programsRes.programs);
      setYearLevels(metaRes.yearLevels);
      setSections(sectionsRes.sections);
      setAcademicYears(ayRes.academicYears);
    } catch (err) {
      setError((prev) =>
        prev ??
        (err instanceof ApiClientError
          ? `Unable to load Academic Years/Sections reference lists: ${err.message}`
          : 'Unable to load Academic Years and Sections reference lists.'),
      );
    }
  }, [isAuthenticated]);

  const loadStudents = useCallback(
    async (signal?: AbortSignal) => {
      if (!isAuthenticated) {
        setLoading(false);
        setStudents([]);
        setTotalStudents(0);
        setTotalPages(1);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (programFilter) params.set('programId', programFilter);
        if (yearLevelFilter) params.set('yearLevelId', yearLevelFilter);
        if (sectionFilter) params.set('sectionId', sectionFilter);
        if (academicYearFilter) params.set('academicYearId', academicYearFilter);
        if (accountStatusFilter !== 'all') params.set('accountStatus', accountStatusFilter);
        if (registrationStatusFilter !== 'all') {
          params.set('registrationStatus', registrationStatusFilter);
        }
        params.set('page', String(page));
        params.set('pageSize', '15');

        const res = await apiGet<StudentListResponse>(
          `/api/v1/coordinator/students?${params.toString()}`,
          signal,
        );
        setStudents(res.students);
        setTotalStudents(res.total);
        setTotalPages(res.totalPages);
        if (res.page !== page) {
          setPage(res.page);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(
          err instanceof ApiClientError
            ? err.message
            : 'Unable to load student directory from the server.',
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [
      isAuthenticated,
      search,
      programFilter,
      yearLevelFilter,
      sectionFilter,
      academicYearFilter,
      accountStatusFilter,
      registrationStatusFilter,
      page,
    ],
  );

  useEffect(() => {
    void loadReferenceMetadata();
  }, [loadReferenceMetadata]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudents(controller.signal);
    return () => controller.abort();
  }, [loadStudents]);

  const activeSections = useMemo(
    () => sections.filter((s) => s.isActive),
    [sections],
  );

  const hasActiveFilters = Boolean(
    search.trim() ||
      programFilter ||
      yearLevelFilter ||
      sectionFilter ||
      academicYearFilter ||
      accountStatusFilter !== 'all' ||
      registrationStatusFilter !== 'all',
  );

  const clearAllFilters = () => {
    setSearch('');
    setProgramFilter('');
    setYearLevelFilter('');
    setSectionFilter('');
    setAcademicYearFilter('');
    setAccountStatusFilter('all');
    setRegistrationStatusFilter('all');
    setPage(1);
  };

  const openCreateModal = () => {
    setCreateForm({
      studentNumber: '',
      firstName: '',
      middleName: '',
      lastName: '',
      suffix: '',
      sex: '',
      birthDate: '',
      contactNumber: '',
      email: '',
      password: '',
      accountStatus: 'active',
      sectionId: '',
      academicYearId: currentAyId,
      enrolledAt: getTodayIso(),
    });
    setShowCreatePassword(false);
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);

    if (createForm.sectionId && !createForm.academicYearId) {
      setCreateError('Please select an academic year when assigning an initial section.');
      return;
    }

    setCreating(true);
    try {
      const res = await apiPost<{ student: StudentDetailRecord }>('/api/v1/coordinator/students', {
        studentNumber: createForm.studentNumber.trim(),
        firstName: createForm.firstName.trim(),
        middleName: createForm.middleName.trim() || undefined,
        lastName: createForm.lastName.trim(),
        suffix: createForm.suffix.trim() || undefined,
        sex: createForm.sex || undefined,
        birthDate: createForm.birthDate || undefined,
        contactNumber: createForm.contactNumber.trim() || undefined,
        email: createForm.email.trim(),
        password: createForm.password,
        accountStatus: createForm.accountStatus,
        sectionId: createForm.sectionId ? Number(createForm.sectionId) : null,
        academicYearId: createForm.sectionId && createForm.academicYearId
          ? Number(createForm.academicYearId)
          : null,
        enrolledAt: createForm.sectionId ? createForm.enrolledAt || getTodayIso() : undefined,
      });
      setSuccessMessage(
        `Student "${res.student.fullName}" (${res.student.studentNumber}) created successfully.`,
      );
      setCreateOpen(false);
      await loadStudents();
    } catch (err) {
      setCreateError(
        err instanceof ApiClientError ? err.message : 'Unable to register student record.',
      );
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (student: StudentDirectoryRecord) => {
    setEditingStudent(student);
    setEditForm({
      studentNumber: student.studentNumber,
      firstName: student.firstName,
      middleName: student.middleName ?? '',
      lastName: student.lastName,
      suffix: student.suffix ?? '',
      sex: student.sex ?? '',
      birthDate: student.birthDate ?? '',
      contactNumber: student.contactNumber ?? '',
      email: student.email,
    });
    setEditError(null);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingStudent) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      const res = await apiPatch<{ student: StudentDetailRecord }>(
        `/api/v1/coordinator/students/${editingStudent.studentId}`,
        {
          studentNumber: editForm.studentNumber.trim(),
          firstName: editForm.firstName.trim(),
          middleName: editForm.middleName.trim() || null,
          lastName: editForm.lastName.trim(),
          suffix: editForm.suffix.trim() || null,
          sex: editForm.sex || null,
          birthDate: editForm.birthDate || null,
          contactNumber: editForm.contactNumber.trim() || null,
          email: editForm.email.trim(),
        },
      );
      setSuccessMessage(`Student profile updated for "${res.student.fullName}".`);
      setEditingStudent(null);
      await loadStudents();
    } catch (err) {
      setEditError(
        err instanceof ApiClientError ? err.message : 'Unable to update student profile.',
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const openDetailModal = async (student: StudentDirectoryRecord) => {
    setDetailModalOpen(true);
    setDetailRecord(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await apiGet<{ student: StudentDetailRecord }>(
        `/api/v1/coordinator/students/${student.studentId}`,
      );
      setDetailRecord(res.student);
    } catch (err) {
      setDetailError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load complete student profile and section history.',
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const openTransferModal = (student: StudentDirectoryRecord) => {
    setDetailModalOpen(false);
    setTransferStudent(student);
    setTransferSectionId(
      student.currentSection ? String(student.currentSection.sectionId) : '',
    );
    setTransferAcademicYearId(
      student.currentSection ? String(student.currentSection.academicYearId) : currentAyId,
    );
    setTransferEffectiveDate(getTodayIso());
    setTransferError(null);
  };

  const handleTransferSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!transferStudent) return;
    setTransferError(null);

    if (!transferSectionId) {
      setTransferError('Please select a target section.');
      return;
    }
    if (!transferAcademicYearId) {
      setTransferError('Please select an academic year.');
      return;
    }

    setTransferring(true);
    try {
      const res = await apiPost<{ student: StudentDetailRecord }>(
        `/api/v1/coordinator/students/${transferStudent.studentId}/section-assignment`,
        {
          sectionId: Number(transferSectionId),
          academicYearId: Number(transferAcademicYearId),
          effectiveDate: transferEffectiveDate || getTodayIso(),
        },
      );
      setSuccessMessage(
        `Section placement updated for ${res.student.fullName}; prior section history preserved.`,
      );
      setTransferStudent(null);
      if (detailModalOpen && detailRecord?.studentId === res.student.studentId) {
        setDetailRecord(res.student);
      }
      await loadStudents();
    } catch (err) {
      setTransferError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to save section assignment.',
      );
    } finally {
      setTransferring(false);
    }
  };

  const openStatusModal = (student: StudentDirectoryRecord) => {
    setStatusStudent(student);
    setTargetAccountStatus(
      student.accountStatus === 'active' ? 'deactivated' : 'active',
    );
    setStatusReason('');
    setStatusError(null);
  };

  const handleStatusSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statusStudent) return;
    setStatusError(null);
    setUpdatingStatus(true);
    try {
      await apiPatch(`/api/v1/coordinator/users/${statusStudent.userId}/status`, {
        status: targetAccountStatus,
        reason: statusReason.trim() || undefined,
      });
      setSuccessMessage(
        `Account status for ${statusStudent.fullName} set to "${targetAccountStatus}".`,
      );
      setStatusStudent(null);
      await loadStudents();
    } catch (err) {
      setStatusError(
        err instanceof ApiClientError ? err.message : 'Unable to update account status.',
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  const columns: Array<TableColumn<StudentDirectoryRecord>> = [
    {
      key: 'studentNumber',
      header: 'Student No.',
      render: (item) => (
        <span className="font-mono text-xs font-semibold text-[#12345A] tabular-nums">
          {item.studentNumber}
        </span>
      ),
    },
    {
      key: 'student',
      header: 'Student',
      render: (item) => (
        <div>
          <p className="font-medium text-[#1E293B]">{item.fullName}</p>
          <p className="text-xs text-[#64748B]">{item.email}</p>
        </div>
      ),
    },
    {
      key: 'section',
      header: 'Current Program & Section',
      render: (item) =>
        item.currentSection ? (
          <div>
            <p className="text-sm font-medium text-[#1E293B]">
              {item.currentSection.programCode} · {item.currentSection.yearLevelName} ·{' '}
              {item.currentSection.sectionName}
            </p>
            <p className="text-xs text-[#64748B]">AY {item.currentSection.academicYearName}</p>
          </div>
        ) : (
          <span className="text-xs text-[#64748B]">Unassigned</span>
        ),
    },
    {
      key: 'accountStatus',
      header: 'Account',
      render: (item) => renderAccountStatusBadge(item.accountStatus),
    },
    {
      key: 'registrationStatus',
      header: 'Registration',
      render: (item) => renderRegistrationStatusBadge(item.registrationStatus),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (item) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            icon={<History className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => void openDetailModal(item)}
          >
            History
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openEditModal(item)}
          >
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openTransferModal(item)}
          >
            Section
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openStatusModal(item)}
          >
            Status
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'RSS Coordinator', 'Students']}
        title="Student Management"
        description={`Authorized directory (${totalStudents} total matching records), Coordinator student registration, profile updates, and chronological section history.`}
        actions={
          <>
            {isAuthenticated ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  loading={loading}
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void loadStudents()}
                >
                  Refresh
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={openCreateModal}
                >
                  Register Student
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
                Sign in as an RSS Coordinator with a connected PostgreSQL database to search, register, edit, or transfer student records.
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

      <div className="grid gap-3 rounded-lg border border-[#E2E8F0] bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <SelectInput
          aria-label="Filter by program"
          value={programFilter}
          onChange={(e) => {
            setProgramFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Programs</option>
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
        >
          <option value="">All Year Levels</option>
          {yearLevels.map((yl) => (
            <option key={yl.id} value={String(yl.id)}>
              {yl.name}
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
        >
          <option value="">All Sections</option>
          {sections.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.programCode} · {s.yearLevelName} · {s.name}
            </option>
          ))}
        </SelectInput>

        <SelectInput
          aria-label="Filter by academic year"
          value={academicYearFilter}
          onChange={(e) => {
            setAcademicYearFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Academic Years</option>
          {academicYears.map((ay) => (
            <option key={ay.id} value={String(ay.id)}>
              AY {ay.name}
              {ay.isCurrent ? ' (Current)' : ''}
            </option>
          ))}
        </SelectInput>

        <SelectInput
          aria-label="Filter by account status"
          value={accountStatusFilter}
          onChange={(e) => {
            setAccountStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Account: All</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
          <option value="deactivated">Deactivated</option>
        </SelectInput>

        <SelectInput
          aria-label="Filter by registration status"
          value={registrationStatusFilter}
          onChange={(e) => {
            setRegistrationStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Registration: All</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </SelectInput>
      </div>

      <DataTable
        columns={columns}
        rows={students}
        rowKey={(row) => String(row.studentId)}
        loading={loading}
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Search student number, name, or email..."
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear Filters
            </Button>
          ) : null
        }
        emptyTitle="No student records match your criteria"
        emptyDescription={
          isAuthenticated
            ? 'Register a student directly or approve pending self-registrations from the Registrations queue.'
            : 'Student directory records load once an RSS Coordinator signs in.'
        }
        emptyAction={
          isAuthenticated ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={openCreateModal}
            >
              Register Student
            </Button>
          ) : undefined
        }
      />

      {/* Create Student Modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Register Student (Coordinator)"
        description="Creates the student user account, assigns the Student role, and optionally records initial section enrollment."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-student-form"
              variant="primary"
              size="sm"
              loading={creating}
            >
              Create Student
            </Button>
          </div>
        }
      >
        <form id="create-student-form" onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4">
          {createError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {createError}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="create-student-number" label="Student Number" required>
              <TextInput
                id="create-student-number"
                value={createForm.studentNumber}
                onChange={(e) =>
                  setCreateForm((p) => ({ ...p, studentNumber: e.target.value }))
                }
                placeholder="2026-0001"
                required
                disabled={creating}
              />
            </FormField>
            <FormField id="create-account-status" label="Initial Account Status" required>
              <SelectInput
                id="create-account-status"
                value={createForm.accountStatus}
                onChange={(e) =>
                  setCreateForm((p) => ({
                    ...p,
                    accountStatus: e.target.value === 'pending' ? 'pending' : 'active',
                  }))
                }
                disabled={creating}
              >
                <option value="active">Active (Approved immediately)</option>
                <option value="pending">Pending Coordinator Review</option>
              </SelectInput>
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="create-first-name" label="First Name" required>
              <TextInput
                id="create-first-name"
                value={createForm.firstName}
                onChange={(e) => setCreateForm((p) => ({ ...p, firstName: e.target.value }))}
                required
                disabled={creating}
              />
            </FormField>
            <FormField id="create-middle-name" label="Middle Name">
              <TextInput
                id="create-middle-name"
                value={createForm.middleName}
                onChange={(e) => setCreateForm((p) => ({ ...p, middleName: e.target.value }))}
                disabled={creating}
              />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="create-last-name" label="Last Name" required>
              <TextInput
                id="create-last-name"
                value={createForm.lastName}
                onChange={(e) => setCreateForm((p) => ({ ...p, lastName: e.target.value }))}
                required
                disabled={creating}
              />
            </FormField>
            <FormField id="create-suffix" label="Suffix">
              <TextInput
                id="create-suffix"
                value={createForm.suffix}
                onChange={(e) => setCreateForm((p) => ({ ...p, suffix: e.target.value }))}
                placeholder="Jr., III"
                disabled={creating}
              />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="create-sex" label="Sex">
              <SelectInput
                id="create-sex"
                value={createForm.sex}
                onChange={(e) => setCreateForm((p) => ({ ...p, sex: e.target.value }))}
                disabled={creating}
              >
                <option value="">Unspecified</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </SelectInput>
            </FormField>
            <FormField id="create-birth-date" label="Birth Date">
              <TextInput
                id="create-birth-date"
                type="date"
                value={createForm.birthDate}
                onChange={(e) => setCreateForm((p) => ({ ...p, birthDate: e.target.value }))}
                disabled={creating}
              />
            </FormField>
            <FormField id="create-contact" label="Contact Number">
              <TextInput
                id="create-contact"
                value={createForm.contactNumber}
                onChange={(e) =>
                  setCreateForm((p) => ({ ...p, contactNumber: e.target.value }))
                }
                disabled={creating}
              />
            </FormField>
          </div>

          <FormField id="create-email" label="Institutional Email" required>
            <TextInput
              id="create-email"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
              required
              disabled={creating}
            />
          </FormField>

          <FormField
            id="create-password"
            label="Initial Password"
            required
            hint="Minimum 10 characters with uppercase, lowercase, and at least one number."
          >
            <div className="relative">
              <TextInput
                id="create-password"
                type={showCreatePassword ? 'text' : 'password'}
                value={createForm.password}
                onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                required
                disabled={creating}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCreatePassword((v) => !v)}
                aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#1E293B] cursor-pointer"
              >
                {showCreatePassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </FormField>

          <div className="space-y-3 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#12345A]">
              Initial Section Placement (Optional)
            </p>
            <FormField
              id="create-section"
              label="Section"
              hint={
                activeSections.length === 0
                  ? 'No active sections exist yet. You can still register the student unassigned and assign a section later.'
                  : undefined
              }
            >
              <SelectInput
                id="create-section"
                value={createForm.sectionId}
                onChange={(e) => setCreateForm((p) => ({ ...p, sectionId: e.target.value }))}
                disabled={creating}
              >
                <option value="">
                  {activeSections.length === 0
                    ? 'Leave Unassigned (no active sections yet)'
                    : 'Leave Unassigned'}
                </option>
                {activeSections.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.programCode} · {s.yearLevelName} · {s.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            {createForm.sectionId ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="create-ay" label="Academic Year" required>
                  <SelectInput
                    id="create-ay"
                    value={createForm.academicYearId}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, academicYearId: e.target.value }))
                    }
                    required
                    disabled={creating}
                  >
                    <option value="">Select academic year...</option>
                    {academicYears.map((ay) => (
                      <option key={ay.id} value={String(ay.id)}>
                        {ay.name}
                        {ay.isCurrent ? ' (Current)' : ''}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField id="create-enrolled-at" label="Enrollment Date" required>
                  <TextInput
                    id="create-enrolled-at"
                    type="date"
                    value={createForm.enrolledAt}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, enrolledAt: e.target.value }))
                    }
                    required
                    disabled={creating}
                  />
                </FormField>
              </div>
            ) : null}
          </div>
        </form>
      </Modal>

      {/* Edit Student Modal */}
      <Modal
        open={Boolean(editingStudent)}
        onClose={() => {
          if (!savingEdit) setEditingStudent(null);
        }}
        title={
          editingStudent
            ? `Edit Student — ${editingStudent.fullName}`
            : 'Edit Student'
        }
        description={editingStudent ? editingStudent.studentNumber : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={savingEdit}
              onClick={() => setEditingStudent(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-student-form"
              variant="primary"
              size="sm"
              loading={savingEdit}
            >
              Save Changes
            </Button>
          </div>
        }
      >
        <form id="edit-student-form" onSubmit={(e) => void handleEditSubmit(e)} className="space-y-4">
          {editError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {editError}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="edit-student-number" label="Student Number" required>
              <TextInput
                id="edit-student-number"
                value={editForm.studentNumber}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, studentNumber: e.target.value }))
                }
                required
                disabled={savingEdit}
              />
            </FormField>
            <FormField id="edit-email" label="Institutional Email" required>
              <TextInput
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                required
                disabled={savingEdit}
              />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="edit-first-name" label="First Name" required>
              <TextInput
                id="edit-first-name"
                value={editForm.firstName}
                onChange={(e) => setEditForm((p) => ({ ...p, firstName: e.target.value }))}
                required
                disabled={savingEdit}
              />
            </FormField>
            <FormField id="edit-middle-name" label="Middle Name">
              <TextInput
                id="edit-middle-name"
                value={editForm.middleName}
                onChange={(e) => setEditForm((p) => ({ ...p, middleName: e.target.value }))}
                disabled={savingEdit}
              />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="edit-last-name" label="Last Name" required>
              <TextInput
                id="edit-last-name"
                value={editForm.lastName}
                onChange={(e) => setEditForm((p) => ({ ...p, lastName: e.target.value }))}
                required
                disabled={savingEdit}
              />
            </FormField>
            <FormField id="edit-suffix" label="Suffix">
              <TextInput
                id="edit-suffix"
                value={editForm.suffix}
                onChange={(e) => setEditForm((p) => ({ ...p, suffix: e.target.value }))}
                disabled={savingEdit}
              />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="edit-sex" label="Sex">
              <SelectInput
                id="edit-sex"
                value={editForm.sex}
                onChange={(e) => setEditForm((p) => ({ ...p, sex: e.target.value }))}
                disabled={savingEdit}
              >
                <option value="">Unspecified</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </SelectInput>
            </FormField>
            <FormField id="edit-birth-date" label="Birth Date">
              <TextInput
                id="edit-birth-date"
                type="date"
                value={editForm.birthDate}
                onChange={(e) => setEditForm((p) => ({ ...p, birthDate: e.target.value }))}
                disabled={savingEdit}
              />
            </FormField>
            <FormField id="edit-contact" label="Contact Number">
              <TextInput
                id="edit-contact"
                value={editForm.contactNumber}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, contactNumber: e.target.value }))
                }
                disabled={savingEdit}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Student Profile & Section History Modal */}
      <Modal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={detailRecord ? detailRecord.fullName : 'Student Profile & Section History'}
        description={
          detailRecord
            ? `${detailRecord.studentNumber} · ${detailRecord.email}`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            {detailRecord ? (
              <Button
                variant="primary"
                size="sm"
                icon={<ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => openTransferModal(detailRecord)}
              >
                {detailRecord.currentSection ? 'Transfer Section' : 'Assign Section'}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setDetailModalOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        {detailLoading ? (
          <p className="py-6 text-center text-sm text-[#64748B]">Loading student record...</p>
        ) : detailError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
          >
            {detailError}
          </div>
        ) : detailRecord ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3.5 text-xs">
              <div>
                <dt className="text-[#64748B]">Account Status</dt>
                <dd className="mt-1">{renderAccountStatusBadge(detailRecord.accountStatus)}</dd>
              </div>
              <div>
                <dt className="text-[#64748B]">Registration</dt>
                <dd className="mt-1">
                  {renderRegistrationStatusBadge(detailRecord.registrationStatus)}
                </dd>
              </div>
              <div>
                <dt className="text-[#64748B]">Sex</dt>
                <dd className="mt-0.5 font-medium text-[#1E293B]">
                  {detailRecord.sex ?? 'Not specified'}
                </dd>
              </div>
              <div>
                <dt className="text-[#64748B]">Birth Date</dt>
                <dd className="mt-0.5 font-mono font-medium text-[#1E293B] tabular-nums">
                  {detailRecord.birthDate ?? 'Not specified'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[#64748B]">Contact Number</dt>
                <dd className="mt-0.5 font-medium text-[#1E293B]">
                  {detailRecord.contactNumber ?? 'Not specified'}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#12345A]">
                Section Assignment History
              </h3>
              {detailRecord.sectionHistory.length === 0 ? (
                <p className="mt-2 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-4 text-xs text-[#64748B]">
                  No section assignment history recorded for this student yet.
                </p>
              ) : (
                <div className="mt-2 divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {detailRecord.sectionHistory.map((item) => (
                    <div
                      key={item.historyId}
                      className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1E293B]">
                          {item.programCode} · {item.yearLevelName} · {item.sectionName}
                        </p>
                        <p className="font-mono text-xs text-[#64748B] tabular-nums">
                          AY {item.academicYearName} · Enrolled {item.enrolledAt}
                          {item.endedAt ? ` · Ended ${item.endedAt}` : ''}
                        </p>
                      </div>
                      <StatusBadge
                        tone={item.isCurrent ? 'success' : 'neutral'}
                        label={item.isCurrent ? 'Current' : 'Historical'}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Section Assign / Transfer Modal */}
      <Modal
        open={Boolean(transferStudent)}
        onClose={() => {
          if (!transferring) setTransferStudent(null);
        }}
        title={
          transferStudent?.currentSection
            ? 'Transfer Student Section'
            : 'Assign Student Section'
        }
        description={
          transferStudent
            ? `${transferStudent.fullName} (${transferStudent.studentNumber})`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={transferring}
              onClick={() => setTransferStudent(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="section-transfer-form"
              variant="primary"
              size="sm"
              loading={transferring}
            >
              {transferStudent?.currentSection
                ? 'Confirm Section Transfer'
                : 'Confirm Section Assignment'}
            </Button>
          </div>
        }
      >
        <form
          id="section-transfer-form"
          onSubmit={(e) => void handleTransferSubmit(e)}
          className="space-y-4"
        >
          {transferError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {transferError}
            </div>
          ) : null}

          {transferStudent?.currentSection ? (
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 text-xs text-[#1E293B]">
              <p className="font-semibold">
                Current Section: {transferStudent.currentSection.programCode} ·{' '}
                {transferStudent.currentSection.yearLevelName} ·{' '}
                {transferStudent.currentSection.sectionName} (AY{' '}
                {transferStudent.currentSection.academicYearName})
              </p>
              <p className="mt-1 text-[#64748B]">
                Transferring closes the current placement with the effective date and preserves it as historical data in <code className="font-mono text-[#12345A]">student_section_history</code>.
              </p>
            </div>
          ) : null}

          <FormField
            id="transfer-section"
            label="Target Active Section"
            required
            hint={
              activeSections.length === 0
                ? 'No active sections exist yet. Create a section in Sections Management first.'
                : undefined
            }
          >
            <SelectInput
              id="transfer-section"
              value={transferSectionId}
              onChange={(e) => setTransferSectionId(e.target.value)}
              required
              disabled={transferring}
            >
              <option value="">
                {activeSections.length === 0 ? 'No active sections available' : 'Select section...'}
              </option>
              {activeSections.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.programCode} · {s.yearLevelName} · {s.name}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="transfer-ay"
              label="Academic Year"
              required
              hint={
                academicYears.length === 0
                  ? 'No academic years configured yet.'
                  : undefined
              }
            >
              <SelectInput
                id="transfer-ay"
                value={transferAcademicYearId}
                onChange={(e) => setTransferAcademicYearId(e.target.value)}
                required
                disabled={transferring}
              >
                <option value="">
                  {academicYears.length === 0
                    ? 'No academic years available'
                    : 'Select academic year...'}
                </option>
                {academicYears.map((ay) => (
                  <option key={ay.id} value={String(ay.id)}>
                    {ay.name}
                    {ay.isCurrent ? ' (Current)' : ''}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField
              id="transfer-date"
              label="Effective Date"
              required
              hint={
                transferAcademicYearId
                  ? (() => {
                      const selectedAy = academicYears.find(
                        (ay) => String(ay.id) === transferAcademicYearId,
                      );
                      return selectedAy
                        ? `Must be on or before today and within ${selectedAy.name} (${selectedAy.startDate} to ${selectedAy.endDate}).`
                        : 'Must be on or before today.';
                    })()
                  : 'Must be on or before today.'
              }
            >
              <TextInput
                id="transfer-date"
                type="date"
                value={transferEffectiveDate}
                onChange={(e) => setTransferEffectiveDate(e.target.value)}
                max={getTodayIso()}
                required
                disabled={transferring}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Account Status Modal */}
      <Modal
        open={Boolean(statusStudent)}
        onClose={() => {
          if (!updatingStatus) setStatusStudent(null);
        }}
        title="Update Student Account Status"
        description={
          statusStudent
            ? `${statusStudent.fullName} (${statusStudent.studentNumber})`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={updatingStatus}
              onClick={() => setStatusStudent(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="account-status-form"
              variant={targetAccountStatus === 'deactivated' ? 'danger' : 'primary'}
              size="sm"
              loading={updatingStatus}
            >
              Confirm Status Update
            </Button>
          </div>
        }
      >
        <form
          id="account-status-form"
          onSubmit={(e) => void handleStatusSubmit(e)}
          className="space-y-4"
        >
          {statusError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {statusError}
            </div>
          ) : null}

          <p className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-3 py-2 text-xs text-[#475569]">
            Use <strong>Suspended</strong> for a temporary restriction that can be lifted
            later; use <strong>Deactivated</strong> to revoke active access. A rejected
            registration cannot be reactivated here.
          </p>
          <FormField id="account-status-select" label="Account Status" required>
            <SelectInput
              id="account-status-select"
              value={targetAccountStatus}
              onChange={(e) =>
                setTargetAccountStatus(
                  e.target.value as 'active' | 'suspended' | 'deactivated',
                )
              }
              disabled={updatingStatus}
            >
              <option value="active">Active (Allow Portal Sign-In)</option>
              <option value="suspended">Suspended (Temporarily Restrict Access)</option>
              <option value="deactivated">Deactivated (Revoke Active Access)</option>
            </SelectInput>
          </FormField>

          <FormField id="account-status-reason" label="Audit Reason (Optional)">
            <TextareaInput
              id="account-status-reason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Document the reason for this account status change..."
              disabled={updatingStatus}
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
