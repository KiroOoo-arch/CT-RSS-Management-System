import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, LogOut, Menu, ShieldCheck, UserCheck } from 'lucide-react';
import type { AuthenticatedUser, RoleName } from '../../types/index.ts';

interface HeaderProps {
  user: AuthenticatedUser | null;
  role: RoleName;
  pageTitle: string;
  signingOut: boolean;
  onOpenMobileMenu: () => void;
  onSignOut: () => void;
  onChangeDevRole?: (role: RoleName) => void;
  onOpenNotificationsPage: () => void;
}

const ROLES: RoleName[] = ['RSS Coordinator', 'Student', 'Section Representative'];

export function Header({
  user,
  role,
  pageTitle,
  signingOut,
  onOpenMobileMenu,
  onSignOut,
  onChangeDevRole,
  onOpenNotificationsPage,
}: HeaderProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const unreadCount = 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotifOpen(false);
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-[#E2E8F0] bg-white px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#1E293B] hover:bg-[#F4F6FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] lg:hidden cursor-pointer shrink-0"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="min-w-0">
          <nav
            aria-label="Header breadcrumb"
            className="flex items-center gap-1 text-xs text-[#64748B]"
          >
            <span className="hidden truncate sm:inline">College of Technology</span>
            <ChevronRight className="hidden h-3 w-3 text-[#64748B] sm:inline shrink-0" aria-hidden="true" />
            <span className="truncate">{role}</span>
          </nav>
          <p className="truncate font-[var(--font-display)] text-sm font-semibold text-[#1E293B]">
            {pageTitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {/* Notifications dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => {
              setNotifOpen((prev) => !prev);
              setAccountMenuOpen(false);
            }}
            aria-expanded={notifOpen}
            aria-haspopup="true"
            aria-label={`Notifications, ${unreadCount} unread`}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#1E293B] hover:bg-[#F4F6FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] cursor-pointer"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
          </button>

          {notifOpen ? (
            <div className="absolute right-0 mt-2 w-72 rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-lg sm:w-80">
              <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
                <p className="text-sm font-semibold text-[#1E293B]">Notifications</p>
                <span className="text-xs text-[#64748B] tabular-nums">
                  {unreadCount} unread
                </span>
              </div>
              <p className="py-5 text-center text-xs leading-relaxed text-[#64748B]">
                Notification inbox listing connects in Milestone 10. Registration submissions already record real notifications in PostgreSQL.
              </p>
              <button
                type="button"
                onClick={() => {
                  setNotifOpen(false);
                  onOpenNotificationsPage();
                }}
                className="min-h-9 w-full rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-3 py-2 text-xs font-medium text-[#12345A] hover:bg-slate-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] cursor-pointer"
              >
                View Notifications Page
              </button>
            </div>
          ) : null}
        </div>

        {/* Authenticated Account Menu OR Dev-Only Preview Menu */}
        <div className="relative" ref={accountRef}>
          <button
            type="button"
            onClick={() => {
              setAccountMenuOpen((prev) => !prev);
              setNotifOpen(false);
            }}
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm font-medium text-[#1E293B] hover:bg-[#F4F6FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {user ? (
              <ShieldCheck className="h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
            ) : (
              <UserCheck className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            )}
            <span className="hidden sm:inline max-w-[180px] truncate">
              {user ? user.name : `Preview: ${role}`}
            </span>
            <ChevronDown className="h-4 w-4 text-[#64748B] shrink-0" aria-hidden="true" />
          </button>

          {accountMenuOpen ? (
            <div
              role="menu"
              aria-label="Account session menu"
              className="absolute right-0 mt-2 w-68 rounded-lg border border-[#E2E8F0] bg-white p-2 shadow-lg"
            >
              {user ? (
                <>
                  <div className="border-b border-[#E2E8F0] px-3 py-2">
                    <p className="truncate text-xs font-semibold text-[#1E293B]">{user.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-[#64748B]">{user.email}</p>
                    <p className="mt-1 text-[11px] font-medium text-[#12345A]">
                      Role: {user.primaryRole}
                    </p>
                  </div>
                  <div className="pt-1.5">
                    <button
                      type="button"
                      disabled={signingOut}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onSignOut();
                      }}
                      className="flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 cursor-pointer disabled:opacity-60"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{signingOut ? 'Signing Out...' : 'Sign Out'}</span>
                    </button>
                  </div>
                </>
              ) : import.meta.env.DEV ? (
                <>
                  <div className="border-b border-[#E2E8F0] px-3 py-2">
                    <p className="text-xs font-semibold text-[#1E293B]">
                      Unauthenticated UI Preview (Dev)
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#64748B]">
                      No backend session active · Development inspection only
                    </p>
                  </div>
                  {onChangeDevRole ? (
                    <div className="py-1.5 space-y-0.5">
                      {ROLES.map((item) => (
                        <button
                          key={item}
                          type="button"
                          role="menuitemradio"
                          aria-checked={item === role}
                          onClick={() => {
                            onChangeDevRole(item);
                            setAccountMenuOpen(false);
                          }}
                          className={`flex min-h-9 w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                            item === role
                              ? 'bg-[#12345A] text-white font-semibold'
                              : 'text-[#1E293B] hover:bg-[#F4F6FA]'
                          }`}
                        >
                          <span>{item}</span>
                          {item === role ? (
                            <span className="text-[11px] text-[#D6A63C]">Preview</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="border-t border-[#E2E8F0] pt-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onSignOut();
                      }}
                      className="flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-medium text-[#12345A] hover:bg-[#F4F6FA] cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Return to Sign In Page</span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
