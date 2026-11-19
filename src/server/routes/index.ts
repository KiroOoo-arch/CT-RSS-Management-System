import { Router } from 'express';
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
  getSectionRepOverview,
  getStudentProfileScoped,
  patchCoordinatorUserStatus,
  postCoordinatorAssignRole,
  postCoordinatorRegistrationDecision,
} from '../controllers/rbacController.ts';
import { getFoundation, getHealth } from '../controllers/systemController.ts';
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

// Student ownership-scoped endpoints
apiRouter.get(
  '/student/profile',
  requireAuth,
  requireRole('Student', 'RSS Coordinator'),
  asyncHandler(getOwnStudentProfile),
);
apiRouter.get(
  '/students/:studentId/profile',
  requireAuth,
  requireStudentOwnership('studentId'),
  asyncHandler(getStudentProfileScoped),
);

// Section Representative read-only scoped endpoint
apiRouter.get(
  '/section-rep/overview',
  requireAuth,
  requireRole('Section Representative', 'RSS Coordinator'),
  asyncHandler(getSectionRepOverview),
);
