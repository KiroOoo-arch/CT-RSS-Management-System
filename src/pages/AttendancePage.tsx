import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Info,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { ApiClientError, apiGet, apiPatch, apiPost } from '../services/apiClient.ts';
import type {
  AttendanceRecord,
  AttendanceVerificationStatus,
  SessionRosterParticipant,
  TaskDetailRecord,
  TaskListResponse,
  TaskRecord,
  TaskSessionRecord,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/Card.tsx';
import { DataTable, type TableColumn } from '../components/ui/DataTable.tsx';
import {
  FormField,
  SelectInput,
  TextareaInput,
  TextInput,
} from '../components/ui/FormField.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface AttendancePageProps {
  mode: 'coordinator' | 'student';
  isAuthenticated: boolean;
  onReturnToOverview: () => void;
}

function renderVerificationBadge(status: AttendanceVerificationStatus) {
  switch (status) {
    case 'verified':
      return <StatusBadge tone="success" label="Verified" />;
    case 'rejected':
      return <StatusBadge tone="danger" label="Rejected" />;
    default:
      return <StatusBadge tone="warning" label="Pending Verification" />;
  }
}

export function AttendancePage({
  mode,
  isAuthenticated,
  onReturnToOverview,
}: AttendancePageProps) {
  const isCoordinator = mode === 'coordinator';

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceVerificationStatus>('all');

  // Coordinator Task/Session Roster state
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [sessions, setSessions] = useState<TaskSessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [rosterParticipants, setRosterParticipants] = useState<SessionRosterParticipant[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Record Attendance Modal
  const [recordingParticipant, setRecordingParticipant] =
    useState<SessionRosterParticipant | null>(null);
  const [attDate, setAttDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [recordedHours, setRecordedHours] = useState('');
  const [markAbsent, setMarkAbsent] = useState(false);
  const [autoVerify, setAutoVerify] = useState(true);
  const [attRemarks, setAttRemarks] = useState('');
  const [savingRecord, setSavingRecord] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Verify / Correct Modal
  const [verifyingRecord, setVerifyingRecord] = useState<AttendanceRecord | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<AttendanceVerificationStatus>('verified');
  const [verifiedHoursInput, setVerifiedHoursInput] = useState('');
  const [correctCheckIn, setCorrectCheckIn] = useState('');
  const [correctCheckOut, setCorrectCheckOut] = useState('');
  const [verifyRemarks, setVerifyRemarks] = useState('');
  const [savingVerify, setSavingVerify] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadAttendance = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      setRecords([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isCoordinator) {
        const params = new URLSearchParams();
        if (selectedTaskId) {
          params.set('taskId', selectedTaskId);
        }
        if (selectedSessionId) {
          params.set('taskSessionId', selectedSessionId);
        }
        if (statusFilter !== 'all') {
          params.set('verificationStatus', statusFilter);
        }
        if (search.trim()) {
          params.set('search', search.trim());
        }
        const qs = params.toString();
        const res = await apiGet<{ records: AttendanceRecord[] }>(
          `/api/v1/coordinator/attendance${qs ? `?${qs}` : ''}`,
        );
        setRecords(res.records);
      } else {
        const res = await apiGet<{ records: AttendanceRecord[] }>('/api/v1/student/attendance');
        const q = search.trim().toLowerCase();
        const filtered = res.records.filter((r) => {
          if (statusFilter !== 'all' && r.verificationStatus !== statusFilter) {
            return false;
          }
          if (!q) {
            return true;
          }
          return (
            r.taskTitle.toLowerCase().includes(q) ||
            r.sessionTitle.toLowerCase().includes(q) ||
            r.sessionLocation.toLowerCase().includes(q)
          );
        });
        setRecords(filtered);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load attendance records from the server.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoordinator, selectedTaskId, selectedSessionId, statusFilter, search]);

  const loadCoordinatorTasks = useCallback(async () => {
    if (!isAuthenticated || !isCoordinator) {
      return;
    }
    try {
      const res = await apiGet<TaskListResponse>('/api/v1/coordinator/tasks?page=1&pageSize=100');
      setTasks(res.tasks);
    } catch {
      // Handled gracefully
    }
  }, [isAuthenticated, isCoordinator]);

  const loadTaskSessions = useCallback(
    async (taskId: string) => {
      if (!isAuthenticated || !isCoordinator || !taskId) {
        setSessions([]);
        setSelectedSessionId('');
        setRosterParticipants([]);
        return;
      }
      try {
        const res = await apiGet<{ task: TaskDetailRecord }>(`/api/v1/coordinator/tasks/${taskId}`);
        setSessions(res.task.sessions);
        if (res.task.sessions.length > 0) {
          setSelectedSessionId(String(res.task.sessions[0].id));
        } else {
          setSelectedSessionId('');
          setRosterParticipants([]);
        }
      } catch {
        setSessions([]);
      }
    },
    [isAuthenticated, isCoordinator],
  );

  const loadSessionRoster = useCallback(
    async (sessionId: string) => {
      if (!isAuthenticated || !isCoordinator || !sessionId) {
        setRosterParticipants([]);
        return;
      }
      setRosterLoading(true);
      try {
        const res = await apiGet<{
          session: TaskSessionRecord;
          participants: SessionRosterParticipant[];
        }>(`/api/v1/coordinator/attendance/sessions/${sessionId}/roster`);
        setRosterParticipants(res.participants);
      } catch {
        setRosterParticipants([]);
      } finally {
        setRosterLoading(false);
      }
    },
    [isAuthenticated, isCoordinator],
  );

  useEffect(() => {
    void loadCoordinatorTasks();
  }, [loadCoordinatorTasks]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    if (selectedTaskId) {
      void loadTaskSessions(selectedTaskId);
    } else {
      setSessions([]);
      setSelectedSessionId('');
      setRosterParticipants([]);
    }
  }, [selectedTaskId, loadTaskSessions]);

  useEffect(() => {
    if (selectedSessionId) {
      void loadSessionRoster(selectedSessionId);
    }
  }, [selectedSessionId, loadSessionRoster]);

  const activeSession = sessions.find((s) => String(s.id) === selectedSessionId) ?? null;

  const openRecordModal = (participant: SessionRosterParticipant) => {
    setRecordingParticipant(participant);
    setAttDate(activeSession?.sessionDate ?? '');
    setCheckIn(activeSession?.startTime?.slice(0, 5) ?? '08:00');
    setCheckOut(activeSession?.endTime?.slice(0, 5) ?? '12:00');
    setRecordedHours('');
    setMarkAbsent(false);
    setAutoVerify(true);
    setAttRemarks('');
    setRecordError(null);
  };

  const handleSaveAttendance = async () => {
    if (!recordingParticipant || !selectedSessionId) {
      return;
    }
    setSavingRecord(true);
    setRecordError(null);
    try {
      await apiPost('/api/v1/coordinator/attendance', {
        applicationId: recordingParticipant.applicationId,
        taskSessionId: Number(selectedSessionId),
        attendanceDate: attDate || undefined,
        checkIn: markAbsent ? null : checkIn || null,
        checkOut: markAbsent ? null : checkOut || null,
        recordedHours: !markAbsent && recordedHours.trim() ? Number(recordedHours) : undefined,
        markAbsent,
        autoVerify,
        remarks: attRemarks.trim() || undefined,
      });
      setFeedback(`Attendance recorded for ${recordingParticipant.studentName}.`);
      setRecordingParticipant(null);
      await Promise.all([loadSessionRoster(selectedSessionId), loadAttendance()]);
    } catch (err) {
      setRecordError(
        err instanceof ApiClientError ? err.message : 'Unable to record attendance.',
      );
    } finally {
      setSavingRecord(false);
    }
  };

  const openVerifyModal = (record: AttendanceRecord) => {
    setVerifyingRecord(record);
    setVerifyStatus(record.verificationStatus === 'pending' ? 'verified' : record.verificationStatus);
    setVerifiedHoursInput(
      String(record.verifiedHours > 0 ? record.verifiedHours : record.recordedHours),
    );
    setCorrectCheckIn(record.checkIn ? record.checkIn.slice(0, 5) : '');
    setCorrectCheckOut(record.checkOut ? record.checkOut.slice(0, 5) : '');
    setVerifyRemarks(record.remarks ?? '');
    setVerifyError(null);
  };

  const handleVerifyAttendance = async () => {
    if (!verifyingRecord) {
      return;
    }
    setSavingVerify(true);
    setVerifyError(null);
    try {
      await apiPatch(`/api/v1/coordinator/attendance/${verifyingRecord.id}`, {
        verificationStatus: verifyStatus,
        verifiedHours: verifyStatus === 'verified' ? Number(verifiedHoursInput || 0) : 0,
        checkIn: correctCheckIn.trim() ? correctCheckIn.trim() : null,
        checkOut: correctCheckOut.trim() ? correctCheckOut.trim() : null,
        remarks: verifyRemarks.trim() || undefined,
      });
      setFeedback(`Attendance #${verifyingRecord.id} updated (${verifyStatus}).`);
      setVerifyingRecord(null);
      await Promise.all([
        selectedSessionId ? loadSessionRoster(selectedSessionId) : Promise.resolve(),
        loadAttendance(),
      ]);
    } catch (err) {
      setVerifyError(
        err instanceof ApiClientError ? err.message : 'Unable to update attendance verification.',
      );
    } finally {
      setSavingVerify(false);
    }
  };

  const attendanceColumns: Array<TableColumn<AttendanceRecord>> = [
    ...(isCoordinator
      ? [
          {
            key: 'student',
            header: 'Student',
            render: (r: AttendanceRecord) => (
              <div className="min-w-[160px]">
                <p className="font-semibold text-[#1E293B]">{r.studentName}</p>
                <p className="font-mono text-xs text-[#64748B] tabular-nums">
                  {r.studentNumber} · {r.sectionLabel ?? 'No Section'}
                </p>
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'session',
      header: 'Task & Session',
      render: (r) => (
        <div className="min-w-[190px]">
          <p className="font-medium text-[#1E293B]">{r.taskTitle}</p>
          <p className="text-xs text-[#64748B]">
            {r.sessionTitle} · {r.attendanceDate}
          </p>
        </div>
      ),
    },
    {
      key: 'time',
      header: 'Check-In / Out',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.checkIn || r.checkOut
            ? `${r.checkIn ?? '—'} – ${r.checkOut ?? '—'}`
            : r.remarks?.startsWith('[ABSENT]')
              ? 'Marked Absent'
              : '—'}
        </span>
      ),
    },
    {
      key: 'hours',
      header: 'Recorded / Verified',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-xs text-[#1E293B] tabular-nums">
          {r.recordedHours.toFixed(2)}h / <strong>{r.verifiedHours.toFixed(2)}h</strong>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Verification',
      render: (r) => renderVerificationBadge(r.verificationStatus),
    },
    ...(isCoordinator
      ? [
          {
            key: 'action',
            header: 'Action',
            align: 'right' as const,
            render: (r: AttendanceRecord) => (
              <Button
                variant="secondary"
                size="sm"
                icon={<ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => openVerifyModal(r)}
              >
                {r.verificationStatus === 'pending' ? 'Verify' : 'Edit'}
              </Button>
            ),
          },
        ]
      : [
          {
            key: 'remarks',
            header: 'Coordinator Remarks',
            render: (r: AttendanceRecord) => (
              <span className="text-xs text-[#64748B]">{r.remarks ?? '—'}</span>
            ),
          },
        ]),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          'Lapu-Lapu City College',
          isCoordinator ? 'RSS Operations' : 'RSS Participation',
          'Attendance',
        ]}
        title={isCoordinator ? 'Session Attendance & Verification' : 'My Session Attendance'}
        description={
          isCoordinator
            ? 'Record session check-in/out or absences for approved task participants and verify earned hours.'
            : 'View recorded task session attendance, check-in/out times, and Coordinator verification status.'
        }
        actions={
          <>
            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void loadAttendance()}
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
                Sign in to access live session attendance rosters and verification controls.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#64748B]">
        <Info className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
        <span>
          Only <strong className="text-[#1E293B]">verified</strong> attendance hours count toward official student RSS service totals. Absent markings are stored with <code className="font-mono">[ABSENT]</code> remarks and 0.00 verified hours (constrained by the approved 28-table schema).
        </span>
      </div>

      {feedback ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{feedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-medium text-emerald-800 hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
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

      {isCoordinator && isAuthenticated ? (
        <Card>
          <CardHeader
            title="Session Attendance Roster"
            description="Select an RSS task and scheduled session to record attendance for approved participants."
          />
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="att-task-select" label="Select RSS Task">
                <SelectInput
                  id="att-task-select"
                  value={selectedTaskId}
                  onChange={(e) => setSelectedTaskId(e.target.value)}
                >
                  <option value="">All Tasks (Select to open session roster)</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.title} ({t.status})
                    </option>
                  ))}
                </SelectInput>
              </FormField>

              <FormField id="att-session-select" label="Select Task Session">
                <SelectInput
                  id="att-session-select"
                  value={selectedSessionId}
                  disabled={!selectedTaskId || sessions.length === 0}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                >
                  <option value="">
                    {!selectedTaskId
                      ? 'Select a task first'
                      : sessions.length === 0
                        ? 'No sessions scheduled for this task'
                        : 'All sessions'}
                  </option>
                  {sessions.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.sessionTitle} — {s.sessionDate} ({s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)})
                    </option>
                  ))}
                </SelectInput>
              </FormField>
            </div>

            {selectedSessionId ? (
              rosterLoading ? (
                <p className="py-4 text-xs text-[#64748B]">Loading approved participant roster...</p>
              ) : rosterParticipants.length === 0 ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-4 text-center text-xs text-[#64748B]">
                  No approved student applications exist for this task yet.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {rosterParticipants.map((p) => (
                    <div
                      key={p.applicationId}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1E293B]">{p.studentName}</p>
                        <p className="font-mono text-xs text-[#64748B] tabular-nums">
                          {p.studentNumber} · {p.sectionLabel ?? 'Unassigned Section'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.attendance ? (
                          <>
                            {renderVerificationBadge(p.attendance.verificationStatus)}
                            <span className="font-mono text-xs text-[#1E293B] tabular-nums">
                              {p.attendance.verifiedHours.toFixed(2)}h
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openVerifyModal(p.attendance!)}
                            >
                              Verify / Edit
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<UserPlus className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() => openRecordModal(p)}
                          >
                            Record Attendance
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={attendanceColumns}
        rows={records}
        rowKey={(row) => String(row.id)}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={
          isCoordinator
            ? 'Search attendance by student, task, or session...'
            : 'Search your attendance by task or session...'
        }
        toolbarExtra={
          <SelectInput
            aria-label="Filter by verification status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | AttendanceVerificationStatus)
            }
            className="w-auto min-w-[170px]"
          >
            <option value="all">All Verification States</option>
            <option value="pending">Pending Verification</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </SelectInput>
        }
        emptyTitle="No attendance records yet"
        emptyDescription={
          isCoordinator
            ? 'Select a task session above to record attendance for approved participants.'
            : 'Attendance recorded by the RSS Coordinator for your approved task sessions will appear here.'
        }
      />

      {/* Record Attendance Modal */}
      <Modal
        open={recordingParticipant !== null}
        onClose={() => setRecordingParticipant(null)}
        title="Record Session Attendance"
        description={
          recordingParticipant
            ? `${recordingParticipant.studentName} (${recordingParticipant.studentNumber})`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRecordingParticipant(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={savingRecord}
              icon={<CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void handleSaveAttendance()}
            >
              Save Attendance
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {recordError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
            >
              {recordError}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs font-medium text-[#1E293B] cursor-pointer">
            <input
              type="checkbox"
              checked={markAbsent}
              onChange={(e) => setMarkAbsent(e.target.checked)}
              className="h-4 w-4 rounded border-[#E2E8F0]"
            />
            <span>Mark participant as Absent (records 0.00 hours)</span>
          </label>

          <FormField id="rec-att-date" label="Attendance Date" required>
            <TextInput
              id="rec-att-date"
              type="date"
              value={attDate}
              onChange={(e) => setAttDate(e.target.value)}
            />
          </FormField>

          {!markAbsent ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField id="rec-checkin" label="Check-In">
                <TextInput
                  id="rec-checkin"
                  type="time"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </FormField>
              <FormField id="rec-checkout" label="Check-Out">
                <TextInput
                  id="rec-checkout"
                  type="time"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </FormField>
              <FormField id="rec-hours" label="Hours (Optional)">
                <TextInput
                  id="rec-hours"
                  type="number"
                  step="0.25"
                  min="0"
                  placeholder="Auto from times"
                  value={recordedHours}
                  onChange={(e) => setRecordedHours(e.target.value)}
                />
              </FormField>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs font-medium text-[#1E293B] cursor-pointer">
            <input
              type="checkbox"
              checked={autoVerify}
              onChange={(e) => setAutoVerify(e.target.checked)}
              className="h-4 w-4 rounded border-[#E2E8F0]"
            />
            <span>Immediately mark as Coordinator Verified</span>
          </label>

          <FormField id="rec-remarks" label="Remarks (Optional)">
            <TextareaInput
              id="rec-remarks"
              rows={2}
              value={attRemarks}
              onChange={(e) => setAttRemarks(e.target.value)}
              placeholder="Notes on participation or attendance..."
            />
          </FormField>
        </div>
      </Modal>

      {/* Verify / Correct Attendance Modal */}
      <Modal
        open={verifyingRecord !== null}
        onClose={() => setVerifyingRecord(null)}
        title="Verify or Correct Attendance"
        description={
          verifyingRecord
            ? `${verifyingRecord.studentName} — ${verifyingRecord.taskTitle} (${verifyingRecord.sessionTitle})`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setVerifyingRecord(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={savingVerify}
              onClick={() => void handleVerifyAttendance()}
            >
              Save Verification
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {verifyError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
            >
              {verifyError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="ver-status" label="Verification Status" required>
              <SelectInput
                id="ver-status"
                value={verifyStatus}
                onChange={(e) =>
                  setVerifyStatus(e.target.value as AttendanceVerificationStatus)
                }
              >
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
              </SelectInput>
            </FormField>

            <FormField id="ver-hours" label="Verified Hours" required>
              <TextInput
                id="ver-hours"
                type="number"
                step="0.25"
                min="0"
                disabled={verifyStatus !== 'verified'}
                value={verifyStatus === 'verified' ? verifiedHoursInput : '0'}
                onChange={(e) => setVerifiedHoursInput(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="ver-checkin" label="Corrected Check-In">
              <TextInput
                id="ver-checkin"
                type="time"
                value={correctCheckIn}
                onChange={(e) => setCorrectCheckIn(e.target.value)}
              />
            </FormField>
            <FormField id="ver-checkout" label="Corrected Check-Out">
              <TextInput
                id="ver-checkout"
                type="time"
                value={correctCheckOut}
                onChange={(e) => setCorrectCheckOut(e.target.value)}
              />
            </FormField>
          </div>

          <FormField id="ver-remarks" label="Coordinator Remarks">
            <TextareaInput
              id="ver-remarks"
              rows={2}
              value={verifyRemarks}
              onChange={(e) => setVerifyRemarks(e.target.value)}
              placeholder="Explain hour adjustments or verification notes..."
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
