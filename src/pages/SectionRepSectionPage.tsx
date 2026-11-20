import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, Info, RefreshCw, Users } from 'lucide-react';
import { ApiClientError, apiGet } from '../services/apiClient.ts';
import type { SectionRepOverviewResponse } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface SectionRepSectionPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

export function SectionRepSectionPage({
  isAuthenticated,
  onReturnToOverview,
}: SectionRepSectionPageProps) {
  const [overview, setOverview] = useState<SectionRepOverviewResponse | null>(null);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<SectionRepOverviewResponse>('/api/v1/section-rep/overview');
      setOverview(res);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load assigned section overview.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'Section Scope (Read-Only)', 'Section Information']}
        title="Assigned Section Information"
        description="Read-only section assignment details and aggregate Recognized Student Service participation totals."
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadOverview()}
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
                Sign in with an active Section Representative account to view your assigned section.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Section Representative access is strictly read-only and scoped via <code className="font-mono">student_section_history</code>. Individual private student profiles and approval controls remain restricted to the RSS Coordinator.
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

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#64748B]">
            Loading section information...
          </CardContent>
        </Card>
      ) : overview ? (
        !overview.assigned || !overview.section || !overview.summary ? (
          <Card>
            <CardContent className="flex items-start gap-3 text-sm text-[#1E293B]">
              <Users className="mt-0.5 h-5 w-5 text-[#12345A] shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">No Current Section Assignment Found</p>
                <p className="text-xs text-[#64748B]">{overview.message}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={`${overview.section.programCode} ${overview.section.yearLevelName} ${overview.section.sectionName}`}
                description={`${overview.collegeName} · ${overview.section.programName}`}
                action={<StatusBadge tone="info" label="Read-Only Scope" />}
              />
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3.5 space-y-1">
                  <p className="font-semibold text-[#64748B]">Academic Year</p>
                  <p className="text-sm font-bold text-[#0B2340]">
                    {overview.section.academicYearName}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3.5 space-y-1">
                  <p className="font-semibold text-[#64748B]">Approved Enrolled Students</p>
                  <p className="font-mono text-lg font-bold text-[#0B2340] tabular-nums">
                    {overview.section.activeEnrolledStudentsCount}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3.5 space-y-1">
                  <p className="font-semibold text-[#64748B]">College Department</p>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-[#1E293B]">
                    <Building2 className="h-4 w-4 text-[#12345A]" aria-hidden="true" />
                    <span>{overview.collegeName}</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="space-y-1">
                  <span className="text-xs font-semibold text-[#64748B] uppercase">
                    Approved Participations
                  </span>
                  <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                    {overview.summary.approvedApplications}
                  </p>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    of {overview.summary.totalApplications} total applications
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-1">
                  <span className="text-xs font-semibold text-[#64748B] uppercase">
                    Credited Service Hours
                  </span>
                  <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                    {overview.summary.totalCreditedServiceHours.toFixed(2)} hrs
                  </p>
                  <p className="text-xs text-[#64748B]">Aggregate verified + approved hours</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-1">
                  <span className="text-xs font-semibold text-[#64748B] uppercase">
                    Verified Attendance
                  </span>
                  <p className="font-mono text-2xl font-bold text-[#0B2340] tabular-nums">
                    {overview.summary.verifiedAttendanceEntries}
                  </p>
                  <p className="text-xs text-[#64748B]">Confirmed attendance logs</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-1">
                  <span className="text-xs font-semibold text-[#64748B] uppercase">
                    Approved Accomplishments
                  </span>
                  <p className="font-mono text-2xl font-bold text-emerald-800 tabular-nums">
                    {overview.summary.approvedAccomplishmentsCount}
                  </p>
                  <p className="text-xs text-[#64748B]">Approved submission versions</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
