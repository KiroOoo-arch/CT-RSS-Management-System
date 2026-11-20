export type RoleName = 'RSS Coordinator' | 'Student' | 'Section Representative';

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'deactivated';

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export type MilestoneStatus = 'in_progress' | 'pending' | 'completed';

export interface MilestoneItem {
  number: number;
  title: string;
  status: MilestoneStatus;
  summary: string;
}

export interface DatabaseReadiness {
  engine: 'PostgreSQL';
  status: 'not_configured' | 'unavailable' | 'connected';
  configuredVariables: string[];
  missingVariables: string[];
  tableCountTarget: number;
  actualTableCount: number | null;
  message: string;
}

export interface FoundationSnapshot {
  systemName: string;
  institution: string;
  initialScope: string;
  currentMilestone: number;
  roles: Array<{
    name: RoleName;
    authoritySummary: string;
  }>;
  milestones: MilestoneItem[];
  database: DatabaseReadiness;
  runtime: {
    nodeVersion: string;
    environment: string;
  };
}

export interface StudentSectionSnapshot {
  historyId: number;
  sectionId: number;
  sectionName: string;
  programId: number;
  programCode: string;
  programName: string;
  yearLevelId: number;
  yearLevelName: string;
  academicYearId: number;
  academicYearName: string;
  enrolledAt: string;
  endedAt: string | null;
  isCurrent: boolean;
}

export interface StudentSummary {
  id: number;
  studentNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  sex: string | null;
  birthDate: string | null;
  contactNumber: string | null;
  registrationStatus: RegistrationStatus;
  reviewedBy: number | null;
  reviewedAt: string | null;
}

export interface AuthenticatedUser {
  id: number;
  name: string;
  email: string;
  accountStatus: AccountStatus;
  roles: RoleName[];
  primaryRole: RoleName;
  student: StudentSummary | null;
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  csrfToken: string;
}

