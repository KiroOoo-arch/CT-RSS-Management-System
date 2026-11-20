import { Router } from 'express';
import {
  getAcademicMetadata,
  getCoordinatorAcademicYears,
  getCoordinatorPrograms,
  getCoordinatorSectionStudents,
  getCoordinatorSections,
  patchCoordinatorAcademicYear,
  patchCoordinatorProgram,
  patchCoordinatorSection,
  postCoordinatorAcademicYear,
  postCoordinatorProgram,
  postCoordinatorSection,
  postCoordinatorSetCurrentAcademicYear,
} from '../controllers/academicController.ts';
import {
  getAuthorizedEvidenceFileHandler,
  getCoordinatorAccomplishmentDetailHandler,
  getCoordinatorAccomplishments,
  getStudentAccomplishmentDetailHandler,
  getStudentAccomplishmentsList,
  postCoordinatorAccomplishmentReview,
  postStudentAccomplishmentDraft,
  postStudentAccomplishmentSubmission,
} from '../controllers/accomplishmentController.ts';
import {
  getCoordinatorApplicationDetailHandler,
  getCoordinatorApplicationsHandler,
  getStudentApplicationDetailHandler,
  getStudentApplicationsList,
  postCoordinatorApplicationDecision,
  postStudentTaskApplication,
  postStudentWithdrawApplication,
} from '../controllers/applicationController.ts';
import {
  getCoordinatorAttendanceList,
  getCoordinatorServiceHoursHandler,
  getCoordinatorSessionRosterHandler,
  getStudentAttendanceList,
  getStudentServiceHoursHandler,
  patchCoordinatorAttendance,
  postCoordinatorAdjustmentDecision,
  postCoordinatorAttendance,
  postCoordinatorServiceHourAdjustment,
  postStudentServiceHourAdjustmentRequest,
} from '../controllers/attendanceController.ts';
import {
  getAuthBootstrapStatus,
  getMe,
  postBootstrapCoordinator,
  postLogin,
  postLogout,
  postRegister,
} from '../controllers/authController.ts';
import {
  getCoordinatorRegistrations,
  getOwnStudentProfile,
  getStudentProfileScoped,
  patchCoordinatorUserStatus,
  postCoordinatorAssignRole,
  postCoordinatorRegistrationDecision,
} from '../controllers/rbacController.ts';
import {
  getAuthorizedReportDownloadHandler,
  getCoordinatorIndividualReportPreviewHandler,
  getCoordinatorReportTemplates,
  getCoordinatorReportsList,
  getCoordinatorSectionReportPreviewHandler,
  getStudentOwnReports,
  patchCoordinatorReportStatus,
  patchCoordinatorReportTemplate,
  postCoordinatorGenerateIndividualReport,
  postCoordinatorGenerateSectionReport,
  postCoordinatorReportTemplate,
} from '../controllers/reportController.ts';
import {
  getCoordinatorStudentDetail,
  getCoordinatorStudents,
  patchCoordinatorStudent,
  postCoordinatorStudent,
  postCoordinatorStudentSectionAssignment,
} from '../controllers/studentController.ts';
import { getFoundation, getHealth } from '../controllers/systemController.ts';
import {
  getCoordinatorAuditLogsHandler,
  getDashboardSummaryHandler,
  getNotificationsHandler,
  getSectionRepOverviewHandler,
  getSectionRepReportsHandler,
  getSectionRepTasksHandler,
  patchNotificationReadHandler,
  postMarkAllNotificationsReadHandler,
} from '../controllers/systemModulesController.ts';
import {
  deleteCoordinatorTaskSessionHandler,
  getCoordinatorTaskById,
  getCoordinatorTaskCategories,
  getCoordinatorTasks,
  getCoordinatorTaskSessions,
  getStudentTaskDetail,
  getStudentTasks,
  patchCoordinatorTask,
  patchCoordinatorTaskCategory,
  patchCoordinatorTaskSession,
  patchCoordinatorTaskStatus,
  postCoordinatorTask,
  postCoordinatorTaskCategory,
  postCoordinatorTaskSession,
} from '../controllers/taskController.ts';
import {
  requireAuth,
  requireCsrf,
  requireRole,
  requireStudentOwnership,
} from '../middleware/auth.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import {
  bootstrapRateLimiter,
  createRateLimitMiddleware,
  loginRateLimiter,
  registerRateLimiter,
} from '../middleware/rateLimit.ts';

