import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import { ApiClientError, apiGet, apiPost } from '../services/apiClient.ts';
import type { RegistrationRecord } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import { FormField, TextareaInput } from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface RegistrationsPageProps {
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

export function RegistrationsPage({
  isAuthenticated,
  onReturnToOverview,
}: RegistrationsPageProps) {
  const [rows, setRows] = useState<RegistrationRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [selectedRecord, setSelectedRecord] = useState<RegistrationRecord | null>(null);
  const [pendingDecision, setPendingDecision] = useState<'approved' | 'rejected' | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  const loadRegistrations = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ registrations: RegistrationRecord[] }>(
        '/api/v1/coordinator/registrations',
      );
      setRows(res.registrations);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to load student registrations from the server.');
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((item) => {
      if (statusFilter !== 'all' && item.registrationStatus !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        item.studentNumber.toLowerCase().includes(query) ||
        item.fullName.toLowerCase().includes(query) ||
        item.email.toLowerCase().includes(query)
      );
    });
  }, [rows, search, statusFilter]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage]);

  const handleConfirmDecision = async () => {
    if (!selectedRecord || !pendingDecision) {
      return;
    }
    setSubmittingDecision(true);
    setError(null);
    try {
      await apiPost(`/api/v1/coordinator/registrations/${selectedRecord.studentId}/decision`, {
        decision: pendingDecision,
        remarks: remarks.trim() || undefined,
      });
      setSelectedRecord(null);
      setPendingDecision(null);
      setRemarks('');
      await loadRegistrations();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to save Coordinator registration decision.');
      }
    } finally {
      setSubmittingDecision(false);
    }
  };

  const columns: Array<TableColumn<RegistrationRecord>> = [
    {
      key: 'studentNumber',
      header: 'Student Number',
      render: (item) => (
        <span className="font-mono text-xs font-semibold text-[#12345A] tabular-nums">
          {item.studentNumber}
        </span>
      ),
    },
    {
      key: 'fullName',
      header: 'Full Name',
      render: (item) => (
        <div>
          <p className="font-medium text-[#1E293B]">{item.fullName}</p>
          <p className="text-xs text-[#64748B]">{item.email}</p>
        </div>
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted At',
      render: (item) => (
        <span className="text-xs text-[#64748B] tabular-nums">
          {new Date(item.submittedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Registration Status',
      render: (item) => {
        if (item.registrationStatus === 'approved') {
          return <StatusBadge tone="success" label="Approved" />;
        }
        if (item.registrationStatus === 'rejected') {
          return <StatusBadge tone="danger" label="Rejected" />;
        }
        return <StatusBadge tone="warning" label="Pending Review" />;
      },
    },
    {
      key: 'actions',
      header: 'Coordinator Action',
      align: 'right',
      render: (item) =>
        item.registrationStatus === 'pending' ? (
          <div className="inline-flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => {
                setSelectedRecord(item);
                setPendingDecision('approved');
                setRemarks('');
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => {
                setSelectedRecord(item);
                setPendingDecision('rejected');
                setRemarks('');
              }}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-xs text-[#64748B]">Reviewed</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={['Lapu-Lapu City College', 'RSS Coordinator', 'Registrations']}
        title="Student Registration Approvals"
        description="Verify pending student accounts against institutional records before activating Student Service Portal access."
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadRegistrations()}
              >
                Refresh Queue
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
              <p className="font-semibold">Authenticated Coordinator Session Required</p>
              <p className="mt-0.5 text-xs text-[#64748B]">
                You are viewing the unauthenticated development UI preview. Sign in as an RSS Coordinator with a connected PostgreSQL database to load and approve student registrations.
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

      <DataTable
        columns={columns}
        rows={paginatedRows}
        rowKey={(row) => String(row.studentId)}
        loading={loading}
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Search by student number, full name, or email..."
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
        toolbarExtra={
          <div
            role="group"
            aria-label="Filter registrations by status"
            className="inline-flex rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-1"
          >
            {(['all', 'pending', 'approved', 'rejected'] as StatusFilter[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setStatusFilter(tab);
                  setPage(1);
                }}
                className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium capitalize whitespace-nowrap transition-colors cursor-pointer ${
                  statusFilter === tab
                    ? 'bg-[#12345A] text-white'
                    : 'text-[#64748B] hover:text-[#1E293B]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        }
        emptyTitle="No student registrations found"
        emptyDescription={
          isAuthenticated
            ? 'New student registration requests submitted from the portal sign-in page will appear here for verification.'
            : 'Registration records load once PostgreSQL is configured and an RSS Coordinator signs in.'
        }
      />

      <Modal
        open={Boolean(selectedRecord && pendingDecision)}
        onClose={() => {
          if (!submittingDecision) {
            setSelectedRecord(null);
            setPendingDecision(null);
          }
        }}
        title={
          pendingDecision === 'approved'
            ? 'Approve Student Registration'
            : 'Reject Student Registration'
        }
        description={
          selectedRecord
            ? `${selectedRecord.fullName} (${selectedRecord.studentNumber})`
            : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={submittingDecision}
              onClick={() => {
                setSelectedRecord(null);
                setPendingDecision(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={pendingDecision === 'rejected' ? 'danger' : 'primary'}
              size="sm"
              loading={submittingDecision}
              onClick={() => void handleConfirmDecision()}
            >
              {pendingDecision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[#64748B]">
            {pendingDecision === 'approved'
              ? 'Approving this registration activates the student account and enables sign-in.'
              : 'Rejecting this registration deactivates the pending account and notifies the applicant.'}
          </p>
          <FormField id="decision-remarks" label="Coordinator Remarks (Optional)">
            <TextareaInput
              id="decision-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Add verification notes for the audit log..."
              disabled={submittingDecision}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
