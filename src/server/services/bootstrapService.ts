import { isDatabaseConfigured, query, withTransaction } from '../config/database.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { hashPassword, validatePasswordStrength } from '../utils/password.ts';
import { recordAuditLog } from './auditService.ts';

export interface BootstrapStatus {
  databaseConfigured: boolean;
  databaseReachable: boolean;
  coordinatorExists: boolean;
  apiBootstrapEnabled: boolean;
}

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  if (!isDatabaseConfigured()) {
    return {
      databaseConfigured: false,
      databaseReachable: false,
      coordinatorExists: false,
      apiBootstrapEnabled: Boolean(process.env.BOOTSTRAP_SECRET?.trim()),
    };
  }

  try {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
       WHERE r.name = 'RSS Coordinator'
         AND u.deleted_at IS NULL`,
    );
    const count = Number.parseInt(res.rows[0]?.count ?? '0', 10);
    return {
      databaseConfigured: true,
      databaseReachable: true,
      coordinatorExists: count > 0,
      apiBootstrapEnabled: count === 0 && Boolean(process.env.BOOTSTRAP_SECRET?.trim()),
    };
  } catch {
    return {
      databaseConfigured: true,
      databaseReachable: false,
      coordinatorExists: false,
      apiBootstrapEnabled: false,
    };
  }
}

export interface BootstrapCoordinatorInput {
  name: string;
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function bootstrapInitialCoordinator(input: BootstrapCoordinatorInput): Promise<{
  userId: number;
  name: string;
  email: string;
  role: 'RSS Coordinator';
}> {
  const trimmedName = input.name.trim();
  const normalizedEmail = input.email.trim().toLowerCase();

  if (trimmedName.length < 2 || trimmedName.length > 150) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Coordinator full name must be 2–150 characters.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please provide a valid Coordinator email address.');
  }

  const strengthError = validatePasswordStrength(input.password);
  if (strengthError) {
    throw new AppError(400, 'WEAK_PASSWORD', strengthError);
  }

  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    // Prevent concurrent bootstrap race conditions
    await client.query('SELECT pg_advisory_xact_lock(20260001)');

    const existingCoordinator = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
       WHERE r.name = 'RSS Coordinator'
         AND u.deleted_at IS NULL`,
    );

    if (Number.parseInt(existingCoordinator.rows[0]?.count ?? '0', 10) > 0) {
      throw new AppError(
        409,
        'BOOTSTRAP_ALREADY_COMPLETED',
        'An RSS Coordinator account already exists. Initial bootstrap is permanently disabled.',
      );
    }

    const roleRes = await client.query<{ id: number }>(
      `SELECT id FROM roles WHERE name = 'RSS Coordinator' LIMIT 1`,
    );
    const coordinatorRoleId = roleRes.rows[0]?.id;
    if (!coordinatorRoleId) {
      throw new AppError(
        500,
        'ROLES_NOT_SEEDED',
        'Roles table is not seeded. Run npm run db:migrate before bootstrapping the Coordinator.',
      );
    }

    const duplicateEmail = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );
    if (duplicateEmail.rows.length > 0) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email address already exists.');
    }

    const insertedUser = await client.query<{ id: number; name: string; email: string }>(
      `INSERT INTO users (name, email, password, account_status, email_verified_at)
       VALUES ($1, $2, $3, 'active', NOW())
       RETURNING id, name, email`,
      [trimmedName, normalizedEmail, passwordHash],
    );

    const newUser = insertedUser.rows[0];
    if (!newUser) {
      throw new AppError(500, 'BOOTSTRAP_FAILED', 'Failed to insert initial Coordinator account.');
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, NULL)`,
      [newUser.id, coordinatorRoleId],
    );

    await recordAuditLog(
      {
        userId: newUser.id,
        action: 'bootstrap_coordinator',
        subjectType: 'users',
        subjectId: newUser.id,
        newValues: {
          name: newUser.name,
          email: newUser.email,
          account_status: 'active',
          role: 'RSS Coordinator',
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      client,
    );

    return {
      userId: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: 'RSS Coordinator' as const,
    };
  });
}