export const apiRouter = Router();

// Public system readiness & health endpoints (non-sensitive operational metadata)
apiRouter.get('/health', asyncHandler(getHealth));
apiRouter.get('/system/foundation', asyncHandler(getFoundation));

// Authentication & guarded bootstrap endpoints
apiRouter.get('/auth/bootstrap-status', asyncHandler(getAuthBootstrapStatus));
apiRouter.post(
  '/auth/bootstrap-coordinator',
  createRateLimitMiddleware(bootstrapRateLimiter),
  asyncHandler(postBootstrapCoordinator),
);
apiRouter.post(
  '/auth/login',
  createRateLimitMiddleware(loginRateLimiter, (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }),
  asyncHandler(postLogin),
);
apiRouter.post(
  '/auth/register',
  createRateLimitMiddleware(registerRateLimiter),
  asyncHandler(postRegister),
);
apiRouter.get('/auth/me', requireAuth, asyncHandler(getMe));
apiRouter.post('/auth/logout', requireAuth, requireCsrf, asyncHandler(postLogout));

// Live Role Dashboard & Authenticated User Notifications (Module 10)
apiRouter.get('/dashboard/summary', requireAuth, asyncHandler(getDashboardSummaryHandler));
apiRouter.get('/notifications', requireAuth, asyncHandler(getNotificationsHandler));
apiRouter.patch(
  '/notifications/:notificationId/read',
  requireAuth,
  requireCsrf,
  asyncHandler(patchNotificationReadHandler),
);
apiRouter.post(
  '/notifications/read-all',
  requireAuth,
  requireCsrf,
  asyncHandler(postMarkAllNotificationsReadHandler),
);

// RSS Coordinator RBAC endpoints
apiRouter.get(
  '/coordinator/registrations',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorRegistrations),
);
apiRouter.post(
  '/coordinator/registrations/:studentId/decision',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorRegistrationDecision),
);
apiRouter.post(
  '/coordinator/users/:userId/roles',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorAssignRole),
);
apiRouter.patch(
  '/coordinator/users/:userId/status',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorUserStatus),
);

// Milestone 4 — Coordinator Academic & Student Management endpoints
apiRouter.get(
  '/coordinator/academic-metadata',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getAcademicMetadata),
);

// Academic Years
apiRouter.get(
  '/coordinator/academic-years',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorAcademicYears),
);
apiRouter.post(
  '/coordinator/academic-years',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorAcademicYear),
);
apiRouter.patch(
  '/coordinator/academic-years/:academicYearId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorAcademicYear),
);
apiRouter.post(
  '/coordinator/academic-years/:academicYearId/set-current',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorSetCurrentAcademicYear),
);

// Programs
apiRouter.get(
  '/coordinator/programs',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorPrograms),
);
apiRouter.post(
  '/coordinator/programs',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorProgram),
);
apiRouter.patch(
  '/coordinator/programs/:programId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorProgram),
);

// Sections
apiRouter.get(
  '/coordinator/sections',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorSections),
);
apiRouter.post(
  '/coordinator/sections',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorSection),
);
apiRouter.patch(
  '/coordinator/sections/:sectionId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorSection),
);
apiRouter.get(
  '/coordinator/sections/:sectionId/students',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorSectionStudents),
);

