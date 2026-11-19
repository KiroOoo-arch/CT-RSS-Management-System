import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { ApiClientError, apiPost, setCsrfToken } from '../services/apiClient.ts';
import type {
  AuthSessionResponse,
  AuthenticatedUser,
  BootstrapStatus,
  DatabaseReadiness,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { CollegeLogo } from '../components/ui/CollegeLogo.tsx';
import { FormField, TextInput } from '../components/ui/FormField.tsx';
import { StatusBadge } from '../components/ui/StatusBadge.tsx';

interface LoginPageProps {
  database: DatabaseReadiness | null;
  bootstrapStatus: BootstrapStatus | null;
  onAuthenticated: (user: AuthenticatedUser) => void;
  onEnterDevPreview?: () => void;
}

type AuthTab = 'signin' | 'register';

interface RegistrationConfirmation {
  email: string;
  studentNumber: string;
  message: string;
}

export function LoginPage({
  database,
  bootstrapStatus,
  onAuthenticated,
  onEnterDevPreview,
}: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<AuthTab>('signin');

  // Sign-in form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submittingLogin, setSubmittingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [pendingApprovalNotice, setPendingApprovalNotice] = useState<string | null>(null);

  // Student registration request state
  const [studentNumber, setStudentNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [submittingReg, setSubmittingReg] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regConfirmation, setRegConfirmation] = useState<RegistrationConfirmation | null>(null);

  const switchToSignIn = (preserveRegisteredEmail?: string) => {
    setActiveTab('signin');
    setRegError(null);
    setLoginError(null);
    setPassword('');
    if (preserveRegisteredEmail) {
      setEmail(preserveRegisteredEmail);
      setPendingApprovalNotice(
        `Registration request received for ${preserveRegisteredEmail}. Please wait for RSS Coordinator approval before signing in to the portal.`,
      );
      setRegConfirmation(null);
    }
  };

  const switchToRegister = () => {
    setActiveTab('register');
    setLoginError(null);
    setPendingApprovalNotice(null);
    setRegError(null);
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setPendingApprovalNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setLoginError('Please enter both your email address and password.');
      return;
    }

    setSubmittingLogin(true);
    try {
      const session = await apiPost<AuthSessionResponse>('/api/v1/auth/login', {
        email: trimmedEmail,
        password,
      });
      setCsrfToken(session.csrfToken);
      onAuthenticated(session.user);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setLoginError(err.message);
      } else {
        setLoginError('Unable to reach the authentication service. Please try again.');
      }
    } finally {
      setSubmittingLogin(false);
    }
  };

  const handleRegisterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRegError(null);
    setRegConfirmation(null);

    const submittedEmail = regEmail.trim().toLowerCase();
    const submittedStudentNumber = studentNumber.trim();

    if (!submittedStudentNumber || !firstName.trim() || !lastName.trim() || !submittedEmail || !regPassword) {
      setRegError('Please fill in all required student registration fields.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setRegError('Password and confirmation password do not match.');
      return;
    }

    setSubmittingReg(true);
    try {
      const result = await apiPost<{ message: string }>('/api/v1/auth/register', {
        studentNumber: submittedStudentNumber,
        firstName: firstName.trim(),
        middleName: middleName.trim() || undefined,
        lastName: lastName.trim(),
        email: submittedEmail,
        contactNumber: contactNumber.trim() || undefined,
        password: regPassword,
      });
      setRegConfirmation({
        email: submittedEmail,
        studentNumber: submittedStudentNumber,
        message: result.message,
      });
      setStudentNumber('');
      setFirstName('');
      setMiddleName('');
      setLastName('');
      setRegEmail('');
      setContactNumber('');
      setRegPassword('');
      setRegConfirmPassword('');
      setPassword('');
      setShowRegPassword(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setRegError(err.message);
      } else {
        setRegError('Unable to submit registration request. Please try again.');
      }
    } finally {
      setSubmittingReg(false);
    }
  };

  const dbConnected = database?.status === 'connected';
  const dbBadge =
    database?.status === 'connected'
      ? { tone: 'success' as const, label: 'PostgreSQL Connected' }
      : database?.status === 'unavailable'
        ? { tone: 'danger' as const, label: 'Database Unreachable' }
        : { tone: 'neutral' as const, label: 'Database Not Configured' };

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-[#1E293B] flex flex-col">
      {/* Institutional Top Header */}
      <header className="border-b border-[#0B2340] bg-[#0B2340] text-white">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3.5 min-w-0">
            <CollegeLogo size="md" />
            <div className="min-w-0">
              <p className="font-[var(--font-display)] text-sm font-bold tracking-wide text-white sm:text-base">
                LAPU-LAPU CITY COLLEGE
              </p>
              <p className="text-xs font-medium text-[#D6A63C]">
                College of Technology · Student Service Management Portal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge tone={dbBadge.tone} label={dbBadge.label} />
          </div>
        </div>
        <div className="h-0.5 w-full bg-[#D6A63C]" aria-hidden="true" />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
          {/* Left Institutional Context Panel */}
          <section className="lg:col-span-5 flex flex-col justify-between rounded-lg border border-[#0B2340] bg-[#0B2340] p-6 text-white sm:p-8">
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold tracking-wider text-[#D6A63C] uppercase">
                  Official Institutional Portal
                </p>
                <h1 className="mt-2 font-[var(--font-display)] text-2xl font-bold tracking-tight text-white sm:text-3xl [text-wrap:balance]">
                  CT-RSS Management System
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-slate-200">
                  Centralized platform for Recognized Student Service (RSS) tasks, participation approvals, verified service hours, and official College of Technology reports.
                </p>
              </div>

              <div className="h-px w-full bg-white/15" aria-hidden="true" />

              <div className="space-y-3.5 text-sm">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-[#D6A63C] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-white">Role-Based Access Control</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
                      Authorizes RSS Coordinator, Student, and read-only Section Representative accounts directly from PostgreSQL.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-4 w-4 text-[#D6A63C] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-white">Verified Account Lifecycle</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
                      Student registrations remain pending until reviewed and approved by the College of Technology RSS Coordinator.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-4 w-4 text-[#D6A63C] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-white">PostgreSQL Schema Readiness</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
                      {database?.message ?? 'Checking PostgreSQL connection status...'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {import.meta.env.DEV && onEnterDevPreview ? (
              <div className="mt-8 rounded-lg border border-white/15 bg-[#12345A] p-4">
                <p className="text-xs font-semibold text-[#D6A63C]">
                  Development UI Preview (Unauthenticated)
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-200">
                  PostgreSQL is not configured in this preview environment. You may inspect the UI layout shell without an authenticated session.
                </p>
                <button
                  type="button"
                  onClick={onEnterDevPreview}
                  className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-white/25 bg-[#0B2340] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6A63C] cursor-pointer"
                >
                  Open Unauthenticated UI Preview
                </button>
              </div>
            ) : (
              <div className="mt-8 border-t border-white/15 pt-4 text-xs text-slate-300">
                Lapu-Lapu City College · College of Technology
              </div>
            )}
          </section>

          {/* Right Sign-In & Student Registration Card */}
          <section className="lg:col-span-7 rounded-lg border border-[#E2E8F0] bg-white p-6 sm:p-8 flex flex-col justify-between">
            <div>
              {/* Segmented Tab Switch */}
              <div
                role="tablist"
                aria-label="Portal authentication mode"
                className="inline-flex w-full rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] p-1 sm:w-auto"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'signin'}
                  onClick={() => switchToSignIn(regConfirmation?.email)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors sm:flex-initial cursor-pointer ${
                    activeTab === 'signin'
                      ? 'bg-[#12345A] text-white'
                      : 'text-[#64748B] hover:text-[#1E293B]'
                  }`}
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Account Sign In</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'register'}
                  onClick={switchToRegister}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors sm:flex-initial cursor-pointer ${
                    activeTab === 'register'
                      ? 'bg-[#12345A] text-white'
                      : 'text-[#64748B] hover:text-[#1E293B]'
                  }`}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Student Registration</span>
                </button>
              </div>

              {!dbConnected ? (
                <div
                  role="status"
                  className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">PostgreSQL Connection Required for Sign-In</p>
                    <p className="mt-0.5 leading-relaxed text-amber-800">
                      {database?.message ??
                        'Configure SQL_HOST, SQL_PORT, SQL_DB_NAME, SQL_USER, and SQL_PASSWORD, then run npm run db:migrate and npm run db:bootstrap-coordinator.'}
                    </p>
                  </div>
                </div>
              ) : bootstrapStatus && !bootstrapStatus.coordinatorExists ? (
                <div
                  role="status"
                  className="mt-5 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-xs text-[#12345A]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Initial RSS Coordinator Setup Pending</p>
                    <p className="mt-0.5 leading-relaxed">
                      PostgreSQL is connected, but no RSS Coordinator account exists yet. Run{' '}
                      <span className="font-mono font-semibold">npm run db:bootstrap-coordinator</span>{' '}
                      to provision the initial Coordinator securely.
                    </p>
                  </div>
                </div>
              ) : null}

              {activeTab === 'signin' ? (
                <form onSubmit={(e) => void handleLoginSubmit(e)} className="mt-6 space-y-5" noValidate>
                  <div>
                    <h2 className="font-[var(--font-display)] text-xl font-bold text-[#1E293B]">
                      Sign in to CT-RSS Portal
                    </h2>
                    <p className="mt-1 text-sm text-[#64748B]">
                      Enter your authorized Lapu-Lapu City College account credentials.
                    </p>
                  </div>

                  {pendingApprovalNotice ? (
                    <div
                      role="status"
                      className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-sm text-[#12345A]"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#12345A] shrink-0" aria-hidden="true" />
                      <div className="space-y-1">
                        <p className="font-semibold">Awaiting Coordinator Approval</p>
                        <p className="text-xs leading-relaxed text-[#1E293B]">
                          {pendingApprovalNotice}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {loginError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-900"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
                      <span>{loginError}</span>
                    </div>
                  ) : null}

                  <FormField id="login-email" label="Email Address" required>
                    <TextInput
                      id="login-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@llcc.edu.ph"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={submittingLogin}
                      required
                    />
                  </FormField>

                  <FormField id="login-password" label="Password" required>
                    <div className="relative">
                      <TextInput
                        id="login-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={submittingLogin}
                        className="pr-11"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] hover:bg-[#F4F6FA] hover:text-[#1E293B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </FormField>

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={submittingLogin}
                    icon={<LogIn className="h-4 w-4" aria-hidden="true" />}
                    className="w-full"
                  >
                    {submittingLogin ? 'Signing In...' : 'Sign In'}
                  </Button>

                  <div className="flex flex-col items-start justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-3 text-xs text-[#64748B] sm:flex-row sm:items-center">
                    <span>Don&apos;t have an account?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRegConfirmation(null);
                        switchToRegister();
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-[#12345A] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] rounded cursor-pointer"
                    >
                      <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Student Registration</span>
                    </button>
                  </div>
                </form>
              ) : regConfirmation ? (
                <div
                  role="status"
                  className="mt-6 space-y-5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-5 sm:p-6"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 shrink-0">
                      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h2 className="font-[var(--font-display)] text-lg font-bold text-[#1E293B] sm:text-xl">
                        Registration Request Submitted
                      </h2>
                      <p className="text-sm leading-relaxed text-emerald-950">
                        {regConfirmation.message}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 text-xs text-[#1E293B] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
                      <span className="text-[#64748B]">Student Number</span>
                      <span className="font-mono font-semibold text-[#12345A] tabular-nums">
                        {regConfirmation.studentNumber}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
                      <span className="text-[#64748B]">Registered Email</span>
                      <span className="font-medium break-all">{regConfirmation.email}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[#64748B]">Account Status</span>
                      <StatusBadge tone="warning" label="Pending Coordinator Approval" />
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-[#64748B]">
                    Your student account is awaiting review by the College of Technology RSS Coordinator. You must wait for approval before you can sign in and access the portal.
                  </p>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      icon={<LogIn className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => switchToSignIn(regConfirmation.email)}
                      className="w-full sm:w-auto"
                    >
                      Return to Sign In
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={() => setRegConfirmation(null)}
                      className="w-full sm:w-auto"
                    >
                      Submit Another Request
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={(e) => void handleRegisterSubmit(e)} className="mt-6 space-y-4" noValidate>
                  <div>
                    <h2 className="font-[var(--font-display)] text-xl font-bold text-[#1E293B]">
                      Student Account Registration
                    </h2>
                    <p className="mt-1 text-sm text-[#64748B]">
                      Submitted accounts enter a <span className="font-medium text-[#1E293B]">Pending</span> state until approved by the RSS Coordinator.
                    </p>
                  </div>

                  {regError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-900"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
                      <span>{regError}</span>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField id="reg-student-number" label="Student Number" required>
                      <TextInput
                        id="reg-student-number"
                        value={studentNumber}
                        onChange={(e) => setStudentNumber(e.target.value)}
                        placeholder="e.g. CT-2026-0001"
                        disabled={submittingReg}
                        required
                      />
                    </FormField>
                    <FormField id="reg-contact" label="Contact Number">
                      <TextInput
                        id="reg-contact"
                        value={contactNumber}
                        onChange={(e) => setContactNumber(e.target.value)}
                        placeholder="09XX-XXX-XXXX"
                        disabled={submittingReg}
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <FormField id="reg-first-name" label="First Name" required>
                      <TextInput
                        id="reg-first-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={submittingReg}
                        required
                      />
                    </FormField>
                    <FormField id="reg-middle-name" label="Middle Name">
                      <TextInput
                        id="reg-middle-name"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        disabled={submittingReg}
                      />
                    </FormField>
                    <FormField id="reg-last-name" label="Last Name" required>
                      <TextInput
                        id="reg-last-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={submittingReg}
                        required
                      />
                    </FormField>
                  </div>

                  <FormField id="reg-email" label="Email Address" required>
                    <TextInput
                      id="reg-email"
                      type="email"
                      autoComplete="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="student@llcc.edu.ph"
                      disabled={submittingReg}
                      required
                    />
                  </FormField>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      id="reg-password"
                      label="Password"
                      hint="Min. 10 chars with uppercase, lowercase, and number"
                      required
                    >
                      <div className="relative">
                        <TextInput
                          id="reg-password"
                          type={showRegPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          disabled={submittingReg}
                          className="pr-11"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPassword((prev) => !prev)}
                          aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] hover:bg-[#F4F6FA] hover:text-[#1E293B] cursor-pointer"
                        >
                          {showRegPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </FormField>
                    <FormField id="reg-confirm-password" label="Confirm Password" required>
                      <TextInput
                        id="reg-confirm-password"
                        type={showRegPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        disabled={submittingReg}
                        required
                      />
                    </FormField>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={submittingReg}
                    icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
                    className="w-full"
                  >
                    {submittingReg ? 'Submitting Registration...' : 'Submit Registration Request'}
                  </Button>

                  <div className="flex flex-col items-start justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F4F6FA] px-4 py-3 text-xs text-[#64748B] sm:flex-row sm:items-center">
                    <span>Already have an approved account?</span>
                    <button
                      type="button"
                      onClick={() => switchToSignIn()}
                      className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-[#12345A] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12345A] rounded cursor-pointer"
                    >
                      <LogIn className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Return to Sign In</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="mt-6 border-t border-[#E2E8F0] pt-4 text-xs text-[#64748B] flex flex-wrap items-center justify-between gap-2">
              <span>Lapu-Lapu City College · College of Technology</span>
              <span>CT-RSS Management System</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
