import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  FolderKanban,
  Info,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ApiClientError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from '../services/apiClient.ts';
import type {
  CollegeRecord,
  SectionRecord,
  StudentDirectoryRecord,
  StudentListResponse,
  TaskCategoryRecord,
  TaskDetailRecord,
  TaskListResponse,
  TaskRecord,
  TaskSessionRecord,
  TaskStatus,
  TaskVisibility,
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
import { StatusBadge, type SemanticTone } from '../components/ui/StatusBadge.tsx';

interface TasksPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

type ModuleTab = 'tasks' | 'categories';

interface CategoryFormState {
  name: string;
  description: string;
  isActive: boolean;
}

interface TaskFormState {
  collegeId: string;
  categoryId: string;
  title: string;
  description: string;
  location: string;
  visibility: TaskVisibility;
  capacity: string;
  requiredHours: string;
  applicationStart: string;
  applicationDeadline: string;
  activityStart: string;
  activityEnd: string;
  targetSectionIds: number[];
  targetStudentIds: number[];
}

interface SessionFormState {
  sessionTitle: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  location: string;
}

interface PickedStudentMeta {
  studentId: number;
  studentNumber: string;
  fullName: string;
  sectionLabel: string | null;
}

function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocalValue(val: string): string | null {
  const trimmed = val.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
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

function getTaskStatusMeta(status: TaskStatus): { tone: SemanticTone; label: string } {
  switch (status) {
    case 'published':
      return { tone: 'success', label: 'Published' };
    case 'ongoing':
      return { tone: 'info', label: 'Ongoing' };
    case 'completed':
      return { tone: 'success', label: 'Completed' };
    case 'cancelled':
      return { tone: 'orange', label: 'Cancelled' };
    case 'archived':
      return { tone: 'neutral', label: 'Archived' };
    default:
      return { tone: 'neutral', label: 'Draft' };
  }
}

function formatVisibilitySummary(task: TaskRecord): string {
  if (task.visibility === 'all_students') {
    return 'All Eligible Students';
  }
  if (task.visibility === 'specific_sections') {
    return `${task.targetSectionCount} Section${task.targetSectionCount === 1 ? '' : 's'}`;
  }
  return `${task.targetStudentCount} Student${task.targetStudentCount === 1 ? '' : 's'}`;
}

const ALLOWED_STATUS_OPTIONS: Record<TaskStatus, Array<{ status: TaskStatus; label: string; note: string }>> = {
  draft: [
    { status: 'published', label: 'Publish Task', note: 'Makes the task visible to targeted eligible students.' },
    { status: 'cancelled', label: 'Cancel Task', note: 'Marks this task as cancelled before publication.' },
    { status: 'archived', label: 'Archive Task', note: 'Moves this draft out of active operational lists.' },
  ],
  published: [
    { status: 'draft', label: 'Unpublish to Draft', note: 'Hides the task from students (allowed only when 0 pending/approved applications exist).' },
    { status: 'ongoing', label: 'Mark Ongoing', note: 'Indicates the RSS activity is currently underway.' },
    { status: 'completed', label: 'Mark Completed', note: 'Marks the activity as completed.' },
    { status: 'cancelled', label: 'Cancel Task', note: 'Cancels the task and hides it from open discovery.' },
    { status: 'archived', label: 'Archive Task', note: 'Archives the task for historical reference.' },
  ],
  ongoing: [
    { status: 'completed', label: 'Mark Completed', note: 'Marks the activity as completed.' },
    { status: 'cancelled', label: 'Cancel Task', note: 'Cancels the ongoing activity.' },
    { status: 'archived', label: 'Archive Task', note: 'Archives the activity.' },
  ],
  completed: [
    { status: 'archived', label: 'Archive Task', note: 'Archives the completed task.' },
  ],
  cancelled: [
    { status: 'draft', label: 'Reopen to Draft', note: 'Restores the task as an unpublished draft for editing.' },
    { status: 'archived', label: 'Archive Task', note: 'Moves the cancelled task to archive.' },
  ],
  archived: [
    { status: 'draft', label: 'Reopen to Draft', note: 'Restores the archived task to an editable draft.' },
  ],
};

export function TasksPage({ isAuthenticated, onReturnToOverview }: TasksPageProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('tasks');

  // Shared reference & task data
  const [categories, setCategories] = useState<TaskCategoryRecord[]>([]);
  const [colleges, setColleges] = useState<CollegeRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [tasksData, setTasksData] = useState<TaskListResponse>({
    tasks: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });

  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Task filters & sort
  const [taskSearch, setTaskSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [taskPage, setTaskPage] = useState(1);

  // Category filters & modal
  const [catSearch, setCatSearch] = useState('');
  const [catPage, setCatPage] = useState(1);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<TaskCategoryRecord | null>(null);
  const [catForm, setCatForm] = useState<CategoryFormState>({
    name: '',
    description: '',
    isActive: true,
  });
  const [catFormError, setCatFormError] = useState<string | null>(null);
  const [savingCat, setSavingCat] = useState(false);

  // Task Create/Edit modal
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDetailRecord | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>({
    collegeId: '',
    categoryId: '',
    title: '',
    description: '',
    location: '',
    visibility: 'all_students',
    capacity: '',
    requiredHours: '',
    applicationStart: '',
    applicationDeadline: '',
    activityStart: '',
    activityEnd: '',
    targetSectionIds: [],
    targetStudentIds: [],
  });
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [sectionPickerSearch, setSectionPickerSearch] = useState('');
  const [studentPickerSearch, setStudentPickerSearch] = useState('');
  const [studentPickerResults, setStudentPickerResults] = useState<StudentDirectoryRecord[]>([]);
  const [studentPickerLoading, setStudentPickerLoading] = useState(false);
  const [pickedStudentsMap, setPickedStudentsMap] = useState<Record<number, PickedStudentMeta>>({});

  // Inline Quick-Create Category inside Task Modal
  const [quickCatOpen, setQuickCatOpen] = useState(false);
  const [quickCatName, setQuickCatName] = useState('');
  const [quickCatDesc, setQuickCatDesc] = useState('');
  const [quickCatError, setQuickCatError] = useState<string | null>(null);
  const [savingQuickCat, setSavingQuickCat] = useState(false);

  // Task Status Transition modal
  const [statusModalTask, setStatusModalTask] = useState<TaskRecord | null>(null);
  const [selectedNextStatus, setSelectedNextStatus] = useState<TaskStatus>('published');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Task Detail & Sessions modal
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<TaskSessionRecord | null>(null);
  const [sessionForm, setSessionForm] = useState<SessionFormState>({
    sessionTitle: '',
    sessionDate: '',
    startTime: '08:00',
    endTime: '12:00',
    location: '',
  });
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<TaskSessionRecord | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  const loadTasksAndRefs = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(taskPage),
        pageSize: '10',
        sort: sortBy,
      });
      if (taskSearch.trim()) {
        params.set('search', taskSearch.trim());
      }
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (categoryFilter !== 'all') {
        params.set('categoryId', categoryFilter);
      }
      if (visibilityFilter !== 'all') {
        params.set('visibility', visibilityFilter);
      }

      const [tasksRes, categoriesRes, metaRes, sectionsRes] = await Promise.all([
        apiGet<TaskListResponse>(`/api/v1/coordinator/tasks?${params.toString()}`),
        apiGet<{ categories: TaskCategoryRecord[] }>('/api/v1/coordinator/task-categories'),
        apiGet<{ colleges: CollegeRecord[] }>('/api/v1/coordinator/academic-metadata'),
        apiGet<{ sections: SectionRecord[] }>('/api/v1/coordinator/sections'),
      ]);

      setTasksData(tasksRes);
      setCategories(categoriesRes.categories);
      setColleges(metaRes.colleges);
      setSections(sectionsRes.sections);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load RSS task management data from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    isAuthenticated,
    taskPage,
    taskSearch,
    statusFilter,
    categoryFilter,
    visibilityFilter,
    sortBy,
  ]);

  useEffect(() => {
    void loadTasksAndRefs();
  }, [loadTasksAndRefs]);

  const loadPickerStudents = useCallback(async (searchQuery: string) => {
    if (!isAuthenticated) {
      return;
    }
    setStudentPickerLoading(true);
    try {
      const params = new URLSearchParams({
        registrationStatus: 'approved',
        accountStatus: 'active',
        page: '1',
        pageSize: '25',
      });
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      const res = await apiGet<StudentListResponse>(
        `/api/v1/coordinator/students?${params.toString()}`,
      );
      setStudentPickerResults(res.students);
      setPickedStudentsMap((prev) => {
        const next = { ...prev };
        for (const s of res.students) {
          next[s.studentId] = {
            studentId: s.studentId,
            studentNumber: s.studentNumber,
            fullName: s.fullName,
            sectionLabel: s.currentSection
              ? `${s.currentSection.programCode} ${s.currentSection.sectionName}`
              : null,
          };
        }
        return next;
      });
    } catch {
      // Errors handled inside picker if needed
    } finally {
      setStudentPickerLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (taskModalOpen && taskForm.visibility === 'selected_students') {
      void loadPickerStudents(studentPickerSearch);
    }
  }, [taskModalOpen, taskForm.visibility, studentPickerSearch, loadPickerStudents]);

  // -------------------------------------------------------------------------
  // Category Handlers
  // -------------------------------------------------------------------------

  const openCreateCategoryModal = () => {
    setEditingCategory(null);
    setCatForm({ name: '', description: '', isActive: true });
    setCatFormError(null);
    setCatModalOpen(true);
  };

  const openEditCategoryModal = (cat: TaskCategoryRecord) => {
    setEditingCategory(cat);
    setCatForm({
      name: cat.name,
      description: cat.description ?? '',
      isActive: cat.isActive,
    });
    setCatFormError(null);
    setCatModalOpen(true);
  };

  const handleCategorySubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCatFormError(null);
    const trimmedName = catForm.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setCatFormError('Category name must be between 2 and 100 characters.');
      return;
    }

    setSavingCat(true);
    try {
      if (editingCategory) {
        await apiPatch<{ category: TaskCategoryRecord }>(
          `/api/v1/coordinator/task-categories/${editingCategory.id}`,
          {
            name: trimmedName,
            description: catForm.description.trim() || null,
            isActive: catForm.isActive,
          },
        );
        setSuccessMessage(`Task category "${trimmedName}" updated successfully.`);
      } else {
        await apiPost<{ category: TaskCategoryRecord }>('/api/v1/coordinator/task-categories', {
          name: trimmedName,
          description: catForm.description.trim() || null,
          isActive: catForm.isActive,
        });
        setSuccessMessage(`Task category "${trimmedName}" created successfully.`);
      }
      setCatModalOpen(false);
      await loadTasksAndRefs();
    } catch (err) {
      setCatFormError(
        err instanceof ApiClientError ? err.message : 'Unable to save task category.',
      );
    } finally {
      setSavingCat(false);
    }
  };

  const handleToggleCategoryActive = async (cat: TaskCategoryRecord) => {
    setError(null);
    setSuccessMessage(null);
    try {
      await apiPatch<{ category: TaskCategoryRecord }>(
        `/api/v1/coordinator/task-categories/${cat.id}`,
        {
          name: cat.name,
          description: cat.description,
          isActive: !cat.isActive,
        },
      );
      setSuccessMessage(
        `Category "${cat.name}" ${cat.isActive ? 'disabled' : 'enabled'} successfully.`,
      );
      await loadTasksAndRefs();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to update task category status.',
      );
    }
  };

  // -------------------------------------------------------------------------
  // Task Create / Edit Handlers
  // -------------------------------------------------------------------------

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories],
  );
  const activeColleges = useMemo(
    () => colleges.filter((c) => c.isActive),
    [colleges],
  );
  const activeSections = useMemo(
    () => sections.filter((s) => s.isActive),
    [sections],
  );

  const openCreateTaskModal = () => {
    const defaultCollege = activeColleges[0] ?? colleges[0];
    const defaultCategory = activeCategories[0];
    setEditingTask(null);
    setTaskForm({
      collegeId: defaultCollege ? String(defaultCollege.id) : '',
      categoryId: defaultCategory ? String(defaultCategory.id) : '',
      title: '',
      description: '',
      location: '',
      visibility: 'all_students',
      capacity: '',
      requiredHours: '',
      applicationStart: '',
      applicationDeadline: '',
      activityStart: '',
      activityEnd: '',
      targetSectionIds: [],
      targetStudentIds: [],
    });
    setSectionPickerSearch('');
    setStudentPickerSearch('');
    setTaskFormError(null);
    setQuickCatOpen(false);
    setQuickCatName('');
    setQuickCatDesc('');
    setQuickCatError(null);
    setTaskModalOpen(true);
  };

  const handleQuickCreateCategory = async () => {
    setQuickCatError(null);
    const trimmedName = quickCatName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setQuickCatError('Category name must be between 2 and 100 characters.');
      return;
    }
    setSavingQuickCat(true);
    try {
      const res = await apiPost<{ category: TaskCategoryRecord }>(
        '/api/v1/coordinator/task-categories',
        {
          name: trimmedName,
          description: quickCatDesc.trim() || null,
          isActive: true,
        },
      );
      setCategories((prev) => [res.category, ...prev]);
      setTaskForm((prev) => ({ ...prev, categoryId: String(res.category.id) }));
      setQuickCatOpen(false);
      setQuickCatName('');
      setQuickCatDesc('');
      setQuickCatError(null);
      setTaskFormError(null);
      setSuccessMessage(`Task category "${res.category.name}" created and selected.`);
    } catch (err) {
      setQuickCatError(
        err instanceof ApiClientError ? err.message : 'Unable to create task category.',
      );
    } finally {
      setSavingQuickCat(false);
    }
  };

  const openEditTaskModal = async (taskSummary: TaskRecord) => {
    setTaskFormError(null);
    setError(null);
    try {
      const res = await apiGet<{ task: TaskDetailRecord }>(
        `/api/v1/coordinator/tasks/${taskSummary.id}`,
      );
      const detail = res.task;
      setEditingTask(detail);
      setTaskForm({
        collegeId: String(detail.collegeId),
        categoryId: String(detail.categoryId),
        title: detail.title,
        description: detail.description,
        location: detail.location ?? '',
        visibility: detail.visibility,
        capacity: detail.capacity !== null ? String(detail.capacity) : '',
        requiredHours: detail.requiredHours !== null ? String(detail.requiredHours) : '',
        applicationStart: toDateTimeLocalValue(detail.applicationStart),
        applicationDeadline: toDateTimeLocalValue(detail.applicationDeadline),
        activityStart: toDateTimeLocalValue(detail.activityStart),
        activityEnd: toDateTimeLocalValue(detail.activityEnd),
        targetSectionIds: detail.targetSections.map((s) => s.sectionId),
        targetStudentIds: detail.targetStudents.map((s) => s.studentId),
      });
      setPickedStudentsMap((prev) => {
        const next = { ...prev };
        for (const s of detail.targetStudents) {
          next[s.studentId] = {
            studentId: s.studentId,
            studentNumber: s.studentNumber,
            fullName: s.fullName,
            sectionLabel: s.sectionLabel,
          };
        }
        return next;
      });
      setSectionPickerSearch('');
      setStudentPickerSearch('');
      setTaskModalOpen(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to load task details for editing.',
      );
    }
  };

  const submitTaskForm = async (publishImmediately: boolean) => {
    setTaskFormError(null);
    const collegeIdNum = Number.parseInt(taskForm.collegeId, 10);
    const categoryIdNum = Number.parseInt(taskForm.categoryId, 10);
    const trimmedTitle = taskForm.title.trim();
    const trimmedDescription = taskForm.description.trim();

    if (!collegeIdNum || collegeIdNum <= 0) {
      setTaskFormError('Please select a college.');
      return;
    }
    if (!categoryIdNum || categoryIdNum <= 0) {
      setTaskFormError('Please select a task category. Create one first if none exist.');
      return;
    }
    if (trimmedTitle.length < 3 || trimmedTitle.length > 200) {
      setTaskFormError('Task title must be between 3 and 200 characters.');
      return;
    }
    if (trimmedDescription.length < 3) {
      setTaskFormError('Task description must be at least 3 characters.');
      return;
    }

    let capacityVal: number | null = null;
    if (taskForm.capacity.trim() !== '') {
      const cap = Number(taskForm.capacity.trim());
      if (!Number.isInteger(cap) || cap <= 0) {
        setTaskFormError('Participant capacity must be a positive whole number.');
        return;
      }
      capacityVal = cap;
    }

    let hoursVal: number | null = null;
    if (taskForm.requiredHours.trim() !== '') {
      const hrs = Number(taskForm.requiredHours.trim());
      if (!Number.isFinite(hrs) || hrs < 0) {
        setTaskFormError('Required hours must be zero or a positive number.');
        return;
      }
      hoursVal = hrs;
    }

    const appStartIso = fromDateTimeLocalValue(taskForm.applicationStart);
    const appDeadlineIso = fromDateTimeLocalValue(taskForm.applicationDeadline);
    const actStartIso = fromDateTimeLocalValue(taskForm.activityStart);
    const actEndIso = fromDateTimeLocalValue(taskForm.activityEnd);

    if (appStartIso && appDeadlineIso && new Date(appDeadlineIso) <= new Date(appStartIso)) {
      setTaskFormError('Application deadline must be strictly after application start.');
      return;
    }
    if (actStartIso && actEndIso && new Date(actEndIso) <= new Date(actStartIso)) {
      setTaskFormError('Activity end date/time must be strictly after activity start.');
      return;
    }

    const targetStatus: TaskStatus = editingTask
      ? editingTask.status
      : publishImmediately
        ? 'published'
        : 'draft';

    if (
      taskForm.visibility === 'specific_sections' &&
      (targetStatus === 'published' || targetStatus === 'ongoing') &&
      taskForm.targetSectionIds.length === 0
    ) {
      setTaskFormError('Select at least one target section when visibility is Specific Sections.');
      return;
    }

    if (
      taskForm.visibility === 'selected_students' &&
      (targetStatus === 'published' || targetStatus === 'ongoing') &&
      taskForm.targetStudentIds.length === 0
    ) {
      setTaskFormError('Select at least one target student when visibility is Selected Individual Students.');
      return;
    }

    setSavingTask(true);
    try {
      const payload = {
        collegeId: collegeIdNum,
        categoryId: categoryIdNum,
        title: trimmedTitle,
        description: trimmedDescription,
        location: taskForm.location.trim() || null,
        visibility: taskForm.visibility,
        capacity: capacityVal,
        requiredHours: hoursVal,
        applicationStart: appStartIso,
        applicationDeadline: appDeadlineIso,
        activityStart: actStartIso,
        activityEnd: actEndIso,
        targetSectionIds:
          taskForm.visibility === 'specific_sections' ? taskForm.targetSectionIds : [],
        targetStudentIds:
          taskForm.visibility === 'selected_students' ? taskForm.targetStudentIds : [],
      };

      if (editingTask) {
        const res = await apiPatch<{ task: TaskDetailRecord }>(
          `/api/v1/coordinator/tasks/${editingTask.id}`,
          payload,
        );
        setSuccessMessage(`Task "${res.task.title}" updated successfully.`);
        if (detailTaskId === editingTask.id) {
          setTaskDetail(res.task);
        }
      } else {
        const res = await apiPost<{ task: TaskDetailRecord }>('/api/v1/coordinator/tasks', {
          ...payload,
          status: publishImmediately ? 'published' : 'draft',
        });
        setSuccessMessage(
          `Task "${res.task.title}" ${publishImmediately ? 'created and published' : 'saved as draft'}.`,
        );
      }

      setTaskModalOpen(false);
      await loadTasksAndRefs();
    } catch (err) {
      setTaskFormError(err instanceof ApiClientError ? err.message : 'Unable to save RSS task.');
    } finally {
      setSavingTask(false);
    }
  };

  // -------------------------------------------------------------------------
  // Status Transition Handlers
  // -------------------------------------------------------------------------

  const openStatusModal = (task: TaskRecord, defaultNext?: TaskStatus) => {
    const options = ALLOWED_STATUS_OPTIONS[task.status];
    setStatusModalTask(task);
    setSelectedNextStatus(defaultNext ?? options[0]?.status ?? task.status);
    setStatusError(null);
  };

  const handleStatusConfirm = async () => {
    if (!statusModalTask) {
      return;
    }
    setUpdatingStatus(true);
    setStatusError(null);
    try {
      const res = await apiPatch<{ task: TaskDetailRecord }>(
        `/api/v1/coordinator/tasks/${statusModalTask.id}/status`,
        { status: selectedNextStatus },
      );
      setSuccessMessage(
        `Task "${res.task.title}" status updated to "${selectedNextStatus}".`,
      );
      if (detailTaskId === statusModalTask.id) {
        setTaskDetail(res.task);
      }
      setStatusModalTask(null);
      await loadTasksAndRefs();
    } catch (err) {
      setStatusError(
        err instanceof ApiClientError ? err.message : 'Unable to update task status.',
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  // -------------------------------------------------------------------------
  // Detail & Sessions Handlers
  // -------------------------------------------------------------------------

  const refreshTaskDetail = useCallback(async (taskId: number) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await apiGet<{ task: TaskDetailRecord }>(
        `/api/v1/coordinator/tasks/${taskId}`,
      );
      setTaskDetail(res.task);
    } catch (err) {
      setDetailError(
        err instanceof ApiClientError ? err.message : 'Unable to load task details and sessions.',
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetailModal = (task: TaskRecord) => {
    setDetailTaskId(task.id);
    setTaskDetail(null);
    setSessionFormOpen(false);
    setEditingSession(null);
    setConfirmDeleteSession(null);
    setSessionError(null);
    void refreshTaskDetail(task.id);
  };

  const openCreateSessionForm = () => {
    setEditingSession(null);
    setSessionForm({
      sessionTitle: '',
      sessionDate: '',
      startTime: '08:00',
      endTime: '12:00',
      location: taskDetail?.location ?? '',
    });
    setSessionError(null);
    setSessionFormOpen(true);
  };

  const openEditSessionForm = (session: TaskSessionRecord) => {
    setEditingSession(session);
    setSessionForm({
      sessionTitle: session.sessionTitle,
      sessionDate: session.sessionDate,
      startTime: session.startTime,
      endTime: session.endTime,
      location: session.location,
    });
    setSessionError(null);
    setSessionFormOpen(true);
  };

  const handleSessionSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!detailTaskId) {
      return;
    }
    setSessionError(null);
    if (sessionForm.sessionTitle.trim().length < 2) {
      setSessionError('Session title must be at least 2 characters.');
      return;
    }
    if (!sessionForm.sessionDate) {
      setSessionError('Session date is required.');
      return;
    }
    if (!sessionForm.startTime || !sessionForm.endTime) {
      setSessionError('Start and end times are required.');
      return;
    }
    if (sessionForm.endTime <= sessionForm.startTime) {
      setSessionError('End time must be strictly after start time.');
      return;
    }
    if (sessionForm.location.trim().length < 2) {
      setSessionError('Session location must be at least 2 characters.');
      return;
    }

    setSavingSession(true);
    try {
      const payload = {
        sessionTitle: sessionForm.sessionTitle.trim(),
        sessionDate: sessionForm.sessionDate,
        startTime: sessionForm.startTime,
        endTime: sessionForm.endTime,
        location: sessionForm.location.trim(),
      };
      if (editingSession) {
        await apiPatch<{ session: TaskSessionRecord }>(
          `/api/v1/coordinator/tasks/${detailTaskId}/sessions/${editingSession.id}`,
          payload,
        );
        setSuccessMessage(`Session "${payload.sessionTitle}" updated.`);
      } else {
        await apiPost<{ session: TaskSessionRecord }>(
          `/api/v1/coordinator/tasks/${detailTaskId}/sessions`,
          payload,
        );
        setSuccessMessage(`Session "${payload.sessionTitle}" added.`);
      }
      setSessionFormOpen(false);
      setEditingSession(null);
      await Promise.all([refreshTaskDetail(detailTaskId), loadTasksAndRefs()]);
    } catch (err) {
      setSessionError(
        err instanceof ApiClientError ? err.message : 'Unable to save task session.',
      );
    } finally {
      setSavingSession(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!detailTaskId || !confirmDeleteSession) {
      return;
    }
    setDeletingSession(true);
    setSessionError(null);
    try {
      await apiDelete<{ deletedSessionId: number }>(
        `/api/v1/coordinator/tasks/${detailTaskId}/sessions/${confirmDeleteSession.id}`,
      );
      setSuccessMessage(`Session "${confirmDeleteSession.sessionTitle}" deleted.`);
      setConfirmDeleteSession(null);
      await Promise.all([refreshTaskDetail(detailTaskId), loadTasksAndRefs()]);
    } catch (err) {
      setSessionError(
        err instanceof ApiClientError ? err.message : 'Unable to delete task session.',
      );
    } finally {
      setDeletingSession(false);
    }
  };

  // -------------------------------------------------------------------------
  // Filtered Picker Lists & Table Columns
  // -------------------------------------------------------------------------

  const filteredPickerSections = useMemo(() => {
    const q = sectionPickerSearch.trim().toLowerCase();
    return activeSections.filter((sec) => {
      if (!q) {
        return true;
      }
      return (
        sec.name.toLowerCase().includes(q) ||
        sec.programCode.toLowerCase().includes(q) ||
        sec.yearLevelName.toLowerCase().includes(q)
      );
    });
  }, [activeSections, sectionPickerSearch]);

  const toggleSectionTarget = (sectionId: number) => {
    setTaskForm((prev) => {
      const exists = prev.targetSectionIds.includes(sectionId);
      return {
        ...prev,
        targetSectionIds: exists
          ? prev.targetSectionIds.filter((id) => id !== sectionId)
          : [...prev.targetSectionIds, sectionId],
      };
    });
  };

  const toggleStudentTarget = (studentId: number) => {
    setTaskForm((prev) => {
      const exists = prev.targetStudentIds.includes(studentId);
      return {
        ...prev,
        targetStudentIds: exists
          ? prev.targetStudentIds.filter((id) => id !== studentId)
          : [...prev.targetStudentIds, studentId],
      };
    });
  };

  const filteredCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    return categories.filter((c) => {
      if (!q) {
        return true;
      }
      return (
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [categories, catSearch]);

  const catPageSize = 10;
  const catTotalPages = Math.max(1, Math.ceil(filteredCategories.length / catPageSize));
  const safeCatPage = Math.min(catPage, catTotalPages);
  const paginatedCategories = useMemo(() => {
    const start = (safeCatPage - 1) * catPageSize;
    return filteredCategories.slice(start, start + catPageSize);
  }, [filteredCategories, safeCatPage]);

  const taskColumns: Array<TableColumn<TaskRecord>> = [
    {
      key: 'title',
      header: 'Task Title & Category',
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
      key: 'visibility',
      header: 'Audience & Sessions',
      render: (item) => (
        <div className="text-xs">
          <p className="font-medium text-[#12345A]">{formatVisibilitySummary(item)}</p>
          <p className="mt-0.5 text-[#64748B] tabular-nums">
            {item.sessionCount} session{item.sessionCount === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'deadline',
      header: 'Deadline & Hours',
      render: (item) => (
        <div className="text-xs tabular-nums">
          <p className="text-[#1E293B]">{formatDateTime(item.applicationDeadline)}</p>
          <p className="mt-0.5 text-[#64748B]">
            {item.requiredHours !== null ? `${item.requiredHours.toFixed(2)} hrs` : 'Hours open'}
          </p>
        </div>
      ),
    },
    {
      key: 'capacity',
      header: 'Capacity',
      render: (item) => (
        <div className="font-mono text-xs tabular-nums">
          {item.capacity !== null ? (
            <>
              <span className="font-semibold text-[#12345A]">
                {item.approvedCount}/{item.capacity}
              </span>
              <span className="block text-[11px] text-[#64748B]">
                {item.remainingCapacity} left
              </span>
            </>
          ) : (
            <span className="text-[#64748B]">Unlimited</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => {
        const meta = getTaskStatusMeta(item.status);
        return <StatusBadge tone={meta.tone} label={meta.label} />;
      },
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
            icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openDetailModal(item)}
          >
            Sessions
          </Button>
          {item.status !== 'archived' ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void openEditTaskModal(item)}
            >
              Edit
            </Button>
          ) : null}
          {item.status === 'draft' ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => openStatusModal(item, 'published')}
            >
              Publish
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => openStatusModal(item)}
            >
              Status
            </Button>
          )}
        </div>
      ),
    },
  ];

  const categoryColumns: Array<TableColumn<TaskCategoryRecord>> = [
    {
      key: 'name',
      header: 'Category Name',
      render: (item) => <span className="font-semibold text-[#1E293B]">{item.name}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      render: (item) => (
        <span className="text-xs text-[#64748B]">{item.description ?? '—'}</span>
      ),
    },
    {
      key: 'taskCount',
      header: 'Linked Tasks',
      render: (item) => (
        <span className="font-mono text-xs font-medium text-[#12345A] tabular-nums">
          {item.taskCount}
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
          <StatusBadge tone="neutral" label="Disabled" />
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
            onClick={() => openEditCategoryModal(item)}
          >
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleToggleCategoryActive(item)}
          >
            {item.isActive ? 'Disable' : 'Enable'}
          </Button>
        </div>
      ),
    },
  ];

  const estimatedSelectedSectionStudents = useMemo(() => {
    const selectedSet = new Set(taskForm.targetSectionIds);
    return sections
      .filter((s) => selectedSet.has(s.id))
      .reduce((acc, s) => acc + s.currentStudentCount, 0);
  }, [sections, taskForm.targetSectionIds]);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'RSS Coordinator', 'Tasks & Activities']}
        title="RSS Task Management"
        description="Create task categories, configure draft and published RSS tasks with audience targeting, manage participant capacity, and schedule task sessions."
        actions={
          <>
            {isAuthenticated ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  loading={loading}
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void loadTasksAndRefs()}
                >
                  Refresh
                </Button>
                {activeTab === 'categories' ? (
                  <Button
                    variant="primary"
                    size="md"
                    icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                    onClick={openCreateCategoryModal}
                  >
                    New Category
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                    onClick={openCreateTaskModal}
                  >
                    New RSS Task
                  </Button>
                )}
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
                Sign in as an RSS Coordinator with PostgreSQL connected to manage task categories, tasks, targeting rules, and sessions.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Segmented Module Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Task management sections"
          className="inline-flex rounded-lg border border-[#E2E8F0] bg-white p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tasks'}
            onClick={() => setActiveTab('tasks')}
            className={`inline-flex min-h-9 items-center gap-2 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'tasks'
                ? 'bg-[#12345A] text-white'
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
            <span>RSS Tasks ({tasksData.total})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'categories'}
            onClick={() => setActiveTab('categories')}
            className={`inline-flex min-h-9 items-center gap-2 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'categories'
                ? 'bg-[#12345A] text-white'
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            <Tag className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Task Categories ({categories.length})</span>
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Overall participant capacity is enforced on <code className="font-mono text-[#12345A]">tasks.capacity</code>, while <code className="font-mono text-[#12345A]">task_sessions</code> manages scheduled dates, times, and locations linked directly to Student Applications, Attendance, Service Hours, Accomplishments, and PDF Reports.
        </span>
      </div>

      {isAuthenticated && activeCategories.length === 0 && !loading ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            <span>
              No active task categories exist yet. Create at least one task category before creating or publishing RSS tasks.
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={openCreateCategoryModal}>
            Create Category
          </Button>
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

      {activeTab === 'tasks' ? (
        <DataTable
          columns={taskColumns}
          rows={tasksData.tasks}
          rowKey={(row) => String(row.id)}
          loading={loading}
          searchValue={taskSearch}
          onSearchChange={(val) => {
            setTaskSearch(val);
            setTaskPage(1);
          }}
          searchPlaceholder="Search tasks by title, category, or location..."
          page={tasksData.page}
          totalPages={tasksData.totalPages}
          onPageChange={setTaskPage}
          toolbarExtra={
            <div className="flex flex-wrap items-center gap-2">
              <SelectInput
                aria-label="Filter by task status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setTaskPage(1);
                }}
                className="w-auto min-w-[135px]"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="archived">Archived</option>
              </SelectInput>

              <SelectInput
                aria-label="Filter by task category"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setTaskPage(1);
                }}
                className="w-auto min-w-[155px]"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={String(cat.id)}>
                    {cat.name}
                  </option>
                ))}
              </SelectInput>

              <SelectInput
                aria-label="Filter by visibility scope"
                value={visibilityFilter}
                onChange={(e) => {
                  setVisibilityFilter(e.target.value);
                  setTaskPage(1);
                }}
                className="w-auto min-w-[155px]"
              >
                <option value="all">All Visibility</option>
                <option value="all_students">All Eligible Students</option>
                <option value="specific_sections">Specific Sections</option>
                <option value="selected_students">Selected Students</option>
              </SelectInput>

              <SelectInput
                aria-label="Sort tasks"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setTaskPage(1);
                }}
                className="w-auto min-w-[160px]"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="deadline_asc">Sort: Earliest Deadline</option>
                <option value="deadline_desc">Sort: Latest Deadline</option>
                <option value="activity_asc">Sort: Activity Start</option>
                <option value="title_asc">Sort: Title (A–Z)</option>
              </SelectInput>
            </div>
          }
          emptyTitle="No RSS tasks created yet"
          emptyDescription={
            isAuthenticated
              ? 'Create a task category and draft or publish your first College of Technology RSS task.'
              : 'RSS task records load once an RSS Coordinator signs in.'
          }
          emptyAction={
            isAuthenticated ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={openCreateTaskModal}
              >
                New RSS Task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={categoryColumns}
          rows={paginatedCategories}
          rowKey={(row) => String(row.id)}
          loading={loading}
          searchValue={catSearch}
          onSearchChange={(val) => {
            setCatSearch(val);
            setCatPage(1);
          }}
          searchPlaceholder="Search task categories..."
          page={safeCatPage}
          totalPages={catTotalPages}
          onPageChange={setCatPage}
          emptyTitle="No task categories defined yet"
          emptyDescription={
            isAuthenticated
              ? 'Create institutional RSS task categories (e.g., Campus Service, Technical Support, Community Outreach) before creating tasks.'
              : 'Task categories load once an RSS Coordinator signs in.'
          }
          emptyAction={
            isAuthenticated ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={openCreateCategoryModal}
              >
                Create Category
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Task Category Create/Edit Modal */}
      <Modal
        open={catModalOpen}
        onClose={() => {
          if (!savingCat) {
            setCatModalOpen(false);
          }
        }}
        title={
          editingCategory ? `Edit Category — ${editingCategory.name}` : 'Create Task Category'
        }
        description="Categories classify RSS tasks and control active selection availability."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={savingCat}
              onClick={() => setCatModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="task-category-form"
              variant="primary"
              size="sm"
              loading={savingCat}
            >
              {editingCategory ? 'Save Category' : 'Create Category'}
            </Button>
          </div>
        }
      >
        <form
          id="task-category-form"
          onSubmit={(e) => void handleCategorySubmit(e)}
          className="space-y-4"
        >
          {catFormError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {catFormError}
            </div>
          ) : null}

          <FormField id="cat-name" label="Category Name" required>
            <TextInput
              id="cat-name"
              value={catForm.name}
              onChange={(e) => setCatForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Technical Support & Lab Assistance"
              maxLength={100}
              disabled={savingCat}
              required
            />
          </FormField>

          <FormField id="cat-desc" label="Description">
            <TextareaInput
              id="cat-desc"
              value={catForm.description}
              onChange={(e) => setCatForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional scope notes for this RSS task category..."
              maxLength={1000}
              disabled={savingCat}
            />
          </FormField>

          <label className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 text-sm text-[#1E293B] cursor-pointer">
            <input
              type="checkbox"
              checked={catForm.isActive}
              onChange={(e) => setCatForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              disabled={savingCat}
              className="mt-0.5 h-4 w-4 rounded border-[#E2E8F0] text-[#12345A] focus:ring-[#12345A]"
            />
            <span>
              <span className="font-medium">Active Category</span>
              <span className="block text-xs text-[#64748B]">
                Only active categories can be assigned to newly created or published tasks.
              </span>
            </span>
          </label>
        </form>
      </Modal>

      {/* Create / Edit RSS Task Modal */}
      <Modal
        open={taskModalOpen}
        onClose={() => {
          if (!savingTask) {
            setTaskModalOpen(false);
          }
        }}
        size="xl"
        title={editingTask ? `Edit RSS Task — ${editingTask.title}` : 'Create RSS Task'}
        description="Define task details, schedule windows, participant capacity, and student visibility targeting."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={savingTask}
              onClick={() => setTaskModalOpen(false)}
            >
              Cancel
            </Button>
            {editingTask ? (
              <Button
                variant="primary"
                size="sm"
                loading={savingTask}
                onClick={() => void submitTaskForm(false)}
              >
                Save Changes
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={savingTask}
                  onClick={() => void submitTaskForm(false)}
                >
                  Save as Draft
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingTask}
                  icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => void submitTaskForm(true)}
                >
                  Create &amp; Publish
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          {taskFormError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
            >
              {taskFormError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="task-college" label="College" required>
              <SelectInput
                id="task-college"
                value={taskForm.collegeId}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, collegeId: e.target.value }))}
                disabled={savingTask}
                required
              >
                <option value="">Select college...</option>
                {colleges.map((c) => (
                  <option
                    key={c.id}
                    value={String(c.id)}
                    disabled={!c.isActive && String(c.id) !== taskForm.collegeId}
                  >
                    {c.code} — {c.name}
                    {!c.isActive ? ' (Inactive)' : ''}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="task-category" className="block text-xs font-semibold text-[#1E293B]">
                  Task Category <span className="text-[#DC2626]">*</span>
                </label>
                <button
                  type="button"
                  disabled={savingTask || savingQuickCat}
                  onClick={() => {
                    setQuickCatOpen((v) => !v);
                    setQuickCatError(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#12345A] hover:underline cursor-pointer disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{quickCatOpen ? 'Close Quick Create' : 'Quick Create Category'}</span>
                </button>
              </div>
              <SelectInput
                id="task-category"
                value={taskForm.categoryId}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                disabled={savingTask}
                required
              >
                <option value="">
                  {activeCategories.length === 0
                    ? 'No active categories — use Quick Create below'
                    : 'Select category...'}
                </option>
                {categories.map((cat) => (
                  <option
                    key={cat.id}
                    value={String(cat.id)}
                    disabled={!cat.isActive && String(cat.id) !== taskForm.categoryId}
                  >
                    {cat.name}
                    {!cat.isActive ? ' (Disabled)' : ''}
                  </option>
                ))}
              </SelectInput>

              {activeCategories.length === 0 && !quickCatOpen ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                  <span>No active categories exist yet.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCatOpen(true);
                      setQuickCatError(null);
                    }}
                    className="font-semibold text-[#12345A] underline cursor-pointer shrink-0"
                  >
                    + Create Now
                  </button>
                </div>
              ) : null}

              {quickCatOpen ? (
                <div className="rounded-lg border border-[#12345A]/30 bg-[#F4F6FA] p-3 space-y-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#12345A]">
                    Inline New Task Category
                  </p>
                  {quickCatError ? (
                    <div
                      role="alert"
                      className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-900"
                    >
                      {quickCatError}
                    </div>
                  ) : null}
                  <TextInput
                    aria-label="Quick category name"
                    value={quickCatName}
                    onChange={(e) => setQuickCatName(e.target.value)}
                    placeholder="Category name (e.g. Technical Support)"
                    maxLength={100}
                    disabled={savingQuickCat}
                  />
                  <TextInput
                    aria-label="Quick category description"
                    value={quickCatDesc}
                    onChange={(e) => setQuickCatDesc(e.target.value)}
                    placeholder="Optional description..."
                    maxLength={1000}
                    disabled={savingQuickCat}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={savingQuickCat}
                      onClick={() => {
                        setQuickCatOpen(false);
                        setQuickCatError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={savingQuickCat}
                      onClick={() => void handleQuickCreateCategory()}
                    >
                      Save &amp; Select
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <FormField id="task-title" label="Task Title" required>
            <TextInput
              id="task-title"
              value={taskForm.title}
              onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. CT Computer Laboratory Maintenance & Inventory"
              maxLength={200}
              disabled={savingTask}
              required
            />
          </FormField>

          <FormField id="task-description" label="Task Description" required>
            <TextareaInput
              id="task-description"
              value={taskForm.description}
              onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Describe responsibilities, expectations, and deliverables for participating students..."
              maxLength={5000}
              disabled={savingTask}
              required
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField id="task-location" label="Primary Location">
              <TextInput
                id="task-location"
                value={taskForm.location}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, location: e.target.value }))}
                placeholder="e.g. CT Building, Room 302"
                maxLength={255}
                disabled={savingTask}
              />
            </FormField>

            <FormField
              id="task-capacity"
              label="Participant Capacity"
              hint="Leave blank for unlimited slots"
            >
              <TextInput
                id="task-capacity"
                type="number"
                min={1}
                step={1}
                value={taskForm.capacity}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, capacity: e.target.value }))}
                placeholder="e.g. 20"
                disabled={savingTask}
              />
            </FormField>

            <FormField
              id="task-hours"
              label="Required Hours"
              hint="Expected credited RSS hours"
            >
              <TextInput
                id="task-hours"
                type="number"
                min={0}
                step={0.25}
                value={taskForm.requiredHours}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, requiredHours: e.target.value }))}
                placeholder="e.g. 4.00"
                disabled={savingTask}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="task-app-start" label="Application Start">
              <TextInput
                id="task-app-start"
                type="datetime-local"
                value={taskForm.applicationStart}
                onChange={(e) =>
                  setTaskForm((prev) => ({ ...prev, applicationStart: e.target.value }))
                }
                disabled={savingTask}
              />
            </FormField>
            <FormField id="task-app-deadline" label="Application Deadline">
              <TextInput
                id="task-app-deadline"
                type="datetime-local"
                value={taskForm.applicationDeadline}
                onChange={(e) =>
                  setTaskForm((prev) => ({ ...prev, applicationDeadline: e.target.value }))
                }
                disabled={savingTask}
              />
            </FormField>
            <FormField id="task-act-start" label="Activity Start">
              <TextInput
                id="task-act-start"
                type="datetime-local"
                value={taskForm.activityStart}
                onChange={(e) =>
                  setTaskForm((prev) => ({ ...prev, activityStart: e.target.value }))
                }
                disabled={savingTask}
              />
            </FormField>
            <FormField id="task-act-end" label="Activity End">
              <TextInput
                id="task-act-end"
                type="datetime-local"
                value={taskForm.activityEnd}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, activityEnd: e.target.value }))}
                disabled={savingTask}
              />
            </FormField>
          </div>

          {/* Visibility & Audience Targeting */}
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-[#1E293B]">
                Visibility &amp; Target Audience
              </p>
              <p className="text-xs text-[#64748B]">
                Controls which approved students can view and discover this task once published.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    id: 'all_students',
                    title: 'All Eligible Students',
                    desc: 'Visible to all active approved students in the selected college.',
                  },
                  {
                    id: 'specific_sections',
                    title: 'Specific Sections',
                    desc: 'Visible only to students currently assigned to selected sections.',
                  },
                  {
                    id: 'selected_students',
                    title: 'Selected Students',
                    desc: 'Visible only to explicitly selected individual student records.',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={savingTask}
                  onClick={() => setTaskForm((prev) => ({ ...prev, visibility: opt.id }))}
                  className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                    taskForm.visibility === opt.id
                      ? 'border-[#12345A] bg-white ring-2 ring-[#12345A]/15'
                      : 'border-[#E2E8F0] bg-white/60 hover:bg-white'
                  }`}
                >
                  <p className="text-xs font-semibold text-[#12345A]">{opt.title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-[#64748B]">{opt.desc}</p>
                </button>
              ))}
            </div>

            {taskForm.visibility === 'specific_sections' ? (
              <div className="rounded-lg border border-[#E2E8F0] bg-white p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1E293B]">
                    Select Target Sections ({taskForm.targetSectionIds.length} selected · ~{estimatedSelectedSectionStudents} current students)
                  </span>
                  <div className="relative w-full sm:w-56">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={sectionPickerSearch}
                      onChange={(e) => setSectionPickerSearch(e.target.value)}
                      placeholder="Filter sections..."
                      className="h-8 w-full rounded-md border border-[#E2E8F0] pl-8 pr-2 text-xs text-[#1E293B] focus:border-[#12345A] focus:outline-none"
                    />
                  </div>
                </div>

                {activeSections.length === 0 ? (
                  <p className="py-3 text-center text-xs text-amber-800">
                    No active sections exist yet. Create sections under Academic Management before targeting specific sections.
                  </p>
                ) : filteredPickerSections.length === 0 ? (
                  <p className="py-3 text-center text-xs text-[#64748B]">
                    No active sections matched your filter.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto divide-y divide-[#E2E8F0] rounded-md border border-[#E2E8F0]">
                    {filteredPickerSections.map((sec) => {
                      const checked = taskForm.targetSectionIds.includes(sec.id);
                      return (
                        <label
                          key={sec.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-[#F4F6FA] cursor-pointer"
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSectionTarget(sec.id)}
                              className="h-4 w-4 rounded border-[#E2E8F0] text-[#12345A]"
                            />
                            <span className="font-medium text-[#1E293B] truncate">
                              {sec.programCode} · {sec.yearLevelName} — {sec.name}
                            </span>
                          </span>
                          <span className="font-mono text-[11px] text-[#64748B] tabular-nums shrink-0">
                            {sec.currentStudentCount} student{sec.currentStudentCount === 1 ? '' : 's'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {taskForm.visibility === 'selected_students' ? (
              <div className="rounded-lg border border-[#E2E8F0] bg-white p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1E293B]">
                    Select Individual Approved Students ({taskForm.targetStudentIds.length} selected)
                  </span>
                  <div className="relative w-full sm:w-64">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={studentPickerSearch}
                      onChange={(e) => setStudentPickerSearch(e.target.value)}
                      placeholder="Search by student no. or name..."
                      className="h-8 w-full rounded-md border border-[#E2E8F0] pl-8 pr-2 text-xs text-[#1E293B] focus:border-[#12345A] focus:outline-none"
                    />
                  </div>
                </div>

                {taskForm.targetStudentIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 rounded-md border border-[#E2E8F0] bg-[#F4F6FA] p-2">
                    {taskForm.targetStudentIds.map((stuId) => {
                      const meta = pickedStudentsMap[stuId];
                      return (
                        <span
                          key={stuId}
                          className="inline-flex items-center gap-1.5 rounded border border-[#12345A]/20 bg-white px-2 py-1 text-[11px] font-medium text-[#12345A]"
                        >
                          <span>
                            {meta ? `${meta.studentNumber} — ${meta.fullName}` : `Student #${stuId}`}
                          </span>
                          <button
                            type="button"
                            aria-label="Remove targeted student"
                            onClick={() => toggleStudentTarget(stuId)}
                            className="text-[#64748B] hover:text-red-700 cursor-pointer"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {studentPickerLoading ? (
                  <p className="py-3 text-center text-xs text-[#64748B]">
                    Searching approved active students...
                  </p>
                ) : studentPickerResults.length === 0 ? (
                  <p className="py-3 text-center text-xs text-[#64748B]">
                    {studentPickerSearch.trim()
                      ? 'No active approved students matched your search.'
                      : 'No approved active students exist yet. Register or approve students first.'}
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto divide-y divide-[#E2E8F0] rounded-md border border-[#E2E8F0]">
                    {studentPickerResults.map((stu) => {
                      const checked = taskForm.targetStudentIds.includes(stu.studentId);
                      return (
                        <label
                          key={stu.studentId}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-[#F4F6FA] cursor-pointer"
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleStudentTarget(stu.studentId)}
                              className="h-4 w-4 rounded border-[#E2E8F0] text-[#12345A]"
                            />
                            <span className="font-mono text-[#12345A] shrink-0">
                              {stu.studentNumber}
                            </span>
                            <span className="font-medium text-[#1E293B] truncate">
                              {stu.fullName}
                            </span>
                          </span>
                          <span className="text-[11px] text-[#64748B] shrink-0">
                            {stu.currentSection
                              ? `${stu.currentSection.programCode} ${stu.currentSection.sectionName}`
                              : 'Unassigned'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#64748B]">
              <strong className="text-[#12345A]">Target Audience Review:</strong>{' '}
              {taskForm.visibility === 'all_students'
                ? 'All active approved students in the selected college will see this task once published.'
                : taskForm.visibility === 'specific_sections'
                  ? `${taskForm.targetSectionIds.length} target section(s) selected (~${estimatedSelectedSectionStudents} current students).`
                  : `${taskForm.targetStudentIds.length} individual approved student(s) targeted.`}
            </div>
          </div>
        </div>
      </Modal>

      {/* Task Status Transition Confirmation Modal */}
      <Modal
        open={Boolean(statusModalTask)}
        onClose={() => {
          if (!updatingStatus) {
            setStatusModalTask(null);
          }
        }}
        title={statusModalTask ? `Update Task Status — ${statusModalTask.title}` : 'Update Task Status'}
        description={
          statusModalTask
            ? `Current status: ${getTaskStatusMeta(statusModalTask.status).label}`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={updatingStatus}
              onClick={() => setStatusModalTask(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={updatingStatus}
              onClick={() => void handleStatusConfirm()}
            >
              Confirm Status Change
            </Button>
          </div>
        }
      >
        {statusModalTask ? (
          <div className="space-y-4">
            {statusError ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
              >
                {statusError}
              </div>
            ) : null}

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 text-xs text-[#64748B] space-y-1">
              <p>
                <strong className="text-[#1E293B]">Visibility:</strong>{' '}
                {formatVisibilitySummary(statusModalTask)}
              </p>
              <p>
                <strong className="text-[#1E293B]">Applications:</strong>{' '}
                {statusModalTask.approvedCount} approved · {statusModalTask.pendingCount} pending
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#1E293B]">Select Target Status</p>
              {ALLOWED_STATUS_OPTIONS[statusModalTask.status].map((opt) => (
                <label
                  key={opt.status}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs cursor-pointer ${
                    selectedNextStatus === opt.status
                      ? 'border-[#12345A] bg-blue-50/40'
                      : 'border-[#E2E8F0] bg-white hover:bg-[#F4F6FA]'
                  }`}
                >
                  <input
                    type="radio"
                    name="next-task-status"
                    checked={selectedNextStatus === opt.status}
                    onChange={() => setSelectedNextStatus(opt.status)}
                    className="mt-0.5 h-4 w-4 text-[#12345A]"
                  />
                  <span>
                    <span className="font-semibold text-[#1E293B]">{opt.label}</span>
                    <span className="mt-0.5 block text-[#64748B]">{opt.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Task Details & Sessions Management Modal */}
      <Modal
        open={detailTaskId !== null}
        onClose={() => {
          setDetailTaskId(null);
          setTaskDetail(null);
          setSessionFormOpen(false);
          setConfirmDeleteSession(null);
        }}
        size="xl"
        title={taskDetail ? `Task Overview & Sessions — ${taskDetail.title}` : 'Task Overview'}
        description={
          taskDetail
            ? `${taskDetail.categoryName} · ${taskDetail.collegeName} (${taskDetail.collegeCode})`
            : undefined
        }
        footer={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDetailTaskId(null);
              setTaskDetail(null);
            }}
          >
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <p className="py-8 text-center text-sm text-[#64748B]">Loading task details and sessions...</p>
        ) : detailError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
          >
            {detailError}
          </div>
        ) : taskDetail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={getTaskStatusMeta(taskDetail.status).tone}
                  label={getTaskStatusMeta(taskDetail.status).label}
                />
                <StatusBadge tone="info" label={formatVisibilitySummary(taskDetail)} />
                <StatusBadge
                  tone="neutral"
                  label={`${taskDetail.eligibleStudentCount} Eligible Student${taskDetail.eligibleStudentCount === 1 ? '' : 's'}`}
                />
              </div>

              {taskDetail.status !== 'archived' ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void openEditTaskModal(taskDetail)}
                  >
                    Edit Task
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openStatusModal(taskDetail)}
                  >
                    Change Status
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-4 space-y-2">
              <p className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                Description &amp; Metadata
              </p>
              <p className="whitespace-pre-line text-sm text-[#1E293B]">{taskDetail.description}</p>
              <div className="grid grid-cols-1 gap-2 pt-2 text-xs text-[#64748B] sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="font-semibold text-[#1E293B]">Location:</span>{' '}
                  {taskDetail.location ?? '—'}
                </div>
                <div className="tabular-nums">
                  <span className="font-semibold text-[#1E293B]">Required Hours:</span>{' '}
                  {taskDetail.requiredHours !== null ? `${taskDetail.requiredHours.toFixed(2)} hrs` : '—'}
                </div>
                <div className="tabular-nums">
                  <span className="font-semibold text-[#1E293B]">Capacity:</span>{' '}
                  {taskDetail.capacity !== null
                    ? `${taskDetail.approvedCount}/${taskDetail.capacity} (${taskDetail.remainingCapacity} left)`
                    : 'Unlimited'}
                </div>
                <div className="tabular-nums">
                  <span className="font-semibold text-[#1E293B]">Deadline:</span>{' '}
                  {formatDateTime(taskDetail.applicationDeadline)}
                </div>
              </div>
            </div>

            {/* Target Recipients Breakdown */}
            {taskDetail.visibility === 'specific_sections' ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                  Targeted Sections ({taskDetail.targetSections.length})
                </h3>
                {taskDetail.targetSections.length === 0 ? (
                  <p className="text-xs text-amber-800">
                    No target sections configured yet. Edit this task to assign sections.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {taskDetail.targetSections.map((sec) => (
                      <span
                        key={sec.sectionId}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-[#F4F6FA] px-2.5 py-1 text-xs font-medium text-[#12345A]"
                      >
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {sec.programCode} · {sec.yearLevelName} — {sec.sectionName} ({sec.currentStudentCount})
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : taskDetail.visibility === 'selected_students' ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                  Targeted Students ({taskDetail.targetStudents.length})
                </h3>
                {taskDetail.targetStudents.length === 0 ? (
                  <p className="text-xs text-amber-800">
                    No individual students targeted yet. Edit this task to assign students.
                  </p>
                ) : (
                  <div className="max-h-36 overflow-y-auto divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                    {taskDetail.targetStudents.map((stu) => (
                      <div
                        key={stu.studentId}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-[#1E293B]">
                          <span className="font-mono text-[#12345A] mr-2">{stu.studentNumber}</span>
                          {stu.fullName}
                        </span>
                        <span className="text-[#64748B]">{stu.sectionLabel ?? 'Unassigned'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* Task Sessions Management */}
            <div className="space-y-3 border-t border-[#E2E8F0] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#1E293B]">
                    Scheduled Task Sessions ({taskDetail.sessions.length})
                  </h3>
                  <p className="text-xs text-[#64748B]">
                    Sessions define specific dates, time ranges, and venues for student attendance recording and verification.
                  </p>
                </div>
                {taskDetail.status !== 'archived' && !sessionFormOpen ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={openCreateSessionForm}
                  >
                    Add Session
                  </Button>
                ) : null}
              </div>

              {sessionError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
                >
                  {sessionError}
                </div>
              ) : null}

              {confirmDeleteSession ? (
                <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-950 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Delete session <strong>{confirmDeleteSession.sessionTitle}</strong> ({confirmDeleteSession.sessionDate})?
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={deletingSession}
                      onClick={() => setConfirmDeleteSession(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingSession}
                      onClick={() => void handleDeleteSession()}
                    >
                      Confirm Delete
                    </Button>
                  </div>
                </div>
              ) : null}

              {sessionFormOpen ? (
                <form
                  onSubmit={(e) => void handleSessionSubmit(e)}
                  className="rounded-lg border border-[#12345A]/30 bg-[#F4F6FA] p-4 space-y-3"
                >
                  <p className="text-xs font-semibold text-[#12345A]">
                    {editingSession ? `Edit Session — ${editingSession.sessionTitle}` : 'New Task Session'}
                  </p>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField id="sess-title" label="Session Title" required>
                      <TextInput
                        id="sess-title"
                        value={sessionForm.sessionTitle}
                        onChange={(e) =>
                          setSessionForm((prev) => ({ ...prev, sessionTitle: e.target.value }))
                        }
                        placeholder="e.g. Morning Orientation & Setup"
                        maxLength={150}
                        disabled={savingSession}
                        required
                      />
                    </FormField>

                    <FormField id="sess-location" label="Session Location" required>
                      <TextInput
                        id="sess-location"
                        value={sessionForm.location}
                        onChange={(e) =>
                          setSessionForm((prev) => ({ ...prev, location: e.target.value }))
                        }
                        placeholder="e.g. CT Computer Lab 2"
                        maxLength={255}
                        disabled={savingSession}
                        required
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <FormField id="sess-date" label="Session Date" required>
                      <TextInput
                        id="sess-date"
                        type="date"
                        value={sessionForm.sessionDate}
                        onChange={(e) =>
                          setSessionForm((prev) => ({ ...prev, sessionDate: e.target.value }))
                        }
                        disabled={savingSession}
                        required
                      />
                    </FormField>
                    <FormField id="sess-start" label="Start Time" required>
                      <TextInput
                        id="sess-start"
                        type="time"
                        value={sessionForm.startTime}
                        onChange={(e) =>
                          setSessionForm((prev) => ({ ...prev, startTime: e.target.value }))
                        }
                        disabled={savingSession}
                        required
                      />
                    </FormField>
                    <FormField id="sess-end" label="End Time" required>
                      <TextInput
                        id="sess-end"
                        type="time"
                        value={sessionForm.endTime}
                        onChange={(e) =>
                          setSessionForm((prev) => ({ ...prev, endTime: e.target.value }))
                        }
                        disabled={savingSession}
                        required
                      />
                    </FormField>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={savingSession}
                      onClick={() => {
                        setSessionFormOpen(false);
                        setEditingSession(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" loading={savingSession}>
                      {editingSession ? 'Save Session' : 'Add Session'}
                    </Button>
                  </div>
                </form>
              ) : null}

              {taskDetail.sessions.length === 0 ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-6 text-center text-xs text-[#64748B]">
                  No sessions scheduled yet for this task. Click &ldquo;Add Session&rdquo; to configure dates and time windows.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {taskDetail.sessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1E293B]">{sess.sessionTitle}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748B]">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
                            {sess.sessionDate}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                            <Clock className="h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
                            {sess.startTime} – {sess.endTime}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-[#12345A]" aria-hidden="true" />
                            {sess.location}
                          </span>
                        </p>
                      </div>

                      {taskDetail.status !== 'archived' ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() => openEditSessionForm(sess)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={sess.attendanceCount > 0}
                            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() => setConfirmDeleteSession(sess)}
                          >
                            Delete
                          </Button>
                        </div>
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