export interface RegistrationRecord {
  studentId: number;
  userId: number;
  studentNumber: string;
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  email: string;
  contactNumber: string | null;
  accountStatus: AccountStatus;
  registrationStatus: RegistrationStatus;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface CollegeRecord {
  id: number;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface YearLevelRecord {
  id: number;
  name: string;
  sortOrder: number;
}

export type AcademicYearPeriodStatus = 'current' | 'upcoming' | 'past' | 'inactive';

export interface AcademicYearRecord {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  periodStatus: AcademicYearPeriodStatus;
  studentAssignmentCount: number;
  reportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramRecord {
  id: number;
  collegeId: number;
  collegeName: string;
  collegeCode: string;
  code: string;
  name: string;
  isActive: boolean;
  sectionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SectionRecord {
  id: number;
  programId: number;
  programCode: string;
  programName: string;
  collegeId: number;
  collegeName: string;
  yearLevelId: number;
  yearLevelName: string;
  yearLevelSortOrder: number;
  name: string;
  isActive: boolean;
  currentStudentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SectionStudentItem {
  studentId: number;
  userId: number;
  studentNumber: string;
  fullName: string;
  email: string;
  accountStatus: AccountStatus;
  registrationStatus: RegistrationStatus;
  academicYearId: number;
  academicYearName: string;
  enrolledAt: string;
}

export interface StudentDirectoryRecord {
  studentId: number;
  userId: number;
  studentNumber: string;
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  email: string;
  sex: string | null;
  birthDate: string | null;
  contactNumber: string | null;
  accountStatus: AccountStatus;
  registrationStatus: RegistrationStatus;
  currentSection: StudentSectionSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentDetailRecord extends StudentDirectoryRecord {
  reviewedBy: number | null;
  reviewedAt: string | null;
  sectionHistory: StudentSectionSnapshot[];
}

export interface StudentListResponse {
  students: StudentDirectoryRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type TaskVisibility = 'all_students' | 'specific_sections' | 'selected_students';

export type TaskStatus =
  | 'draft'
  | 'published'
  | 'ongoing'
  | 'completed'
  | 'cancelled'
  | 'archived';

export interface TaskCategoryRecord {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTargetSectionItem {
  sectionId: number;
  sectionName: string;
  programId: number;
  programCode: string;
  programName: string;
  yearLevelId: number;
  yearLevelName: string;
  isActive: boolean;
  currentStudentCount: number;
}

export interface TaskTargetStudentItem {
  studentId: number;
  userId: number;
  studentNumber: string;
  fullName: string;
  email: string;
  accountStatus: AccountStatus;
  registrationStatus: RegistrationStatus;
  sectionLabel: string | null;
}

export interface TaskSessionRecord {
  id: number;
  taskId: number;
  sessionTitle: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  location: string;
  attendanceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: number;
  collegeId: number;
  collegeCode: string;
  collegeName: string;
  categoryId: number;
  categoryName: string;
  categoryIsActive: boolean;
  createdBy: number;
  createdByName: string;
  title: string;
  description: string;
  location: string | null;
  visibility: TaskVisibility;
  capacity: number | null;
  approvedCount: number;
  pendingCount: number;
  remainingCapacity: number | null;
  requiredHours: number | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  activityStart: string | null;
  activityEnd: string | null;
  status: TaskStatus;
  sessionCount: number;
  targetSectionCount: number;
  targetStudentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetailRecord extends TaskRecord {
  targetSections: TaskTargetSectionItem[];
  targetStudents: TaskTargetStudentItem[];
  sessions: TaskSessionRecord[];
  eligibleStudentCount: number;
}

export interface TaskListResponse {
  tasks: TaskRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StudentTaskRecord {
  id: number;
  collegeId: number;
  collegeCode: string;
  collegeName: string;
  categoryId: number;
  categoryName: string;
  title: string;
  description: string;
  location: string | null;
  visibility: TaskVisibility;
  eligibilityReason: string;
  capacity: number | null;
  approvedCount: number;
  remainingCapacity: number | null;
  isFull: boolean;
  requiredHours: number | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  activityStart: string | null;
  activityEnd: string | null;
  status: TaskStatus;
  sessionCount: number;
  myApplicationStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentTaskDetailRecord extends StudentTaskRecord {
  sessions: TaskSessionRecord[];
}

// ---------------------------------------------------------------------------
// Module 6: Task Applications & Reviews
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'cancelled';

export interface ApplicationReviewRecord {
  id: number;
  applicationId: number;
  reviewedBy: number;
  reviewedByName: string;
  decision: 'approved' | 'rejected';
  remarks: string | null;
  reviewedAt: string;
}

export interface TaskApplicationRecord {
  id: number;
  taskId: number;
  taskTitle: string;
  taskStatus: TaskStatus;
  taskVisibility: TaskVisibility;
  taskCapacity: number | null;
  taskApprovedCount: number;
  taskRequiredHours: number | null;
  categoryName: string;
  studentId: number;
  studentUserId: number;
  studentNumber: string;
  studentName: string;
  studentEmail: string;
  sectionLabel: string | null;
  academicYearName: string | null;
  applicationMessage: string | null;
  status: ApplicationStatus;
  appliedAt: string;
  decidedAt: string | null;
  latestRemarks: string | null;
  verifiedAttendanceCount: number;
  hasSubmittedAccomplishment: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskApplicationDetailRecord extends TaskApplicationRecord {
  reviews: ApplicationReviewRecord[];
}

export interface ApplicationListResponse {
  applications: TaskApplicationRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Module 7: Attendance & Service Hours
// ---------------------------------------------------------------------------

export type AttendanceVerificationStatus = 'pending' | 'verified' | 'rejected';

export interface AttendanceRecord {
  id: number;
  applicationId: number;
  taskId: number;
  taskTitle: string;
  taskSessionId: number;
  sessionTitle: string;
  sessionDate: string;
  sessionStartTime: string;
  sessionEndTime: string;
  sessionLocation: string;
  studentId: number;
  studentNumber: string;
  studentName: string;
  sectionLabel: string | null;
  attendanceDate: string;
  checkIn: string | null;
  checkOut: string | null;
  recordedHours: number;
  verifiedHours: number;
  verificationStatus: AttendanceVerificationStatus;
  verifiedBy: number | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRosterParticipant {
  applicationId: number;
  studentId: number;
  studentNumber: string;
  studentName: string;
  sectionLabel: string | null;
  attendance: AttendanceRecord | null;
}

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface ServiceHourAdjustmentRecord {
  id: number;
  applicationId: number;
  taskId: number;
  taskTitle: string;
  studentId: number;
  studentNumber: string;
  studentName: string;
  sectionLabel: string | null;
  requestedBy: number;
  requestedByName: string;
  approvedBy: number | null;
  approvedByName: string | null;
  adjustmentHours: number;
  reason: string;
  status: AdjustmentStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentServiceHoursLedgerItem {
  studentId: number;
  studentNumber: string;
  studentName: string;
  sectionLabel: string | null;
  academicYearName: string | null;
  verifiedAttendanceHours: number;
  pendingAttendanceHours: number;
  rejectedAttendanceHours: number;
  approvedAdjustmentHours: number;
  pendingAdjustmentHours: number;
  totalCreditedHours: number;
  verifiedSessionCount: number;
  pendingSessionCount: number;
}

export interface ServiceHourBreakdownTaskItem {
  applicationId: number;
  taskId: number;
  taskTitle: string;
  categoryName: string;
  requiredHours: number | null;
  verifiedAttendanceHours: number;
  pendingAttendanceHours: number;
  approvedAdjustmentHours: number;
  totalCreditedHours: number;
}

export interface ServiceHoursSummaryResponse {
  ledger: StudentServiceHoursLedgerItem[];
  students?: StudentServiceHoursLedgerItem[];
  adjustments: ServiceHourAdjustmentRecord[];
  breakdown: ServiceHourBreakdownTaskItem[];
  attendanceRecords: AttendanceRecord[];
}

// ---------------------------------------------------------------------------
// Module 8: Accomplishments & Categorized Evidence
// ---------------------------------------------------------------------------

export type AccomplishmentStatus =
  | 'draft'
  | 'submitted'
  | 'revision_required'
  | 'approved'
  | 'rejected';

export type EvidenceImageCategory = 'before' | 'during' | 'after' | 'other';

export interface EvidenceImageRecord {
  id: number;
  submissionId: number;
  uploadedBy: number;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  imageCategory: EvidenceImageCategory;
  caption: string | null;
  displayOrder: number;
  createdAt: string;
  downloadUrl: string;
}

export interface AccomplishmentReviewRecord {
  id: number;
  submissionId: number;
  reviewedBy: number;
  reviewedByName: string;
  decision: 'approved' | 'revision_required' | 'rejected';
  remarks: string | null;
  reviewedAt: string;
}

export interface AccomplishmentSubmissionRecord {
  id: number;
  accomplishmentId: number;
  submittedBy: number;
  submittedByName: string;
  versionNumber: number;
  activityDate: string;
  accomplishmentDescription: string;
  studentRemarks: string | null;
  status: 'submitted' | 'approved' | 'revision_required' | 'rejected';
  submittedAt: string | null;
  createdAt: string;
  evidenceImages: EvidenceImageRecord[];
  reviews: AccomplishmentReviewRecord[];
}

export interface AccomplishmentRecord {
  id: number;
  applicationId: number;
  taskId: number;
  taskTitle: string;
  categoryName: string;
  studentId: number;
  studentNumber: string;
  studentName: string;
  sectionLabel: string | null;
  status: AccomplishmentStatus;
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  coordinatorRemarks: string | null;
  latestVersionNumber: number;
  submissionCount: number;
  latestActivityDate: string | null;
  latestSubmittedAt: string | null;
  evidenceCount: number;
  verifiedHoursForTask: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccomplishmentDetailRecord extends AccomplishmentRecord {
  submissions: AccomplishmentSubmissionRecord[];
}

// ---------------------------------------------------------------------------
// Module 9: Official Report Templates & RSS Reports
// ---------------------------------------------------------------------------

export type ReportType = 'individual' | 'section';
export type ReportStatus = 'generated' | 'approved' | 'archived';

export interface ReportTemplateConfig {
  reportType: ReportType | 'both';
  subtitle: string;
  headerNote: string;
  footerNote: string;
  signatoryTitle: string;
  includeSections: {
    attendanceSummary: boolean;
    serviceHoursBreakdown: boolean;
    accomplishmentNarrative: boolean;
    evidenceCountSummary: boolean;
    sectionComparison: boolean;
  };
}

export interface ReportTemplateRecord {
  id: number;
  collegeId: number;
  collegeCode: string;
  collegeName: string;
  templateName: string;
  templateVersion: string;
  storagePath: string;
  isActive: boolean;
  uploadedBy: number;
  uploadedByName: string;
  config: ReportTemplateConfig;
  reportUsageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RssReportRecord {
  id: number;
  collegeId: number;
  collegeName: string;
  templateId: number;
  templateName: string;
  templateVersion: string;
  reportType: ReportType;
  accomplishmentSubmissionId: number | null;
  studentId: number | null;
  studentNumber: string | null;
  studentName: string | null;
  sectionId: number | null;
  sectionLabel: string | null;
  academicYearId: number | null;
  academicYearName: string | null;
  version: number;
  filePath: string;
  fileHash: string | null;
  status: ReportStatus;
  generatedBy: number;
  generatedByName: string;
  generatedAt: string;
  itemCount: number;
  createdAt: string;
  downloadUrl: string;
}

export interface IndividualReportPreview {
  student: {
    studentId: number;
    studentNumber: string;
    fullName: string;
    email: string;
    sectionLabel: string | null;
    academicYearName: string | null;
  };
  totals: {
    verifiedAttendanceHours: number;
    approvedAdjustmentHours: number;
    totalCreditedHours: number;
    approvedApplicationsCount: number;
    verifiedAttendanceCount: number;
    approvedAccomplishmentsCount: number;
  };
  includedSubmissions: Array<{
    submissionId: number;
    versionNumber: number;
    taskTitle: string;
    categoryName: string;
    activityDate: string;
    accomplishmentDescription: string;
    evidenceCount: number;
    verifiedHours: number;
    reviewedAt: string | null;
  }>;
  attendanceSummary: AttendanceRecord[];
}

export interface SectionReportPreview {
  section: {
    sectionId: number;
    sectionLabel: string;
    programCode: string;
    programName: string;
    yearLevelName: string;
    collegeName: string;
  };
  academicYear: {
    id: number;
    name: string;
  } | null;
  metrics: {
    enrolledStudentCount: number;
    totalApplications: number;
    approvedApplications: number;
    pendingApplications: number;
    verifiedAttendanceEntries: number;
    verifiedServiceHours: number;
    approvedAdjustmentsHours: number;
    totalCreditedHours: number;
    approvedAccomplishmentsCount: number;
  };
  totals?: {
    enrolledStudentCount: number;
    totalApplications: number;
    approvedApplications: number;
    pendingApplications: number;
    verifiedAttendanceEntries: number;
    verifiedServiceHours: number;
    approvedAdjustmentsHours: number;
    totalCreditedHours: number;
    approvedAccomplishmentsCount: number;
  };
  includedSubmissions: Array<{
    submissionId: number;
    studentNumber: string;
    studentName: string;
    taskTitle: string;
    versionNumber: number;
    activityDate: string;
    verifiedHours: number;
  }>;
  sectionComparison: Array<{
    sectionId: number;
    sectionLabel: string;
    enrolledStudentCount: number;
    approvedParticipations: number;
    totalCreditedHours: number;
    approvedAccomplishmentsCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Module 10 & 11: Notifications, Audit Logs, Dashboards & Section Rep
// ---------------------------------------------------------------------------

export interface NotificationRecord {
  id: string;
  userId: number;
  title: string;
  message: string;
  notificationType: string;
  relatedType: string | null;
  relatedId: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: number;
  userId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  subjectType: string | null;
  subjectId: number | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogListResponse {
  logs: AuditLogRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  availableActions: string[];
  availableSubjectTypes: string[];
}

export interface CoordinatorDashboardMetrics {
  pendingRegistrations: number;
  activeStudents: number;
  publishedTasks: number;
  pendingApplications: number;
  pendingAttendanceVerifications: number;
  pendingHourAdjustments: number;
  pendingAccomplishmentReviews: number;
  totalCreditedServiceHours: number;
  generatedReportsCount: number;
  unreadNotifications: number;
}

export interface StudentDashboardMetrics {
  eligiblePublishedTasks: number;
  myPendingApplications: number;
  myApprovedApplications: number;
  verifiedServiceHours: number;
  pendingServiceHours: number;
  draftOrRevisionAccomplishments: number;
  approvedAccomplishments: number;
  availableIndividualReports: number;
  unreadNotifications: number;
}

export interface SectionRepDashboardMetrics {
  assignedSectionId: number | null;
  assignedSectionLabel: string | null;
  academicYearName: string | null;
  enrolledStudentCount: number;
  visiblePublishedTasksCount: number;
  sectionApprovedParticipations: number;
  sectionTotalCreditedHours: number;
  sectionApprovedAccomplishments: number;
  authorizedSectionReportsCount: number;
  unreadNotifications: number;
}

export interface DashboardSummaryResponse {
  role: RoleName;
  coordinator?: CoordinatorDashboardMetrics;
  student?: StudentDashboardMetrics;
  sectionRepresentative?: SectionRepDashboardMetrics;
}

export interface SectionRepOverviewResponse {
  accessMode: 'read_only';
  role: 'Section Representative';
  assigned: boolean;
  collegeName: string;
  section: {
    sectionId: number;
    sectionName: string;
    programCode: string;
    programName: string;
    yearLevelName: string;
    academicYearName: string;
    enrolledAt: string;
    activeEnrolledStudentsCount: number;
  } | null;
  summary: {
    totalApplications: number;
    approvedApplications: number;
    verifiedAttendanceEntries: number;
    totalCreditedServiceHours: number;
    approvedAccomplishmentsCount: number;
  } | null;
  message: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  requestId?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId?: string;
}
