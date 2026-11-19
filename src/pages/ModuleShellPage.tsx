import { useMemo, useState } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import type { NavItem, RoleName } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface ModuleShellPageProps {
  role: RoleName;
  item: NavItem;
  onReturnToOverview: () => void;
}

interface EmptyPlaceholderRow {
  id: string;
}

export function ModuleShellPage({ role, item, onReturnToOverview }: ModuleShellPageProps) {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const columns: Array<TableColumn<EmptyPlaceholderRow>> = useMemo(() => {
    const columnNames = item.plannedColumns ?? ['Record', 'Details', 'Status'];
    return columnNames.map((colName) => ({
      key: colName.toLowerCase().replace(/\s+/g, '-'),
      header: colName,
      render: () => null,
    }));
  }, [item.plannedColumns]);

  const trimmedSearch = search.trim();
  const emptyTitle = trimmedSearch
    ? `No records matching "${trimmedSearch}"`
    : item.emptyStateTitle;
  const emptyDescription = trimmedSearch
    ? `Database records for ${item.label} are not connected yet (${item.milestoneLabel}). Clear the search input to view the default empty state.`
    : item.emptyStateDescription;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', role, item.label]}
        title={item.label}
        description={item.description}
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              icon={<Info className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setModalOpen(true)}
            >
              Module Scope
            </Button>
            <Button variant="primary" size="md" onClick={onReturnToOverview}>
              Dashboard Overview
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] text-[#12345A] shrink-0">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1E293B]">{item.milestoneLabel}</p>
              <p className="text-xs text-[#64748B]">
                Milestone-gated shell view. No sample or fabricated institutional records are displayed.
              </p>
            </div>
          </div>
          <StatusBadge
            tone="neutral"
            label={`Planned M${String(item.milestoneNumber).padStart(2, '0')}`}
          />
        </CardContent>
      </Card>

      {item.plannedColumns && item.plannedColumns.length > 0 ? (
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={`Search ${item.label.toLowerCase()}...`}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          emptyAction={
            trimmedSearch ? (
              <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                Clear Search
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
                View Planned Scope
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <EmptyState
            title={item.emptyStateTitle}
            description={item.emptyStateDescription}
            action={
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
                Inspect Planned Scope
              </Button>
            }
          />
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${item.label} — Planned Specification`}
        description={item.milestoneLabel}
        footer={
          <Button variant="primary" size="sm" onClick={() => setModalOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="leading-relaxed text-[#1E293B]">{item.description}</p>
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-3 text-xs text-[#64748B]">
            <p className="font-semibold text-[#12345A]">Milestone Gate Policy</p>
            <p className="mt-1">
              This route is part of the Milestone 1 shared navigation shell. PostgreSQL queries, backend validation, and CRUD operations for this module are implemented strictly in{' '}
              <span className="font-medium text-[#1E293B]">{item.milestoneLabel}</span>.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
