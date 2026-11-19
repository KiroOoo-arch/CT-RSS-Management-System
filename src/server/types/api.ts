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
