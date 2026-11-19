import { useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AuthenticatedUser, NavGroup, RoleName } from '../../types/index.ts';
import { Button } from '../ui/Button.tsx';
import { Header } from './Header.tsx';
import { Sidebar } from './Sidebar.tsx';

interface AppShellProps {
  user: AuthenticatedUser | null;
  role: RoleName;
  groups: NavGroup[];
  activePageId: string;
  pageTitle: string;
  signingOut: boolean;
  onSelectPage: (pageId: string) => void;
  onSignOut: () => void;
  onChangeDevRole?: (role: RoleName) => void;
  children: ReactNode;
}

export function AppShell({
  user,
  role,
  groups,
  activePageId,
  pageTitle,
  signingOut,
  onSelectPage,
  onSignOut,
  onChangeDevRole,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#F4F6FA] text-[#1E293B]">
      <Sidebar
        user={user}
        role={role}
        groups={groups}
        activePageId={activePageId}
        onSelectPage={onSelectPage}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          role={role}
          pageTitle={pageTitle}
          signingOut={signingOut}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onSignOut={onSignOut}
          onChangeDevRole={onChangeDevRole}
          onOpenNotificationsPage={() => onSelectPage('notifications')}
        />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1240px] space-y-6">
            {!user && import.meta.env.DEV ? (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">
                      Unauthenticated UI Preview Mode (Development Only)
                    </p>
                    <p className="mt-0.5 text-amber-800">
                      Protected backend endpoints remain locked until PostgreSQL is configured and you sign in with a verified account.
                    </p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={onSignOut}>
                  Return to Sign In
                </Button>
              </div>
            ) : null}

            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
