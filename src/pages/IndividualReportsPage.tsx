import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileBarChart2,
  FilePlus2,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type {
  AcademicYearRecord,
  IndividualReportPreview,
  ReportStatus,
  ReportTemplateRecord,
  RssReportRecord,
  StudentDirectoryRecord,
  StudentListResponse,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, SelectInput, TextInput } from '../components/ui/FormField.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface IndividualReportsPageProps {
  mode: 'coordinator' | 'student';
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

function renderReportStatusBadge(status: ReportStatus) {
  switch (status) {
    case 'approved':
      return <StatusBadge tone="success" label="Approved" />;
    case 'archived':
      return <StatusBadge tone="neutral" label="Archived" />;
    default:
      return <StatusBadge tone="info" label="Generated" />;
  }
}

export function IndividualReportsPage({
  mode,
  isAuthenticated,
  onReturnToOverview,
}: IndividualReportsPageProps) {
  const isCoordinator = mode === 'coordinator';

  const [reports, setReports] = useState<RssReportRecord[]>([]);
  const [preview, setPreview] = useState<IndividualReportPreview | null>(null);
  const [students, setStudents] = useState<StudentDirectoryRecord[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [templates, setTemplates] = useState<ReportTemplateRecord[]>([]);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedAyId, setSelectedAyId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(isAuthenticated);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const defaultsInitializedRef = useRef(false);

  const loadInitialData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isCoordinator) {
        const [stuRes, ayRes, tplRes, repRes] = await Promise.all([
          apiGet<StudentListResponse>(
            '/api/v1/coordinator/students?registrationStatus=approved&page=1&pageSize=100',
          ),
          apiGet<{ academicYears: AcademicYearRecord[] }>('/api/v1/coordinator/academic-years'),
          apiGet<{ templates: ReportTemplateRecord[] }>('/api/v1/coordinator/report-templates'),
          apiGet<{ reports: RssReportRecord[] }>(
            '/api/v1/coordinator/reports?reportType=individual',
          ),
        ]);
        setStudents(stuRes.students);
        setAcademicYears(ayRes.academicYears);
        const activeTpls = tplRes.templates.filter(
          (t) => t.isActive && (t.config.reportType === 'both' || t.config.reportType === 'individual'),
        );
        setTemplates(activeTpls);
        setReports(repRes.reports);
        if (!defaultsInitializedRef.current) {
          defaultsInitializedRef.current = true;
          if (stuRes.students.length > 0) {
            setSelectedStudentId((prev) => prev || String(stuRes.students[0].studentId));
          }
          const currentAy = ayRes.academicYears.find((a) => a.isCurrent);
          if (currentAy) {
            setSelectedAyId((prev) => prev || String(currentAy.id));
          }
          if (activeTpls.length > 0) {
            setSelectedTemplateId((prev) => prev || String(activeTpls[0].id));
          }
        }
      } else {
        const res = await apiGet<{
          reports: RssReportRecord[];
          preview: IndividualReportPreview;
        }>('/api/v1/student/reports');
        setReports(res.reports);
        setPreview(res.preview);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load individual RSS report data.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoordinator]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const loadCoordinatorPreview = useCallback(async () => {
    if (!isAuthenticated || !isCoordinator || !selectedStudentId) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('studentId', selectedStudentId);
      if (selectedAyId) {
        params.set('academicYearId', selectedAyId);
      }
      if (dateFrom) {
        params.set('dateFrom', dateFrom);
      }
      if (dateTo) {
        params.set('dateTo', dateTo);
      }
      const res = await apiGet<{ preview: IndividualReportPreview }>(
        `/api/v1/coordinator/reports/individual/preview?${params.toString()}`,
      );
      setPreview(res.preview);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to preview individual student service report.',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [isAuthenticated, isCoordinator, selectedStudentId, selectedAyId, dateFrom, dateTo]);

  useEffect(() => {
    if (isCoordinator && selectedStudentId) {
      void loadCoordinatorPreview();
    }
  }, [isCoordinator, selectedStudentId, loadCoordinatorPreview]);

  const handleGeneratePdf = async () => {
    if (!selectedStudentId) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await apiPost<{ report: RssReportRecord }>(
        '/api/v1/coordinator/reports/individual/generate',
        {
          studentId: Number(selectedStudentId),
          templateId: selectedTemplateId ? Number(selectedTemplateId) : undefined,
          academicYearId: selectedAyId ? Number(selectedAyId) : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      );
      setFeedback(
        `Generated Individual RSS PDF v${res.report.version} for ${res.report.studentName ?? 'Student'}.`,
      );
      const repRes = await apiGet<{ reports: RssReportRecord[] }>(
        '/api/v1/coordinator/reports?reportType=individual',
      );
      setReports(repRes.reports);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to generate Individual RSS PDF report.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (reportId: number, status: ReportStatus) => {
    try {
      await apiPatch(`/api/v1/coordinator/reports/${reportId}/status`, { status });
      setFeedback(`Report #${reportId} updated to ${status}.`);
      const repRes = await apiGet<{ reports: RssReportRecord[] }>(
        '/api/v1/coordinator/reports?reportType=individual',
      );
      setReports(repRes.reports);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to update report status.',
      );
    }
  };

  const reportColumns: Array<TableColumn<RssReportRecord>> = [
    ...(isCoordinator
      ? [
          {
            key: 'student',
            header: 'Student',
            render: (r: RssReportRecord) => (
              <div>
                <p className="font-semibold text-[#1E293B]">{r.studentName ?? '—'}</p>
                <p className="font-mono text-xs text-[#64748B] tabular-nums">
                  {r.studentNumber ?? '—'}
                </p>
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'template',
      header: 'Template & Version',
      render: (r) => (
        <div>
          <p className="font-medium text-[#1E293B]">
            {r.templateName} ({r.templateVersion})
          </p>
          <p className="font-mono text-xs text-[#64748B] tabular-nums">
            Report v{r.version} · {r.academicYearName ?? 'All Academic Years'} · {r.itemCount} item(s)
          </p>
        </div>
      ),
    },
    {
      key: 'generatedAt',
      header: 'Generated',
      render: (r) => (
        <span className="text-xs text-[#64748B] tabular-nums">
          {new Date(r.generatedAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        isCoordinator ? (
          <SelectInput
            aria-label={`Status for report ${r.id}`}
            value={r.status}
            onChange={(e) => void handleStatusChange(r.id, e.target.value as ReportStatus)}
            className="w-auto min-w-[120px] py-1 text-xs"
          >
            <option value="generated">Generated</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </SelectInput>
        ) : (
          renderReportStatusBadge(r.status)
        ),
    },
    {
      key: 'download',
      header: 'PDF',
      align: 'right',
      render: (r) => (
        <a
          href={r.downloadUrl}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#12345A] hover:bg-[#F4F6FA]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Download PDF</span>
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          'Lapu-Lapu City College',
          isCoordinator ? 'Reports' : 'Reports & Alerts',
          isCoordinator ? 'Individual RSS Reports' : 'My RSS Reports',
        ]}
        title={isCoordinator ? 'Individual RSS Reports' : 'My Official RSS Reports'}
        description={
          isCoordinator
            ? 'Preview student service summaries and generate official versioned PDF reports linked to approved accomplishment submissions.'
            : 'View your printable official RSS service summary and download authorized individual PDF reports.'
        }
        actions={
          <>
            {preview ? (
              <Button
                variant="secondary"
                size="md"
                icon={<Printer className="h-4 w-4" aria-hidden="true" />}
                onClick={() => window.print()}
              >
                Print View
              </Button>
            ) : null}
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadInitialData()}
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
                Sign in to preview individual RSS service summaries and download official PDFs.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

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

      {isCoordinator && isAuthenticated ? (
        <Card>
          <CardHeader
            title="Report Scope & PDF Generation"
            description="Select an approved student, academic year, optional date range, and active template."
            action={
              <Button
                variant="primary"
                size="sm"
                loading={generating}
                disabled={!selectedStudentId || templates.length === 0 || (preview?.includedSubmissions.length ?? 0) === 0}
                icon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => void handleGeneratePdf()}
              >
                Generate Official PDF
              </Button>
            }
          />
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormField id="ind-stu" label="Approved Student">
              <SelectInput
                id="ind-stu"
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                {students.length === 0 ? (
                  <option value="">No approved students</option>
                ) : (
                  students.map((s) => (
                    <option key={s.studentId} value={String(s.studentId)}>
                      {s.fullName} ({s.studentNumber})
                    </option>
                  ))
                )}
              </SelectInput>
            </FormField>

            <FormField id="ind-ay" label="Academic Year">
              <SelectInput
                id="ind-ay"
                value={selectedAyId}
                onChange={(e) => setSelectedAyId(e.target.value)}
              >
                <option value="">All Academic Years</option>
                {academicYears.map((ay) => (
                  <option key={ay.id} value={String(ay.id)}>
                    {ay.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField id="ind-tpl" label="Report Template">
              <SelectInput
                id="ind-tpl"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                {templates.length === 0 ? (
                  <option value="">Create an active template first</option>
                ) : (
                  templates.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.templateName} ({t.templateVersion})
                    </option>
                  ))
                )}
              </SelectInput>
            </FormField>

            <FormField id="ind-from" label="From Date">
              <TextInput
                id="ind-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </FormField>

            <FormField id="ind-to" label="To Date">
              <TextInput
                id="ind-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>
      ) : null}

      {previewLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#64748B]">
            Loading live Individual RSS report preview...
          </CardContent>
        </Card>
      ) : preview ? (
        <Card>
          <CardHeader
            title={`Official Summary Preview — ${preview.student.fullName}`}
            description={`${preview.student.studentNumber} · ${preview.student.sectionLabel ?? 'Unassigned Section'} · ${preview.student.academicYearName ?? 'No Academic Year'}`}
            action={<FileBarChart2 className="h-5 w-5 text-[#12345A]" aria-hidden="true" />}
          />
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Total Credited Hours</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {preview.totals.totalCreditedHours.toFixed(2)} hrs
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Verified Attendance</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#1E293B] tabular-nums">
                  {preview.totals.verifiedAttendanceHours.toFixed(2)} hrs
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Approved Adjustments</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#1E293B] tabular-nums">
                  {preview.totals.approvedAdjustmentHours >= 0 ? '+' : ''}
                  {preview.totals.approvedAdjustmentHours.toFixed(2)} hrs
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Approved Submissions</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-800 tabular-nums">
                  {preview.includedSubmissions.length}
                </p>
              </div>
            </div>

            {preview.includedSubmissions.length === 0 ? (
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-4 text-center text-xs text-[#64748B]">
                No approved accomplishment submissions exist yet in this scope. An Individual RSS PDF requires at least one Coordinator-approved accomplishment submission.
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                {preview.includedSubmissions.map((sub) => (
                  <div key={sub.submissionId} className="px-4 py-3 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-[#1E293B]">
                        {sub.taskTitle} (v{sub.versionNumber})
                      </span>
                      <span className="font-mono text-[#12345A] tabular-nums">
                        {sub.verifiedHours.toFixed(2)} verified hrs · {sub.evidenceCount} evidence file(s)
                      </span>
                    </div>
                    <p className="text-[#64748B]">{sub.accomplishmentDescription}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-[#1E293B]">
          {isCoordinator ? 'Generated Individual RSS Reports' : 'Authorized PDF Downloads'}
        </h2>
        <DataTable
          columns={reportColumns}
          rows={reports}
          rowKey={(r) => String(r.id)}
          loading={loading}
          emptyTitle="No individual RSS reports generated yet"
          emptyDescription={
            isCoordinator
              ? 'Generate an Individual RSS PDF above once a student has at least one approved accomplishment submission and an active template exists.'
              : 'Official Individual RSS PDF reports generated by your RSS Coordinator will appear here.'
          }
        />
      </div>
    </div>
  );
}