// Students & Section Assignment History
apiRouter.get(
  '/coordinator/students',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorStudents),
);
apiRouter.post(
  '/coordinator/students',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorStudent),
);
apiRouter.get(
  '/coordinator/students/:studentId',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorStudentDetail),
);
apiRouter.patch(
  '/coordinator/students/:studentId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorStudent),
);
apiRouter.post(
  '/coordinator/students/:studentId/section-assignment',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorStudentSectionAssignment),
);

// Milestone 5 — Coordinator RSS Task Management endpoints
apiRouter.get(
  '/coordinator/task-categories',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorTaskCategories),
);
apiRouter.post(
  '/coordinator/task-categories',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorTaskCategory),
);
apiRouter.patch(
  '/coordinator/task-categories/:categoryId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorTaskCategory),
);

apiRouter.get(
  '/coordinator/tasks',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorTasks),
);
apiRouter.post(
  '/coordinator/tasks',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorTask),
);
apiRouter.get(
  '/coordinator/tasks/:taskId',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorTaskById),
);
apiRouter.patch(
  '/coordinator/tasks/:taskId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorTask),
);
apiRouter.patch(
  '/coordinator/tasks/:taskId/status',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorTaskStatus),
);
apiRouter.get(
  '/coordinator/tasks/:taskId/sessions',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorTaskSessions),
);
apiRouter.post(
  '/coordinator/tasks/:taskId/sessions',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorTaskSession),
);
apiRouter.patch(
  '/coordinator/tasks/:taskId/sessions/:sessionId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorTaskSession),
);
apiRouter.delete(
  '/coordinator/tasks/:taskId/sessions/:sessionId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(deleteCoordinatorTaskSessionHandler),
);

// Milestone 6 — Coordinator Task Applications Management
apiRouter.get(
  '/coordinator/applications',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorApplicationsHandler),
);
apiRouter.get(
  '/coordinator/applications/:applicationId',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorApplicationDetailHandler),
);
apiRouter.post(
  '/coordinator/applications/:applicationId/decision',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorApplicationDecision),
);

// Milestone 7 — Coordinator Attendance & Service Hours
apiRouter.get(
  '/coordinator/attendance',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorAttendanceList),
);
apiRouter.get(
  '/coordinator/attendance/sessions/:sessionId/roster',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorSessionRosterHandler),
);
apiRouter.post(
  '/coordinator/attendance',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorAttendance),
);
apiRouter.patch(
  '/coordinator/attendance/:attendanceId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorAttendance),
);
apiRouter.get(
  '/coordinator/service-hours',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorServiceHoursHandler),
);
apiRouter.post(
  '/coordinator/service-hours/adjustments',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorServiceHourAdjustment),
);
apiRouter.post(
  '/coordinator/service-hours/adjustments/:adjustmentId/decision',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorAdjustmentDecision),
);

// Milestone 8 — Coordinator Accomplishments & Evidence
apiRouter.get(
  '/coordinator/accomplishments',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorAccomplishments),
);
apiRouter.get(
  '/coordinator/accomplishments/:accomplishmentId',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorAccomplishmentDetailHandler),
);
apiRouter.post(
  '/coordinator/accomplishments/submissions/:submissionId/review',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorAccomplishmentReview),
);

// Milestone 9 — Coordinator Report Templates & RSS Reports
apiRouter.get(
  '/coordinator/report-templates',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorReportTemplates),
);
apiRouter.post(
  '/coordinator/report-templates',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorReportTemplate),
);
apiRouter.patch(
  '/coordinator/report-templates/:templateId',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorReportTemplate),
);
apiRouter.get(
  '/coordinator/reports',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorReportsList),
);
apiRouter.get(
  '/coordinator/reports/individual/preview',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorIndividualReportPreviewHandler),
);
apiRouter.post(
  '/coordinator/reports/individual/generate',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorGenerateIndividualReport),
);
apiRouter.get(
  '/coordinator/reports/section/preview',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorSectionReportPreviewHandler),
);
apiRouter.post(
  '/coordinator/reports/section/generate',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(postCoordinatorGenerateSectionReport),
);
apiRouter.patch(
  '/coordinator/reports/:reportId/status',
  requireAuth,
  requireCsrf,
  requireRole('RSS Coordinator'),
  asyncHandler(patchCoordinatorReportStatus),
);

