import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { ApiClientError, apiGet } from '../services/apiClient.ts';
import type { StudentTaskRecord, TaskCategoryRecord } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { SelectInput } from '../components/ui/FormField.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface SectionRepTasksPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

export function SectionRepTasksPage({
  isAuthenticated,
  onReturnToOverview,
}: SectionRepTasksPageProps) {
  const [assigned, setAssigned] = useState(true);
  const [sectionLabel, setSectionLabel] = useState<string | null>(null);
  const [tasks, setTasks] = useState<StudentTaskRecord[]>([]);
  const [categories, setCategories] = useState<TaskCategoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setTasks([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{
        assigned: boolean;
        sectionLabel: string | null;
        tasks: StudentTaskRecord[];
        categories: TaskCategoryRecord[];
      }>('/api/v1/section-rep/tasks');
      setAssigned(res.assigned);
      setSectionLabel(res.sectionLabel);
      setTasks(res.tasks);
      setCategories(res.categories);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load authorized section tasks.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filteredTasks = tasks.filter((t) => {
    if (categoryFilter !== 'all' && String(t.categoryId) !== categoryFilter) {
      return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return (
      t.title.toLowerCase().includes(q) ||
      t.categoryName.toLowerCase().includes(q) ||
      (t.location ?? '').toLowerCase().includes(q)
    );
  });

  const columns: Array<TableColumn<StudentTaskRecord>> = [
    {
      key: 'title',
      header: 'Published RSS Task',
      render: (item) => (
        <div className="min-w-[210px]">
          <p className="font-semibold text-[#1E293B]">{item.title}</p>
          <p className="text-xs text-[#64748B]">
            {item.categoryName} · {item.location ?? 'Location TBA'}
          </p>
        </div>
      ),
    },
    {
      key: 'visibility',
      header: 'Section Scope',
      render: (item) => (
        <span className="text-xs font-medium text-[#12345A]">{item.eligibilityReason}</span>
      ),
    },
    {
      key: 'hours',
      header: 'Required Hours',
      align: 'right',
      render: (item) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {item.requiredHours !== null ? `${item.requiredHours.toFixed(2)}h` : 'Unspecified'}
        </span>
      ),
    },
    {
      key: 'capacity',
      header: 'Approved / Capacity',
      render: (item) => (
        <StatusBadge
          tone={item.isFull ? 'danger' : 'info'}
          label={
            item.capacity !== null
              ? `${item.approvedCount}/${item.capacity}`
              : `${item.approvedCount} (Unlimited)`
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'Section Scope (Read-Only)', 'Authorized Tasks']}
        title="Authorized Section RSS Tasks (Read-Only)"
        description={
          sectionLabel
            ? `Published RSS tasks visible to ${sectionLabel}.`
            : 'Published RSS tasks visible to your assigned section.'
        }
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadTasks()}
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
                Sign in with an active Section Representative account to view authorized tasks.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Read-only view of published RSS tasks targeting all college students or your assigned section. Task editing and approval controls remain restricted to the RSS Coordinator.
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

      {!loading && isAuthenticated && !assigned ? (
        <Card>
          <CardContent className="text-sm text-[#64748B]">
            Your Section Representative account does not have an assigned current section yet. Ask the RSS Coordinator to link your student profile and current section.
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={filteredTasks}
          rowKey={(r) => String(r.id)}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search published tasks by title, category, or location..."
          toolbarExtra={
            <SelectInput
              aria-label="Filter by task category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-auto min-w-[170px]"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.name}
                </option>
              ))}
            </SelectInput>
          }
          emptyTitle="No authorized section tasks yet"
          emptyDescription="Published RSS tasks targeting your college or assigned section will appear here."
        />
      )}
    </div>
  );
}
