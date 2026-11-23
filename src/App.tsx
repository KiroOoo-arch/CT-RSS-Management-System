import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLE_NAVIGATION } from './config/navigation.ts';
import { ApiClientError, apiGet, apiPost, setCsrfToken } from './services/apiClient.ts';
import type {
  AuthSessionResponse,
  AuthenticatedUser,
  BootstrapStatus,
  DatabaseReadiness,
  HealthSnapshot,
  NavItem,
  RoleName,
} from './types/index.ts';
import { AppShell } from './components/layout/AppShell.tsx';
import { CollegeLogo } from './components/ui/CollegeLogo.tsx';
import { AcademicYearsPage } from './pages/AcademicYearsPage.tsx';
import { AccomplishmentsPage } from './pages/AccomplishmentsPage.tsx';
import { ApplicationsPage } from './pages/ApplicationsPage.tsx';
import { AttendancePage } from './pages/AttendancePage.tsx';
import { AuditLogsPage } from './pages/AuditLogsPage.tsx';
import { FoundationOverviewPage } from './pages/FoundationOverviewPage.tsx';
import { IndividualReportsPage } from './pages/IndividualReportsPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ModuleShellPage } from './pages/ModuleShellPage.tsx';
import { MyProfilePage } from './pages/MyProfilePage.tsx';
import { NotificationsPage } from './pages/NotificationsPage.tsx';
import { ProgramsPage } from './pages/ProgramsPage.tsx';
import { RegistrationsPage } from './pages/RegistrationsPage.tsx';
import { ReportTemplatesPage } from './pages/ReportTemplatesPage.tsx';
import { SectionRepSectionPage } from './pages/SectionRepSectionPage.tsx';
import { SectionRepTasksPage } from './pages/SectionRepTasksPage.tsx';
import { SectionReportsPage } from './pages/SectionReportsPage.tsx';
import { SectionsPage } from './pages/SectionsPage.tsx';
import { ServiceHoursPage } from './pages/ServiceHoursPage.tsx';
import { StudentsPage } from './pages/StudentsPage.tsx';
import { StudentTasksPage } from './pages/StudentTasksPage.tsx';
import { TasksPage } from './pages/TasksPage.tsx';

