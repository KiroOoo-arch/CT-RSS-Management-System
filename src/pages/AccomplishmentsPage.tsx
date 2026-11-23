import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FilePlus2,
  ImagePlus,
  Info,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPost } from '../services/apiClient.ts';
import type {
  AccomplishmentDetailRecord,
  AccomplishmentRecord,
  AccomplishmentStatus,
  EvidenceImageCategory,
  TaskApplicationRecord,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
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

interface AccomplishmentsPageProps {
  mode: 'coordinator' | 'student';
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

interface PendingUploadImage {
  localId: string;
  originalFilename: string;
  mimeType: string;
  dataBase64: string;
  imageCategory: EvidenceImageCategory;
  caption: string;
}

function renderStatusBadge(status: AccomplishmentStatus) {
  switch (status) {
    case 'approved':
      return <StatusBadge tone="success" label="Approved" />;
    case 'submitted':
      return <StatusBadge tone="info" label="Submitted for Review" />;
    case 'revision_required':
      return <StatusBadge tone="orange" label="Revision Required" />;
    case 'rejected':
      return <StatusBadge tone="danger" label="Rejected" />;
    default:
      return <StatusBadge tone="neutral" label="Draft" />;
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export function AccomplishmentsPage({
  mode,
  isAuthenticated,
  onReturnToOverview,
}: AccomplishmentsPageProps) {
  const isCoordinator = mode === 'coordinator';

  const [accomplishments, setAccomplishments] = useState<AccomplishmentRecord[]>([]);
  const [allStudentAccomplishments, setAllStudentAccomplishments] = useState<AccomplishmentRecord[]>([]);
  const [approvedApplications, setApprovedApplications] = useState<TaskApplicationRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AccomplishmentStatus>('all');

  // Detail modal
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AccomplishmentDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Coordinator review state
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Student submission / draft modal
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [subApplicationId, setSubApplicationId] = useState('');
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [studentRemarks, setStudentRemarks] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingUploadImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creatingDraftAppId, setCreatingDraftAppId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setAccomplishments([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (isCoordinator && search.trim()) {
        params.set('search', search.trim());
      }
      const qs = params.toString();

      if (isCoordinator) {
        const res = await apiGet<{ accomplishments: AccomplishmentRecord[] }>(
          `/api/v1/coordinator/accomplishments${qs ? `?${qs}` : ''}`,
        );
        setAccomplishments(res.accomplishments);
      } else {
        const [accRes, allAccRes, appRes] = await Promise.all([
          apiGet<{ accomplishments: AccomplishmentRecord[] }>(
            `/api/v1/student/accomplishments${qs ? `?${qs}` : ''}`,
          ),
          statusFilter !== 'all'
            ? apiGet<{ accomplishments: AccomplishmentRecord[] }>('/api/v1/student/accomplishments')
            : Promise.resolve(null),
          apiGet<{ applications: TaskApplicationRecord[] }>(
            '/api/v1/student/applications?status=approved',
          ),
        ]);
        const q = search.trim().toLowerCase();
        const filtered = q
          ? accRes.accomplishments.filter(
              (a) =>
                a.taskTitle.toLowerCase().includes(q) ||
                a.categoryName.toLowerCase().includes(q),
            )
          : accRes.accomplishments;
        setAccomplishments(filtered);
        setAllStudentAccomplishments(allAccRes ? allAccRes.accomplishments : accRes.accomplishments);
        setApprovedApplications(appRes.applications);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load accomplishments from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoordinator, statusFilter, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openDetailModal = async (accomplishmentId: number) => {
    setSelectedId(accomplishmentId);
    setDetail(null);
    setDetailError(null);
    setReviewError(null);
    setReviewRemarks('');
    setDetailLoading(true);
    try {
      const endpoint = isCoordinator
        ? `/api/v1/coordinator/accomplishments/${accomplishmentId}`
        : `/api/v1/student/accomplishments/${accomplishmentId}`;
      const res = await apiGet<{ accomplishment: AccomplishmentDetailRecord }>(endpoint);
      setDetail(res.accomplishment);
    } catch (err) {
      setDetailError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load accomplishment submissions and evidence images.',
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const handleInitDraft = async (applicationId: number) => {
    setCreatingDraftAppId(applicationId);
    setError(null);
    try {
      const res = await apiPost<{ accomplishment: AccomplishmentDetailRecord }>(
        '/api/v1/student/accomplishments/draft',
        { applicationId },
      );
      setFeedback(`Accomplishment draft initialized for "${res.accomplishment.taskTitle}".`);
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to initialize accomplishment draft.',
      );
    } finally {
      setCreatingDraftAppId(null);
    }
  };

  const isSubmittableStatus = (status?: AccomplishmentStatus): boolean =>
    !status || status === 'draft' || status === 'revision_required';

  const getAccomplishmentForApp = (appId: number): AccomplishmentRecord | undefined =>
    allStudentAccomplishments.find((a) => a.applicationId === appId);

  const submittableApplications = approvedApplications.filter((app) =>
    isSubmittableStatus(getAccomplishmentForApp(app.id)?.status),
  );

  const openSubmitModal = (applicationId?: number) => {
    const defaultAppId = applicationId ?? submittableApplications[0]?.id ?? approvedApplications[0]?.id;
    setSubApplicationId(defaultAppId ? String(defaultAppId) : '');
    setActivityDate(new Date().toISOString().slice(0, 10));
    setDescription('');
    setStudentRemarks('');
    setPendingImages([]);
    setSubmitError(null);
    setSubmitModalOpen(true);
  };

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    setSubmitError(null);
    const availableSlots = 6 - pendingImages.length;
    if (availableSlots <= 0) {
      setSubmitError('A maximum of 6 evidence images can be attached per submission version.');
      return;
    }

    const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const nextUploads: PendingUploadImage[] = [];

    for (const file of files.slice(0, availableSlots)) {
      if (!acceptedTypes.has(file.type)) {
        setSubmitError('Only JPEG, PNG, and WEBP image files are accepted.');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setSubmitError(`"${file.name}" exceeds the 5 MiB per-image limit.`);
        continue;
      }
      try {
        const dataBase64 = await readFileAsBase64(file);
        nextUploads.push({
          localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          originalFilename: file.name,
          mimeType: file.type,
          dataBase64,
          imageCategory: 'during',
          caption: '',
        });
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to read image file.');
      }
    }

    if (nextUploads.length > 0) {
      setPendingImages((prev) => [...prev, ...nextUploads]);
    }
  };

  const handleSubmitAccomplishment = async () => {
    if (!subApplicationId) {
      setSubmitError('Select an approved task application.');
      return;
    }
    if (!activityDate) {
      setSubmitError('Activity date is required.');
      return;
    }
    if (description.trim().length < 10) {
      setSubmitError('Accomplishment description must be at least 10 characters.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiPost<{ accomplishment: AccomplishmentDetailRecord }>(
        '/api/v1/student/accomplishments/submit',
        {
          applicationId: Number(subApplicationId),
          activityDate,
          accomplishmentDescription: description.trim(),
          studentRemarks: studentRemarks.trim() || undefined,
          evidenceImages: pendingImages.map((img) => ({
            originalFilename: img.originalFilename,
            mimeType: img.mimeType,
            dataBase64: img.dataBase64,
            imageCategory: img.imageCategory,
            caption: img.caption.trim() || undefined,
          })),
        },
      );
      setFeedback(
        `Accomplishment Version ${res.accomplishment.latestVersionNumber} submitted for "${res.accomplishment.taskTitle}".`,
      );
      setSubmitModalOpen(false);
      await loadData();
      if (selectedId === res.accomplishment.id) {
        await openDetailModal(res.accomplishment.id);
      }
    } catch (err) {
      setSubmitError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to submit accomplishment version.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCoordinatorReview = async (
    submissionId: number,
    decision: 'approved' | 'revision_required' | 'rejected',
  ) => {
    if ((decision === 'revision_required' || decision === 'rejected') && !reviewRemarks.trim()) {
      setReviewError('Remarks are required when requesting revision or rejecting a submission.');
      return;
    }
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await apiPost<{ accomplishment: AccomplishmentDetailRecord }>(
        `/api/v1/coordinator/accomplishments/submissions/${submissionId}/review`,
        {
          decision,
          remarks: reviewRemarks.trim() || undefined,
        },
      );
      setDetail(res.accomplishment);
      setReviewRemarks('');
      setFeedback(`Submission #${submissionId} marked as ${decision.replace('_', ' ')}.`);
      await loadData();
    } catch (err) {
      setReviewError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to submit accomplishment review.',
      );
    } finally {
      setReviewing(false);
    }
  };

  const columns: Array<TableColumn<AccomplishmentRecord>> = [
    ...(isCoordinator
      ? [
          {
            key: 'student',
            header: 'Student',
            render: (r: AccomplishmentRecord) => (
              <div className="min-w-[160px]">
                <p className="font-semibold text-[#1E293B]">{r.studentName}</p>
                <p className="font-mono text-xs text-[#64748B] tabular-nums">
                  {r.studentNumber} · {r.sectionLabel ?? 'Unassigned'}
                </p>
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'task',
      header: 'RSS Task & Version',
      render: (r) => (
        <div className="min-w-[200px]">
          <p className="font-semibold text-[#1E293B]">{r.taskTitle}</p>
          <p className="text-xs text-[#64748B] tabular-nums">
            {r.categoryName} · {r.submissionCount} version(s) · {r.evidenceCount} evidence photo(s)
          </p>
        </div>
      ),
    },
    {
      key: 'hours',
      header: 'Verified Hrs',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.verifiedHoursForTask.toFixed(2)}h
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => renderStatusBadge(r.status),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (r) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => void openDetailModal(r.id)}
          >
            {isCoordinator ? 'Review' : 'History'}
          </Button>
          {!isCoordinator &&
          (r.status === 'draft' || r.status === 'revision_required') ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openSubmitModal(r.applicationId)}
            >
              {r.status === 'revision_required' ? 'Resubmit' : 'Submit'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const latestSubmission = detail?.submissions[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          'Lapu-Lapu City College',
          isCoordinator ? 'RSS Operations' : 'RSS Participation',
          'Accomplishments',
        ]}
        title={isCoordinator ? 'Accomplishment Reviews & Evidence' : 'My Accomplishments & Evidence'}
        description={
          isCoordinator
            ? 'Review immutable versioned student accomplishment submissions and categorized photo evidence.'
            : 'Initialize drafts, upload categorized evidence images, submit immutable versions, and track Coordinator reviews.'
        }
        actions={
          <>
            {!isCoordinator && isAuthenticated ? (
              <Button
                variant="primary"
                size="md"
                disabled={submittableApplications.length === 0}
                icon={<Send className="h-4 w-4" aria-hidden="true" />}
                onClick={() => openSubmitModal()}
              >
                Submit Accomplishment
              </Button>
            ) : null}
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadData()}
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
                Sign in to manage accomplishment drafts, evidence photos, and Coordinator reviews.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Submitted accomplishment versions (<code className="font-mono">accomplishment_submissions</code>) are immutable once submitted. Revisions create a new numbered version while preserving prior versions and protected photo evidence (<strong className="text-[#1E293B]">before / during / after / other</strong>).
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

      {!isCoordinator && isAuthenticated && approvedApplications.length > 0 ? (
        <Card>
          <CardHeader
            title="Approved Tasks Ready for Accomplishment Reporting"
            description="Initialize a draft record in PostgreSQL or directly submit an accomplishment version with photo evidence."
          />
          <CardContent className="divide-y divide-[#E2E8F0] p-0">
            {approvedApplications.map((app) => {
              const existing = getAccomplishmentForApp(app.id);
              const locked = Boolean(existing && !isSubmittableStatus(existing.status));
              return (
                <div
                  key={app.id}
                  className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#1E293B]">{app.taskTitle}</p>
                    <p className="text-xs text-[#64748B]">
                      {app.categoryName} · {existing ? `Current status: ${existing.status.replace('_', ' ')}` : 'No draft yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!existing ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={creatingDraftAppId === app.id}
                        icon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={() => void handleInitDraft(app.id)}
                      >
                        Init Draft
                      </Button>
                    ) : null}
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={locked}
                      onClick={() => openSubmitModal(app.id)}
                    >
                      {existing?.status === 'revision_required'
                        ? 'Submit Revision'
                        : existing?.status === 'approved'
                          ? 'Approved'
                          : existing?.status === 'rejected'
                            ? 'Rejected'
                            : existing?.status === 'submitted'
                              ? 'Under Review'
                              : 'Submit Version'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={accomplishments}
        rowKey={(r) => String(r.id)}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={
          isCoordinator
            ? 'Search accomplishments by student or task...'
            : 'Search your accomplishments by task...'
        }
        toolbarExtra={
          <SelectInput
            aria-label="Filter by accomplishment status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | AccomplishmentStatus)}
            className="w-auto min-w-[170px]"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="revision_required">Revision Required</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </SelectInput>
        }
        emptyTitle="No accomplishments submitted"
        emptyDescription={
          isCoordinator
            ? 'Student accomplishment submissions and categorized evidence photos will appear here for review.'
            : 'Initialize a draft or submit an accomplishment version for any approved task above.'
        }
      />

      {/* Detail & Review Modal */}
      <Modal
        open={selectedId !== null}
        onClose={() => {
          setSelectedId(null);
          setDetail(null);
        }}
        size="xl"
        title={detail ? `${detail.taskTitle} — Accomplishment History` : 'Accomplishment Details'}
        description={
          detail
            ? `${detail.studentName} (${detail.studentNumber}) · ${detail.verifiedHoursForTask.toFixed(2)} verified task hours`
            : undefined
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex flex-wrap items-center gap-2">
              {isCoordinator && latestSubmission && detail?.status === 'submitted' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={reviewing}
                    icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleCoordinatorReview(latestSubmission.id, 'approved')}
                  >
                    Approve v{latestSubmission.versionNumber}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={reviewing}
                    icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() =>
                      void handleCoordinatorReview(latestSubmission.id, 'revision_required')
                    }
                  >
                    Request Revision
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={reviewing}
                    icon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleCoordinatorReview(latestSubmission.id, 'rejected')}
                  >
                    Reject
                  </Button>
                </>
              ) : null}
              {!isCoordinator &&
              detail &&
              (detail.status === 'draft' || detail.status === 'revision_required') ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openSubmitModal(detail.applicationId)}
                >
                  Submit New Version
                </Button>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
              }}
            >
              Close
            </Button>
          </div>
        }
      >
        {detailLoading ? (
          <p className="py-8 text-center text-sm text-[#64748B]">
            Loading submission versions and categorized evidence...
          </p>
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
              <StatusBadge tone="neutral" label={`${detail.submissions.length} Submission Version(s)`} />
            </div>

            {detail.coordinatorRemarks ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <span className="font-semibold">Latest Coordinator Remarks:</span>{' '}
                {detail.coordinatorRemarks}
              </div>
            ) : null}

            {isCoordinator && latestSubmission && detail.status === 'submitted' ? (
              <div className="rounded-lg border border-[#E2E8F0] p-4 space-y-3">
                {reviewError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
                  >
                    {reviewError}
                  </div>
                ) : null}
                <FormField
                  id="acc-review-remarks"
                  label={`Coordinator Review Remarks for Version ${latestSubmission.versionNumber} (Required for Revision/Rejection)`}
                >
                  <TextareaInput
                    id="acc-review-remarks"
                    rows={2}
                    value={reviewRemarks}
                    onChange={(e) => setReviewRemarks(e.target.value)}
                    placeholder="Provide feedback or approval comments..."
                  />
                </FormField>
              </div>
            ) : null}

            {detail.submissions.length === 0 ? (
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-6 text-center text-xs text-[#64748B]">
                This accomplishment is currently an empty draft without submitted versions yet.
              </div>
            ) : (
              <div className="space-y-4">
                {detail.submissions.map((sub) => (
                  <div key={sub.id} className="rounded-lg border border-[#E2E8F0] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-[#12345A] px-2 py-0.5 font-mono text-xs font-semibold text-white">
                          v{sub.versionNumber}
                        </span>
                        <span className="text-xs font-medium text-[#1E293B]">
                          Activity Date: {sub.activityDate}
                        </span>
                      </div>
                      <StatusBadge
                        tone={
                          sub.status === 'approved'
                            ? 'success'
                            : sub.status === 'revision_required'
                              ? 'orange'
                              : sub.status === 'rejected'
                                ? 'danger'
                                : 'info'
                        }
                        label={sub.status.replace('_', ' ')}
                      />
                    </div>

                    <p className="whitespace-pre-line text-sm text-[#1E293B]">
                      {sub.accomplishmentDescription}
                    </p>
                    {sub.studentRemarks ? (
                      <p className="text-xs text-[#64748B]">
                        <strong>Student Note:</strong> {sub.studentRemarks}
                      </p>
                    ) : null}

                    {sub.evidenceImages.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-[#64748B] uppercase">
                          Categorized Evidence Photos ({sub.evidenceImages.length})
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {sub.evidenceImages.map((img) => (
                            <div
                              key={img.id}
                              className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F4F6FA]"
                            >
                              <a
                                href={img.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block bg-white"
                              >
                                <img
                                  src={img.downloadUrl}
                                  alt={img.caption ?? img.originalFilename}
                                  className="h-36 w-full object-cover"
                                />
                              </a>
                              <div className="p-2 text-xs space-y-0.5">
                                <p className="font-semibold uppercase text-[#12345A]">
                                  {img.imageCategory}
                                </p>
                                <p className="truncate text-[#1E293B]">{img.originalFilename}</p>
                                {img.caption ? (
                                  <p className="text-[#64748B] line-clamp-2">{img.caption}</p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Submit Accomplishment Modal */}
      <Modal
        open={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        size="lg"
        title="Submit Accomplishment Version"
        description="Creates an immutable accomplishment submission linked to your approved RSS task."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSubmitModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              disabled={
                submittableApplications.length === 0 ||
                !submittableApplications.some((a) => String(a.id) === subApplicationId)
              }
              icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void handleSubmitAccomplishment()}
            >
              Submit Version
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {submitError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
            >
              {submitError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="sub-app" label="Approved RSS Task" required>
              <SelectInput
                id="sub-app"
                value={subApplicationId}
                onChange={(e) => setSubApplicationId(e.target.value)}
              >
                {approvedApplications.map((app) => {
                  const existing = getAccomplishmentForApp(app.id);
                  const locked = Boolean(existing && !isSubmittableStatus(existing.status));
                  const statusNote = existing
                    ? ` (${existing.status.replace('_', ' ')})`
                    : '';
                  return (
                    <option key={app.id} value={String(app.id)} disabled={locked}>
                      {app.taskTitle}
                      {statusNote}
                    </option>
                  );
                })}
              </SelectInput>
            </FormField>

            <FormField id="sub-date" label="Activity Date" required>
              <TextInput
                id="sub-date"
                type="date"
                value={activityDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setActivityDate(e.target.value)}
              />
            </FormField>
          </div>

          <FormField
            id="sub-desc"
            label="Accomplishment Description"
            hint="Describe duties completed, outcomes achieved, and service impact (min 10 chars)."
            required
          >
            <TextareaInput
              id="sub-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summarize your accomplished service tasks..."
            />
          </FormField>

          <FormField id="sub-remarks" label="Student Remarks (Optional)">
            <TextInput
              id="sub-remarks"
              value={studentRemarks}
              onChange={(e) => setStudentRemarks(e.target.value)}
              placeholder="Optional note for the RSS Coordinator..."
            />
          </FormField>

          <div className="space-y-3 rounded-lg border border-[#E2E8F0] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-[#1E293B] uppercase">
                  Categorized Evidence Images ({pendingImages.length}/6)
                </p>
                <p className="text-xs text-[#64748B]">
                  Accepted: JPEG, PNG, WEBP up to 5 MiB each. Stored securely outside public assets.
                </p>
              </div>
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-3 py-1.5 text-xs font-medium text-[#12345A] hover:bg-slate-200/70">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Photos</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => void handleImagePick(e)}
                  className="sr-only"
                />
              </label>
            </div>

            {pendingImages.length > 0 ? (
              <div className="space-y-2.5">
                {pendingImages.map((img) => (
                  <div
                    key={img.localId}
                    className="flex flex-col gap-2 rounded-md border border-[#E2E8F0] bg-[#F4F6FA] p-2.5 sm:flex-row sm:items-center"
                  >
                    <img
                      src={img.dataBase64}
                      alt={img.originalFilename}
                      className="h-14 w-14 rounded object-cover border border-[#E2E8F0] shrink-0"
                    />
                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                      <SelectInput
                        aria-label="Evidence category"
                        value={img.imageCategory}
                        onChange={(e) =>
                          setPendingImages((prev) =>
                            prev.map((p) =>
                              p.localId === img.localId
                                ? {
                                    ...p,
                                    imageCategory: e.target.value as EvidenceImageCategory,
                                  }
                                : p,
                            ),
                          )
                        }
                      >
                        <option value="before">Before</option>
                        <option value="during">During</option>
                        <option value="after">After</option>
                        <option value="other">Other</option>
                      </SelectInput>
                      <TextInput
                        aria-label="Photo caption"
                        placeholder="Caption (optional)"
                        value={img.caption}
                        onChange={(e) =>
                          setPendingImages((prev) =>
                            prev.map((p) =>
                              p.localId === img.localId ? { ...p, caption: e.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${img.originalFilename}`}
                      icon={<Trash2 className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />}
                      onClick={() =>
                        setPendingImages((prev) => prev.filter((p) => p.localId !== img.localId))
                      }
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
