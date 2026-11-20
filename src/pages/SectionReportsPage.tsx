import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FilePlus2,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type {
  AcademicYearRecord,
  ReportStatus,
  ReportTemplateRecord,
  RssReportRecord,
  SectionRecord,
  SectionRepOverviewResponse,
  SectionReportPreview,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, SelectInput, TextInput } from '../components/ui/FormField.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface SectionReportsPageProps {
  mode: 'coordinator' | 'section_rep';
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

export function SectionReportsPage({
  mode,
  isAuthenticated,
  onReturnToOverview,
}: SectionReportsPageProps) {
  const isCoordinator = mode === 'coordinator';

  const [reports, setReports] = useState<RssReportRecord[]>([]);
  const [preview, setPreview] = useState<SectionReportPreview | null>(null);
  const [repOverview, setRepOverview] = useState<SectionRepOverviewResponse | null>(null);

  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [templates, setTemplates] = useState<ReportTemplateRecord[]>([]);

  const [selectedSectionId, setSelectedSectionId] = useState('');
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
        const [secRes, ayRes, tplRes, repRes] = await Promise.all([
          apiGet<{ sections: SectionRecord[] }>('/api/v1/coordinator/sections'),
          apiGet<{ academicYears: AcademicYearRecord[] }>('/api/v1/coordinator/academic-years'),
          apiGet<{ templates: ReportTemplateRecord[] }>('/api/v1/coordinator/report-templates'),
          apiGet<{ reports: RssReportRecord[] }>('/api/v1/coordinator/reports?reportType=section'),
        ]);
        setSections(secRes.sections);
        setAcademicYears(ayRes.academicYears);
        const activeTpls = tplRes.templates.filter(
          (t) => t.isActive && (t.config.reportType === 'both' || t.config.reportType === 'section'),
        );
        setTemplates(activeTpls);
        setReports(repRes.reports);
        if (!defaultsInitializedRef.current) {
          defaultsInitializedRef.current = true;
          if (secRes.sections.length > 0) {
            setSelectedSectionId((prev) => prev || String(secRes.sections[0].id));
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
        const [ovRes, repRes] = await Promise.all([
          apiGet<SectionRepOverviewResponse>('/api/v1/section-rep/overview'),
          apiGet<{ assigned: boolean; sectionLabel: string | null; reports: RssReportRecord[] }>(
            '/api/v1/section-rep/reports',
          ),
        ]);
        setRepOverview(ovRes);
        setReports(repRes.reports);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load section report data from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoordinator]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const loadCoordinatorPreview = useCallback(async () => {
    if (!isAuthenticated || !isCoordinator || !selectedSectionId) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('sectionId', selectedSectionId);
      params.set('includeComparison', 'true');
      if (selectedAyId) {
        params.set('academicYearId', selectedAyId);
      }
      if (dateFrom) {
        params.set('dateFrom', dateFrom);
      }
      if (dateTo) {
        params.set('dateTo', dateTo);
      }
      const res = await apiGet<{ preview: SectionReportPreview }>(
        `/api/v1/coordinator/reports/section/preview?${params.toString()}`,
      );
      setPreview(res.preview);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to preview section aggregate metrics.',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [isAuthenticated, isCoordinator, selectedSectionId, selectedAyId, dateFrom, dateTo]);

  useEffect(() => {
    if (isCoordinator && selectedSectionId) {
      void loadCoordinatorPreview();
    }
  }, [isCoordinator, selectedSectionId, loadCoordinatorPreview]);

  const handleGenerateSectionPdf = async () => {
    if (!selectedSectionId) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await apiPost<{ report: RssReportRecord }>(
        '/api/v1/coordinator/reports/section/generate',
        {
          sectionId: Number(selectedSectionId),
          academicYearId: selectedAyId ? Number(selectedAyId) : undefined,
          templateId: selectedTemplateId ? Number(selectedTemplateId) : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      );
      setFeedback(
        `Generated Section RSS PDF v${res.report.version} for ${res.report.sectionLabel ?? 'Section'}.`,
      );
      const repRes = await apiGet<{ reports: RssReportRecord[] }>(
        '/api/v1/coordinator/reports?reportType=section',
      );
      setReports(repRes.reports);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to generate consolidated section PDF report.',
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
        '/api/v1/coordinator/reports?reportType=section',
      );
      setReports(repRes.reports);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to update report status.',
      );
    }
  };

  const columns: Array<TableColumn<RssReportRecord>> = [
    {
      key: 'section',
      header: 'Section & Academic Year',
      render: (r) => (
        <div>
          <p className="font-semibold text-[#1E293B]">{r.sectionLabel ?? '—'}</p>
          <p className="text-xs text-[#64748B] tabular-nums">
            {r.academicYearName ?? 'All Academic Years'} · Report v{r.version} · {r.itemCount} item(s)
          </p>
        </div>
      ),
    },
    {
      key: 'template',
      header: 'Template',
      render: (r) => (
        <span className="text-xs text-[#1E293B]">
          {r.templateName} ({r.templateVersion})
        </span>
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
          <StatusBadge
            tone={r.status === 'approved' ? 'success' : r.status === 'archived' ? 'neutral' : 'info'}
            label={r.status}
          />
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
          isCoordinator ? 'Reports' : 'Section Scope (Read-Only)',
          isCoordinator ? 'Section RSS Reports' : 'Authorized Summaries',
        ]}
        title={isCoordinator ? 'Section RSS Reports' : 'Authorized Section Summaries (Read-Only)'}
        description={
          isCoordinator
            ? 'Preview consolidated section metrics, compare sections across the college, and generate official Section RSS PDF reports.'
            : 'Read-only aggregate participation metrics and authorized PDF downloads strictly scoped to your assigned section.'
        }
        actions={
          <>
            {isCoordinator && preview ? (
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
                Sign in to access consolidated section RSS summaries and PDF reports.
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
            title="Consolidated Section Report Generator"
            description="Choose section, academic year, optional dates, and active report template."
            action={
              <Button
                variant="primary"
                size="sm"
                loading={generating}
                disabled={!selectedSectionId || templates.length === 0}
                icon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => void handleGenerateSectionPdf()}
              >
                Generate Section PDF
              </Button>
            }
          />
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormField id="sec-rep-sec" label="Section">
              <SelectInput
                id="sec-rep-sec"
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
              >
                {sections.length === 0 ? (
                  <option value="">No sections configured yet</option>
                ) : (
                  sections.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.programCode} {s.yearLevelName} {s.name}
                    </option>
                  ))
                )}
              </SelectInput>
            </FormField>

            <FormField id="sec-rep-ay" label="Academic Year">
              <SelectInput
                id="sec-rep-ay"
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

            <FormField id="sec-rep-tpl" label="Report Template">
              <SelectInput
                id="sec-rep-tpl"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                {templates.length === 0 ? (
                  <option value="">Create active template first</option>
                ) : (
                  templates.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.templateName} ({t.templateVersion})
                    </option>
                  ))
                )}
              </SelectInput>
            </FormField>

            <FormField id="sec-rep-from" label="From Date">
              <TextInput
                id="sec-rep-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </FormField>

            <FormField id="sec-rep-to" label="To Date">
              <TextInput
                id="sec-rep-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>
      ) : null}

      {!isCoordinator && repOverview ? (
        <Card>
          <CardHeader
            title={
              repOverview.assigned && repOverview.section
                ? `Assigned Section: ${repOverview.section.programCode} ${repOverview.section.yearLevelName} ${repOverview.section.sectionName}`
                : 'No Section Assignment Linked'
            }
            description={repOverview.message}
          />
          {repOverview.assigned && repOverview.summary ? (
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Enrolled Students</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {repOverview.section?.activeEnrolledStudentsCount ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Approved Participations</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {repOverview.summary.approvedApplications}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Total Credited Hours</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {repOverview.summary.totalCreditedServiceHours.toFixed(2)} hrs
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Approved Accomplishments</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-800 tabular-nums">
                  {repOverview.summary.approvedAccomplishmentsCount}
                </p>
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {isCoordinator && previewLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#64748B]">
            Loading Section RSS preview and cross-section comparison...
          </CardContent>
        </Card>
      ) : isCoordinator && preview ? (
        <Card>
          <CardHeader
            title={`Section Aggregate Preview — ${preview.section.sectionLabel}`}
            description={`${preview.section.collegeName} · ${preview.academicYear?.name ?? 'All Academic Years'}`}
          />
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Enrolled Students</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {preview.metrics.enrolledStudentCount}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Approved Participations</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {preview.metrics.approvedApplications} / {preview.metrics.totalApplications}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Total Credited Hours</p>
                <p className="mt-1 font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                  {preview.metrics.totalCreditedHours.toFixed(2)} hrs
                </p>
              </div>
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3">
                <p className="font-semibold text-[#64748B]">Approved Accomplishments</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-800 tabular-nums">
                  {preview.metrics.approvedAccomplishmentsCount}
                </p>
              </div>
            </div>

            {preview.sectionComparison.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                  Cross-Section Comparison
                </h3>
                <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F4F6FA] text-[#64748B]">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Section</th>
                        <th className="px-3 py-2 font-semibold text-right">Enrolled</th>
                        <th className="px-3 py-2 font-semibold text-right">Participations</th>
                        <th className="px-3 py-2 font-semibold text-right">Credited Hrs</th>
                        <th className="px-3 py-2 font-semibold text-right">Accomplishments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {preview.sectionComparison.map((row) => (
                        <tr key={row.sectionId}>
                          <td className="px-3 py-2 font-medium text-[#1E293B]">
                            {row.sectionLabel}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.enrolledStudentCount}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.approvedParticipations}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                            {row.totalCreditedHours.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.approvedAccomplishmentsCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-[#1E293B]">
          {isCoordinator ? 'Generated Section RSS Reports' : 'Authorized Section PDF Reports'}
        </h2>
        <DataTable
          columns={columns}
          rows={reports}
          rowKey={(r) => String(r.id)}
          loading={loading}
          emptyTitle="No section RSS reports generated yet"
          emptyDescription={
            isCoordinator
              ? 'Generate a Section RSS PDF report above once a section and active template are selected.'
              : 'Consolidated PDF reports generated for your assigned section will appear here.'
          }
        />
      </div>
    </div>
  );
}