export default function App() {
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [database, setDatabase] = useState<DatabaseReadiness | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null);

  const [devPreviewMode, setDevPreviewMode] = useState(false);
  const [devPreviewRole, setDevPreviewRole] = useState<RoleName>('RSS Coordinator');
  const [activePageId, setActivePageId] = useState<string>('dashboard');
  const [signingOut, setSigningOut] = useState(false);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);

  const bootstrapAppState = useCallback(async () => {
    try {
      setCheckingSession(true);
      try {
        const [healthRes, bootstrapRes] = await Promise.all([
          apiGet<HealthSnapshot>('/api/v1/health').catch(() => null),
          apiGet<BootstrapStatus>('/api/v1/auth/bootstrap-status').catch(() => null),
        ]);

        if (healthRes) {
          setDatabase(healthRes.database);
        }
        if (bootstrapRes) {
          setBootstrapStatus(bootstrapRes);
        }

        // Check authentication status after health/bootstrap checks complete.
        // /api/v1/auth/me returns 401 when unauthenticated - this is expected
        // and handled in the catch below. The key fix: the finally block
        // below ALWAYS executes after this inner try, ensuring
        // setCheckingSession(false) is called even if the session check
        // throws or the response is unexpected.
        try {
          const session = await apiGet<AuthSessionResponse>('/api/v1/auth/me');
          // Request completed (even if 401). Authenticate if user present.
          if (session && session.user) {
            setCsrfToken(session.csrfToken);
            setAuthUser(session.user);
            setDevPreviewMode(false);
          } else {
            // Session existed but has no user, or invalid session
            setCsrfToken(session?.csrfToken ?? null);
            setAuthUser(null);
            setDevPreviewMode(false);
          }
        } catch (err) {
          // 401 (unauthenticated), 503 (service unavailable), or other error.
          // Clear auth state - user is not authenticated.
          setCsrfToken(null);
          setAuthUser(null);
        }
        // Note: no 'return' here - we want execution to continue to the
        // inner finally block below, which will set checkingSession(false).
      } finally {
        // CRITICAL: This finally ALWAYS runs after the inner try block,
        // regardless of whether the auth check above completed successfully,
        // threw an error, or was cancelled. This is the key fix: ensuring
        // setCheckingSession(false) is called even when execution seems
        // to "disappear" after Promise.all completes.
        setCheckingSession(false);
      }
    } catch (e) {
      // Top-level catch - shouldn't normally reach here, but handle it
      // gracefully by clearing state and ensuring the checking session ends.
      setCsrfToken(null);
      setAuthUser(null);
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    void bootstrapAppState();
  }, [bootstrapAppState]);

  const effectiveRole: RoleName = authUser ? authUser.primaryRole : devPreviewRole;
  const navGroups = ROLE_NAVIGATION[effectiveRole];

  const activeItem: NavItem | undefined = useMemo(() => {
    for (const group of navGroups) {
      const found = group.items.find((item) => item.id === activePageId);
      if (found) {
        return found;
      }
    }
    return navGroups[0]?.items[0];
  }, [navGroups, activePageId]);

  const handleAuthenticated = (user: AuthenticatedUser) => {
    setAuthUser(user);
    setDevPreviewMode(false);
    setActivePageId('dashboard');
  };

  const handleSignOut = async () => {
    if (!authUser) {
      setDevPreviewMode(false);
      setActivePageId('dashboard');
      return;
    }

    setSigningOut(true);
    try {
      await apiPost('/api/v1/auth/logout');
    } catch {
      // Clear local session state even if network/DB returned an error
    } finally {
      setCsrfToken(null);
      setAuthUser(null);
      setActivePageId('dashboard');
      setSigningOut(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#F4F6FA] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-8 py-7 text-center">
          <CollegeLogo size="lg" />
          <p className="font-[var(--font-display)] text-sm font-bold text-[#12345A]">
            LAPU-LAPU CITY COLLEGE · CT-RSS PORTAL
          </p>
          <p className="text-xs text-[#64748B]">Verifying session and PostgreSQL readiness...</p>
        </div>
      </div>
    );
  }

  const allowDevPreview = import.meta.env.DEV && database?.status !== 'connected';

  if (!authUser && !(allowDevPreview && devPreviewMode)) {
    return (
      <LoginPage
        database={database}
        bootstrapStatus={bootstrapStatus}
        onAuthenticated={handleAuthenticated}
        onEnterDevPreview={
          allowDevPreview
            ? () => {
                setDevPreviewMode(true);
                setActivePageId('dashboard');
              }
            : undefined
        }
      />
    );
  }

  const pageTitle = activeItem?.label ?? 'Dashboard';

  const renderPage = () => {
    const authed = Boolean(authUser);
    const goOverview = () => setActivePageId('dashboard');

    if (activeItem?.id === 'notifications') {
      return (
        <NotificationsPage
          isAuthenticated={authed}
          onReturnToOverview={goOverview}
          onNotificationsChanged={() => setNotificationRefreshKey((k) => k + 1)}
        />
      );
    }

    if (effectiveRole === 'RSS Coordinator') {
      switch (activeItem?.id) {
        case 'registrations':
          return <RegistrationsPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'academic-years':
          return <AcademicYearsPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'programs':
          return <ProgramsPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'sections':
          return <SectionsPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'students':
          return <StudentsPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'tasks-activities':
          return <TasksPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'applications':
          return (
            <ApplicationsPage
              mode="coordinator"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'attendance':
          return (
            <AttendancePage
              mode="coordinator"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'service-hours':
          return (
            <ServiceHoursPage
              mode="coordinator"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'accomplishments':
          return (
            <AccomplishmentsPage
              mode="coordinator"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'individual-rss-reports':
          return (
            <IndividualReportsPage
              mode="coordinator"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'section-rss-reports':
          return (
            <SectionReportsPage
              mode="coordinator"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'report-templates':
          return <ReportTemplatesPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'audit-logs':
          return <AuditLogsPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        default:
          break;
      }
    }

    if (effectiveRole === 'Student') {
      switch (activeItem?.id) {
        case 'my-profile':
          return <MyProfilePage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'tasks-activities':
          return <StudentTasksPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'applications':
          return (
            <ApplicationsPage
              mode="student"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'attendance':
          return (
            <AttendancePage
              mode="student"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'service-hours':
          return (
            <ServiceHoursPage
              mode="student"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'accomplishments':
          return (
            <AccomplishmentsPage
              mode="student"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        case 'individual-rss-reports':
          return (
            <IndividualReportsPage
              mode="student"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        default:
          break;
      }
    }

    if (effectiveRole === 'Section Representative') {
      switch (activeItem?.id) {
        case 'academic-structure':
          return <SectionRepSectionPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'tasks-activities':
          return <SectionRepTasksPage isAuthenticated={authed} onReturnToOverview={goOverview} />;
        case 'section-rss-reports':
          return (
            <SectionReportsPage
              mode="section_rep"
              isAuthenticated={authed}
              onReturnToOverview={goOverview}
            />
          );
        default:
          break;
      }
    }

    if (activeItem && activeItem.id !== 'dashboard') {
      return (
        <ModuleShellPage
          key={`${effectiveRole}-${activeItem.id}`}
          role={effectiveRole}
          item={activeItem}
          onReturnToOverview={goOverview}
        />
      );
    }

    return (
      <FoundationOverviewPage
        user={authUser}
        role={effectiveRole}
        onNavigate={setActivePageId}
        onChangeDevRole={
          !authUser && import.meta.env.DEV
            ? (nextRole) => {
                setDevPreviewRole(nextRole);
                setActivePageId('dashboard');
              }
            : undefined
        }
      />
    );
  };

  return (
    <AppShell
      user={authUser}
      role={effectiveRole}
      groups={navGroups}
      activePageId={activeItem?.id ?? 'dashboard'}
      pageTitle={pageTitle}
      signingOut={signingOut}
      notificationRefreshKey={notificationRefreshKey}
      onSelectPage={setActivePageId}
      onSignOut={() => void handleSignOut()}
      onChangeDevRole={
        !authUser && import.meta.env.DEV
          ? (nextRole) => {
              setDevPreviewRole(nextRole);
              setActivePageId('dashboard');
            }
          : undefined
      }
    >
      {renderPage()}
    </AppShell>
  );
}
