import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { EmptyState } from './EmptyState.tsx';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbarExtra?: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  toolbarExtra,
  emptyTitle,
  emptyDescription,
  emptyAction,
  page = 1,
  totalPages = 1,
  onPageChange,
}: DataTableProps<T>) {
  const showToolbar = onSearchChange !== undefined || toolbarExtra !== undefined;

  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white">
      {showToolbar ? (
        <div className="flex flex-col gap-3 border-b border-[#E2E8F0] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          {onSearchChange !== undefined ? (
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchValue ?? ''}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-10 w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-sm text-[#1E293B] placeholder:text-[#64748B] focus:border-[#12345A] focus:outline-none focus:ring-2 focus:ring-[#12345A]/20"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbarExtra ? (
            <div className="flex flex-wrap items-center gap-2">{toolbarExtra}</div>
          ) : null}
        </div>
      ) : null}

      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F4F6FA]">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-4 py-3 text-xs font-semibold tracking-wide text-[#64748B] whitespace-nowrap ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0]">
            {loading ? (
              Array.from({ length: 4 }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="h-12">
                  {columns.map((column) => (
                    <td key={`${column.key}-${rowIndex}`} className="px-4 py-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length > 0 ? (
              rows.map((row) => (
                <tr key={rowKey(row)} className="min-h-11 transition-colors hover:bg-[#F4F6FA]/70">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 text-[#1E293B] ${
                        column.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <EmptyState
                    title={emptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {onPageChange && totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] px-4 py-3 text-xs text-[#64748B] sm:px-5">
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 font-medium text-[#1E293B] hover:bg-[#F4F6FA] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 font-medium text-[#1E293B] hover:bg-[#F4F6FA] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
