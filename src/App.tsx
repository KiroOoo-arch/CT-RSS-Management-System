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
import { FoundationOverviewPage } from './pages/FoundationOverviewPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ModuleShellPage } from './pages/ModuleShellPage.tsx';
import { RegistrationsPage } from './pages/RegistrationsPage.tsx';

export default function App() {
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [database, setDatabase] = useState<DatabaseReadiness | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null);

  const [devPreviewMode, setDevPreviewMode] = useState(false);
  const [devPreviewRole, setDevPreviewRole] = useState<RoleName>('RSS Coordinator');
  const [activePageId, setActivePageId] = useState<string>('dashboard');
  const [signingOut, setSigningOut] = useState(false);

  const bootstrapAppState = useCallback(async () => {
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

      try {
        const session = await apiGet<AuthSessionResponse>('/api/v1/auth/me');
        setCsrfToken(session.csrfToken);
        setAuthUser(session.user);
        setDevPreviewMode(false);
      } catch (err) {
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 503)) {
          setCsrfToken(null);
          setAuthUser(null);
        } else {
          setCsrfToken(null);
          setAuthUser(null);
        }
      }
    } finally {
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
    if (activeItem?.id === 'registrations' && effectiveRole === 'RSS Coordinator') {
      return (
        <RegistrationsPage
          isAuthenticated={Boolean(authUser)}
          onReturnToOverview={() => setActivePageId('dashboard')}
        />
      );
    }

    if (activeItem && activeItem.id !== 'dashboard') {
      return (
        <ModuleShellPage
          key={`${effectiveRole}-${activeItem.id}`}
          role={effectiveRole}
          item={activeItem}
          onReturnToOverview={() => setActivePageId('dashboard')}
        />
      );
    }

    return (
      <FoundationOverviewPage
        user={authUser}
        role={effectiveRole}
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