// Milestone 11 — Coordinator Read-Only Audit Logs
apiRouter.get(
  '/coordinator/audit-logs',
  requireAuth,
  requireRole('RSS Coordinator'),
  asyncHandler(getCoordinatorAuditLogsHandler),
);

// Protected File Downloads (Strictly Authenticated & Ownership-Verified)
apiRouter.get(
  '/evidence/:imageId/file',
  requireAuth,
  requireRole('RSS Coordinator', 'Student'),
  asyncHandler(getAuthorizedEvidenceFileHandler),
);
apiRouter.get(
  '/reports/:reportId/download',
  requireAuth,
  requireRole('RSS Coordinator', 'Student', 'Section Representative'),
  asyncHandler(getAuthorizedReportDownloadHandler),
);

// Student ownership-scoped endpoints
apiRouter.get(
  '/student/profile',
  requireAuth,
  requireRole('Student', 'RSS Coordinator'),
  asyncHandler(getOwnStudentProfile),
);
apiRouter.get(
  '/student/tasks',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentTasks),
);
apiRouter.get(
  '/student/tasks/:taskId',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentTaskDetail),
);
apiRouter.post(
  '/student/tasks/:taskId/apply',
  requireAuth,
  requireCsrf,
  requireRole('Student'),
  asyncHandler(postStudentTaskApplication),
);
apiRouter.get(
  '/student/applications',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentApplicationsList),
);
apiRouter.get(
  '/student/applications/:applicationId',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentApplicationDetailHandler),
);
apiRouter.post(
  '/student/applications/:applicationId/withdraw',
  requireAuth,
  requireCsrf,
  requireRole('Student'),
  asyncHandler(postStudentWithdrawApplication),
);
apiRouter.get(
  '/student/attendance',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentAttendanceList),
);
apiRouter.get(
  '/student/service-hours',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentServiceHoursHandler),
);
apiRouter.post(
  '/student/service-hours/adjustments',
  requireAuth,
  requireCsrf,
  requireRole('Student'),
  asyncHandler(postStudentServiceHourAdjustmentRequest),
);
apiRouter.get(
  '/student/accomplishments',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentAccomplishmentsList),
);
apiRouter.get(
  '/student/accomplishments/:accomplishmentId',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentAccomplishmentDetailHandler),
);
apiRouter.post(
  '/student/accomplishments/draft',
  requireAuth,
  requireCsrf,
  requireRole('Student'),
  asyncHandler(postStudentAccomplishmentDraft),
);
apiRouter.post(
  '/student/accomplishments/submit',
  requireAuth,
  requireCsrf,
  requireRole('Student'),
  asyncHandler(postStudentAccomplishmentSubmission),
);
apiRouter.get(
  '/student/reports',
  requireAuth,
  requireRole('Student'),
  asyncHandler(getStudentOwnReports),
);
apiRouter.get(
  '/students/:studentId/profile',
  requireAuth,
  requireStudentOwnership('studentId'),
  asyncHandler(getStudentProfileScoped),
);

// Section Representative read-only scoped endpoints
apiRouter.get(
  '/section-rep/overview',
  requireAuth,
  requireRole('Section Representative', 'RSS Coordinator'),
  asyncHandler(getSectionRepOverviewHandler),
);
apiRouter.get(
  '/section-rep/tasks',
  requireAuth,
  requireRole('Section Representative', 'RSS Coordinator'),
  asyncHandler(getSectionRepTasksHandler),
);
apiRouter.get(
  '/section-rep/reports',
  requireAuth,
  requireRole('Section Representative', 'RSS Coordinator'),
  asyncHandler(getSectionRepReportsHandler),
);
