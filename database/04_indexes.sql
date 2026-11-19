-- CT-RSS Management System (Lapu-Lapu City College — College of Technology)
-- 04_indexes.sql
-- Partial unique indexes and operational query indexes.

-- Mandatory partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_single_current
  ON academic_years (is_current)
  WHERE is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_section_history_current
  ON student_section_history (student_id)
  WHERE is_current = TRUE;

-- Operational lookup & foreign key indexes
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users (account_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);
CREATE INDEX IF NOT EXISTS idx_students_registration_status ON students (registration_status);
CREATE INDEX IF NOT EXISTS idx_ssh_section_year ON student_section_history (section_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_tasks_college_status ON tasks (college_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_sessions_task_date ON task_sessions (task_id, session_date);
CREATE INDEX IF NOT EXISTS idx_task_applications_task_status ON task_applications (task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_applications_student ON task_applications (student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_app_status ON attendance (application_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_sha_app_status ON service_hour_adjustments (application_id, status);
CREATE INDEX IF NOT EXISTS idx_accomplishments_status ON accomplishments (status);
CREATE INDEX IF NOT EXISTS idx_acc_sub_accomplishment ON accomplishment_submissions (accomplishment_id);
CREATE INDEX IF NOT EXISTS idx_evidence_submission_order ON evidence_images (submission_id, display_order);
CREATE INDEX IF NOT EXISTS idx_rss_reports_college_type ON rss_reports (college_id, report_type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_subject ON audit_logs (subject_type, subject_id);
