import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  FileText,
  Info,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type {
  CollegeRecord,
  ReportTemplateConfig,
  ReportTemplateRecord,
  ReportType,
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

interface ReportTemplatesPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

const DEFAULT_CONFIG: ReportTemplateConfig = {
  reportType: 'both',
  subtitle: 'Official Recognized Student Service Report',
  headerNote: 'Lapu-Lapu City College · College of Technology',
  footerNote: 'Certified authentic system-generated RSS record.',
  signatoryTitle: 'RSS Coordinator, College of Technology',
  includeSections: {
    attendanceSummary: true,
    serviceHoursBreakdown: true,
    accomplishmentNarrative: true,
    evidenceCountSummary: true,
    sectionComparison: false,
  },
};

export function ReportTemplatesPage({
  isAuthenticated,
  onReturnToOverview,
}: ReportTemplatesPageProps) {
  const [templates, setTemplates] = useState<ReportTemplateRecord[]>([]);
  const [colleges, setColleges] = useState<CollegeRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create/Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplateRecord | null>(null);
  const [collegeId, setCollegeId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateVersion, setTemplateVersion] = useState('v1.0');
  const [isActive, setIsActive] = useState(true);
  const [config, setConfig] = useState<ReportTemplateConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setTemplates([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [tplRes, metaRes] = await Promise.all([
        apiGet<{ templates: ReportTemplateRecord[] }>('/api/v1/coordinator/report-templates'),
        apiGet<{ colleges: CollegeRecord[] }>('/api/v1/coordinator/academic-metadata'),
      ]);
      setTemplates(tplRes.templates);
      setColleges(metaRes.colleges);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load report templates from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingTemplate(null);
    setCollegeId(colleges[0] ? String(colleges[0].id) : '');
    setTemplateName('College of Technology Official RSS Template');
    setTemplateVersion(`v${templates.length + 1}.0`);
    setIsActive(true);
    setConfig(DEFAULT_CONFIG);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (tpl: ReportTemplateRecord) => {
    setEditingTemplate(tpl);
    setCollegeId(String(tpl.collegeId));
    setTemplateName(tpl.templateName);
    setTemplateVersion(tpl.templateVersion);
    setIsActive(tpl.isActive);
    setConfig(tpl.config);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      setFormError('Template name is required.');
      return;
    }
    if (!editingTemplate && (!collegeId || !templateVersion.trim())) {
      setFormError('College and version label are required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editingTemplate) {
        await apiPatch(`/api/v1/coordinator/report-templates/${editingTemplate.id}`, {
          templateName: templateName.trim(),
          isActive,
          config,
        });
        setFeedback(`Template "${templateName.trim()}" updated.`);
      } else {
        await apiPost('/api/v1/coordinator/report-templates', {
          collegeId: Number(collegeId),
          templateName: templateName.trim(),
          templateVersion: templateVersion.trim(),
          isActive,
          config,
        });
        setFeedback(`Report template "${templateName.trim()}" (${templateVersion.trim()}) created.`);
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Unable to save report template.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (tpl: ReportTemplateRecord) => {
    setError(null);
    try {
      await apiPatch(`/api/v1/coordinator/report-templates/${tpl.id}`, {
        isActive: !tpl.isActive,
      });
      setFeedback(
        `Template "${tpl.templateName} (${tpl.templateVersion})" marked ${!tpl.isActive ? 'active' : 'inactive'}.`,
      );
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to update template status.',
      );
    }
  };

  const columns: Array<TableColumn<ReportTemplateRecord>> = [
    {
      key: 'name',
      header: 'Template & College',
      render: (r) => (
        <div className="min-w-[200px]">
          <p className="font-semibold text-[#1E293B]">{r.templateName}</p>
          <p className="text-xs text-[#64748B]">
            {r.collegeName} ({r.collegeCode}) · Version{' '}
            <span className="font-mono font-semibold text-[#12345A]">{r.templateVersion}</span>
          </p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Report Scope',
      render: (r) => (
        <span className="text-xs font-medium uppercase text-[#1E293B]">{r.config.reportType}</span>
      ),
    },
    {
      key: 'usage',
      header: 'Reports Issued',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.reportUsageCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.isActive ? (
          <StatusBadge tone="success" label="Active" />
        ) : (
          <StatusBadge tone="neutral" label="Inactive" />
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => openEditModal(r)}
          >
            Configure
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleToggleActive(r)}
          >
            {r.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'Reports', 'Report Templates']}
        title="Official RSS Report Templates"
        description="Manage versioned college-specific PDF report layouts, included breakdown sections, and institutional signatory blocks."
        actions={
          <>
            {isAuthenticated ? (
              <>
                <Button
                  variant="primary"
                  size="md"
                  disabled={colleges.length === 0}
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={openCreateModal}
                >
                  New Template Version
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
              <p className="font-semibold">Authenticated Coordinator Session Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Sign in with an RSS Coordinator account to create or activate PDF templates.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Template records persist metadata in PostgreSQL <code className="font-mono">report_templates</code> and store validated JSON layout configuration files safely in <code className="font-mono">storage/templates/</code> without modifying the 28-table schema.
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
        rows={templates}
        rowKey={(r) => String(r.id)}
        loading={loading}
        emptyTitle="No report templates created yet"
        emptyDescription="Create an active college report template before generating Individual or Section RSS PDF reports."
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="lg"
        title={editingTemplate ? 'Configure Report Template' : 'Create Report Template Version'}
        description="Define institutional header/footer copy and optional sections rendered in generated PDFs."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void handleSave()}
            >
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
            >
              {formError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="tpl-college" label="College" required>
              <SelectInput
                id="tpl-college"
                disabled={Boolean(editingTemplate)}
                value={collegeId}
                onChange={(e) => setCollegeId(e.target.value)}
              >
                {colleges.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField id="tpl-version" label="Template Version" required>
              <TextInput
                id="tpl-version"
                disabled={Boolean(editingTemplate)}
                value={templateVersion}
                onChange={(e) => setTemplateVersion(e.target.value)}
                placeholder="v1.0"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="tpl-name" label="Template Name" required>
              <TextInput
                id="tpl-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </FormField>

            <FormField id="tpl-type" label="Supported Report Scope">
              <SelectInput
                id="tpl-type"
                value={config.reportType}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    reportType: e.target.value as ReportType | 'both',
                  }))
                }
              >
                <option value="both">Both Individual &amp; Section</option>
                <option value="individual">Individual Only</option>
                <option value="section">Section Only</option>
              </SelectInput>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="tpl-subtitle" label="Report Subtitle">
              <TextInput
                id="tpl-subtitle"
                value={config.subtitle}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, subtitle: e.target.value }))
                }
              />
            </FormField>

            <FormField id="tpl-signatory" label="Signatory Title">
              <TextInput
                id="tpl-signatory"
                value={config.signatoryTitle}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, signatoryTitle: e.target.value }))
                }
              />
            </FormField>
          </div>

          <FormField id="tpl-header" label="Header Note">
            <TextInput
              id="tpl-header"
              value={config.headerNote}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, headerNote: e.target.value }))
              }
            />
          </FormField>

          <FormField id="tpl-footer" label="Footer Note">
            <TextareaInput
              id="tpl-footer"
              rows={2}
              value={config.footerNote}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, footerNote: e.target.value }))
              }
            />
          </FormField>

          <div className="rounded-lg border border-[#E2E8F0] p-3.5 space-y-2">
            <p className="text-xs font-semibold text-[#1E293B] uppercase">
              Included PDF Report Sections
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
              {(
                [
                  ['attendanceSummary', 'Attendance Summary'],
                  ['serviceHoursBreakdown', 'Service Hours Breakdown'],
                  ['accomplishmentNarrative', 'Accomplishment Narratives'],
                  ['evidenceCountSummary', 'Evidence Count Summary'],
                  ['sectionComparison', 'Section Comparison Table'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeSections[key]}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        includeSections: {
                          ...prev.includeSections,
                          [key]: e.target.checked,
                        },
                      }))
                    }
                    className="h-4 w-4 rounded border-[#E2E8F0]"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-[#1E293B] cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-[#E2E8F0]"
            />
            <span>Active template (available for generating new official RSS PDF reports)</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
