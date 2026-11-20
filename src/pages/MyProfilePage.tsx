import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiClientError, apiGet } from '../services/apiClient.ts';
import type { StudentOwnProfileResponse } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface MyProfilePageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

export function MyProfilePage({ isAuthenticated, onReturnToOverview }: MyProfilePageProps) {
  const [profile, setProfile] = useState<StudentOwnProfileResponse | null>(null);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setProfile(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<StudentOwnProfileResponse>('/api/v1/student/profile');
      setProfile(res);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load your academic profile from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const fullName = profile
    ? [profile.firstName, profile.middleName, profile.lastName, profile.suffix]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'Student Portal', 'My Profile']}
        title="My Academic Profile"
        description="Read-only institutional student identity, current section placement, and chronological section history."
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadProfile()}
              >
                Refresh
              </Button>
            ) : null}
            <Button variant="primary" size="md" onClick={onReturnToOverview}>
              Dashboard Overview
            </Button>
          </>
        }
      />

      {!isAuthenticated ? (
        <Card>
          <CardContent className="flex items-start gap-3 text-sm text-[#1E293B]">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Student Authentication Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Sign in with an approved Student account to view your official student profile and section assignment history.
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

      {profile ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Student Information"
              description="Managed by the College of Technology RSS Coordinator"
            />
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[#64748B]">Student Number</dt>
                  <dd className="mt-1 font-mono font-semibold text-[#12345A] tabular-nums">
                    {profile.studentNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Full Name</dt>
                  <dd className="mt-1 font-medium text-[#1E293B]">{fullName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Email Address</dt>
                  <dd className="mt-1 text-[#1E293B]">{profile.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Contact Number</dt>
                  <dd className="mt-1 text-[#1E293B]">
                    {profile.contactNumber ?? 'Not provided'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Sex</dt>
                  <dd className="mt-1 text-[#1E293B]">{profile.sex ?? 'Not specified'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Birth Date</dt>
                  <dd className="mt-1 font-mono text-[#1E293B] tabular-nums">
                    {profile.birthDate ?? 'Not specified'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Account Status</dt>
                  <dd className="mt-1">
                    <StatusBadge
                      tone={profile.accountStatus === 'active' ? 'success' : 'warning'}
                      label={profile.accountStatus}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64748B]">Registration Status</dt>
                  <dd className="mt-1">
                    <StatusBadge
                      tone={profile.registrationStatus === 'approved' ? 'success' : 'warning'}
                      label={profile.registrationStatus}
                    />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Current Section & Enrollment History"
              description="Chronological record from student_section_history"
            />
            <CardContent className="space-y-4">
              {profile.currentSection ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#12345A]">
                    Current Placement
                  </p>
                  <p className="mt-1 text-base font-semibold text-[#1E293B]">
                    {profile.currentSection.programCode} · {profile.currentSection.yearLevelName} ·{' '}
                    {profile.currentSection.sectionName}
                  </p>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    {profile.currentSection.programName}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[#64748B] tabular-nums">
                    Academic Year {profile.currentSection.academicYearName} · Enrolled{' '}
                    {profile.currentSection.enrolledAt}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-4 text-xs text-[#64748B]">
                  You have not been assigned to an academic section yet. Contact your RSS Coordinator for section placement.
                </div>
              )}

              {profile.sectionHistory.length > 0 ? (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {profile.sectionHistory.map((item) => (
                    <div
                      key={item.historyId}
                      className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1E293B]">
                          {item.programCode} · {item.yearLevelName} · {item.sectionName}
                        </p>
                        <p className="font-mono text-xs text-[#64748B] tabular-nums">
                          AY {item.academicYearName} · {item.enrolledAt}
                          {item.endedAt ? ` to ${item.endedAt}` : ''}
                        </p>
                      </div>
                      <StatusBadge
                        tone={item.isCurrent ? 'success' : 'neutral'}
                        label={item.isCurrent ? 'Current' : 'Past'}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
