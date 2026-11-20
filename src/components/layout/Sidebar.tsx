import { useState } from 'react';
import {
  Award,
  Bell,
  BookOpen,
  Building2,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Layers,
  LayoutDashboard,
  ScrollText,
  UserCheck,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import type { AuthenticatedUser, NavGroup, RoleName } from '../../types/index.ts';
import { CollegeLogo } from '../ui/CollegeLogo.tsx';

interface SidebarProps {
  user: AuthenticatedUser | null;
  role: RoleName;
  groups: NavGroup[];
  activePageId: string;
  onSelectPage: (pageId: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function getNavIcon(itemId: string) {
  const iconClass = 'h-4 w-4 shrink-0';
  switch (itemId) {
    case 'dashboard':
      return <LayoutDashboard className={iconClass} aria-hidden="true" />;
    case 'registrations':
      return <UserCheck className={iconClass} aria-hidden="true" />;
    case 'academic-years':
      return <CalendarRange className={iconClass} aria-hidden="true" />;
    case 'programs':
      return <BookOpen className={iconClass} aria-hidden="true" />;
    case 'sections':
      return <Layers className={iconClass} aria-hidden="true" />;
    case 'students':
      return <Users className={iconClass} aria-hidden="true" />;
    case 'academic-structure':
      return <Building2 className={iconClass} aria-hidden="true" />;
    case 'my-profile':
      return <UserCircle className={iconClass} aria-hidden="true" />;
    case 'tasks-activities':
      return <ClipboardList className={iconClass} aria-hidden="true" />;
    case 'applications':
      return <CheckSquare className={iconClass} aria-hidden="true" />;
    case 'attendance':
      return <UserCheck className={iconClass} aria-hidden="true" />;
    case 'service-hours':
      return <Clock className={iconClass} aria-hidden="true" />;
    case 'accomplishments':
      return <Award className={iconClass} aria-hidden="true" />;
    case 'individual-rss-reports':
      return <FileBarChart2 className={iconClass} aria-hidden="true" />;
    case 'section-rss-reports':
      return <FileSpreadsheet className={iconClass} aria-hidden="true" />;
    case 'report-templates':
      return <FileText className={iconClass} aria-hidden="true" />;
    case 'notifications':
      return <Bell className={iconClass} aria-hidden="true" />;
    case 'audit-logs':
      return <ScrollText className={iconClass} aria-hidden="true" />;
    default:
      return <LayoutDashboard className={iconClass} aria-hidden="true" />;
  }
}

export function Sidebar({
  user,
  role,
  groups,
  activePageId,
  onSelectPage,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const sidebarBody = (
    <div className="flex h-full flex-col bg-[#0B2340] text-slate-100">
      {/* Official Branded Sidebar Header */}
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <CollegeLogo size="md" />
          <div className="min-w-0">
            <p className="truncate font-[var(--font-display)] text-xs font-bold tracking-wide text-white">
              LAPU-LAPU CITY COLLEGE
            </p>
            <p className="truncate text-[11px] font-medium text-[#D6A63C]">
              College of Technology
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-300">
              CT-RSS Management System
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white lg:hidden cursor-pointer shrink-0"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Current Role Scope Strip */}
      <div className="border-b border-white/10 bg-[#12345A]/60 px-4 py-2.5">
        <p className="text-[11px] text-slate-300">
          {user ? 'Authenticated Session' : 'UI Preview Scope (Dev Only)'}
        </p>
        <p className="mt-0.5 truncate text-xs font-semibold text-white">
          {user ? `${user.name} · ${role}` : role}
        </p>
      </div>

      {/* Role-Aware Navigation */}
      <nav aria-label="Primary sidebar navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {groups.map((group) => {
          const isCollapsed = Boolean(collapsedGroups[group.id]);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[11px] font-semibold tracking-wider text-slate-300 uppercase hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6A63C] cursor-pointer"
              >
                <span>{group.title}</span>
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                )}
              </button>

              {!isCollapsed ? (
                <ul className="mt-1.5 space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === activePageId;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPage(item.id);
                            onCloseMobile();
                          }}
                          aria-current={isActive ? 'page' : undefined}
                          className={`group relative flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6A63C] cursor-pointer ${
                            isActive
                              ? 'bg-[#12345A] font-semibold text-white'
                              : 'font-medium text-slate-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {isActive ? (
                            <span
                              aria-hidden="true"
                              className="h-4 w-1 rounded-full bg-[#D6A63C] shrink-0"
                            />
                          ) : null}
                          <span className={isActive ? 'text-[#D6A63C]' : 'text-slate-400 group-hover:text-slate-200'}>
                            {getNavIcon(item.id)}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Quiet Institutional Footer */}
      <div className="border-t border-white/10 px-4 py-3 text-[11px] text-slate-300">
        <p className="font-medium text-white">Student Service Portal</p>
        <p className="mt-0.5 text-slate-400">College of Technology · LLCC</p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block lg:w-[272px] lg:shrink-0 lg:border-r lg:border-[#0B2340]">
        <div className="sticky top-0 h-screen">{sidebarBody}</div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#0B2340]/70"
            aria-hidden="true"
            onClick={onCloseMobile}
          />
          <aside className="relative z-50 w-72 max-w-[85vw] shadow-2xl">
            {sidebarBody}
          </aside>
        </div>
      ) : null}
    </>
  );
}
