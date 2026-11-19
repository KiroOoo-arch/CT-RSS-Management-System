-- CT-RSS Management System (Lapu-Lapu City College — College of Technology)
-- 02_create_tables.sql
-- Authoritative 28-table PostgreSQL schema. Do not add, remove, or rename tables.

-- TABLE 1: users
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  account_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  email_verified_at TIMESTAMPTZ NULL,
  remember_token VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

-- TABLE 2: roles
CREATE TABLE IF NOT EXISTS roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 3: user_roles
CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  assigned_by BIGINT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role_id)
);

-- TABLE 4: colleges
CREATE TABLE IF NOT EXISTS colleges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 5: programs
CREATE TABLE IF NOT EXISTS programs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (college_id, code)
);

-- TABLE 6: year_levels
CREATE TABLE IF NOT EXISTS year_levels (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  sort_order SMALLINT NOT NULL UNIQUE
);

-- TABLE 7: academic_years
CREATE TABLE IF NOT EXISTS academic_years (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(20) NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 8: sections
CREATE TABLE IF NOT EXISTS sections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id BIGINT NOT NULL,
  year_level_id BIGINT NOT NULL,
  name VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, year_level_id, name)
);

-- TABLE 9: students
CREATE TABLE IF NOT EXISTS students (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  student_number VARCHAR(50) NOT NULL UNIQUE,
  first_name VARCHAR(150) NOT NULL,
  middle_name VARCHAR(150) NULL,
  last_name VARCHAR(150) NOT NULL,
  suffix VARCHAR(30) NULL,
  sex VARCHAR(20) NULL,
  birth_date DATE NULL,
  contact_number VARCHAR(50) NULL,
  registration_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 10: student_section_history
CREATE TABLE IF NOT EXISTS student_section_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id BIGINT NOT NULL,
  section_id BIGINT NOT NULL,
  academic_year_id BIGINT NOT NULL,
  enrolled_at DATE NOT NULL,
  ended_at DATE NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 11: task_categories
CREATE TABLE IF NOT EXISTS task_categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 12: tasks
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT NOT NULL,
  category_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(255) NULL,
  visibility VARCHAR(30) NOT NULL DEFAULT 'all_students',
  capacity INTEGER NULL,
  required_hours NUMERIC(6,2) NULL,
  application_start TIMESTAMPTZ NULL,
  application_deadline TIMESTAMPTZ NULL,
  activity_start TIMESTAMPTZ NULL,
  activity_end TIMESTAMPTZ NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

-- TABLE 13: task_target_sections
CREATE TABLE IF NOT EXISTS task_target_sections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL,
  section_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, section_id)
);

-- TABLE 14: task_target_students
CREATE TABLE IF NOT EXISTS task_target_students (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL,
  student_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, student_id)
);

-- TABLE 15: task_sessions
CREATE TABLE IF NOT EXISTS task_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL,
  session_title VARCHAR(150) NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 16: task_applications
CREATE TABLE IF NOT EXISTS task_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL,
  student_id BIGINT NOT NULL,
  application_message TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, student_id)
);

-- TABLE 17: application_reviews
CREATE TABLE IF NOT EXISTS application_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL,
  reviewed_by BIGINT NOT NULL,
  decision VARCHAR(20) NOT NULL,
  remarks TEXT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 18: accomplishments
CREATE TABLE IF NOT EXISTS accomplishments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  reviewed_by BIGINT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  coordinator_remarks TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 19: accomplishment_submissions
CREATE TABLE IF NOT EXISTS accomplishment_submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accomplishment_id BIGINT NOT NULL,
  submitted_by BIGINT NOT NULL,
  version_number INTEGER NOT NULL,
  activity_date DATE NOT NULL,
  accomplishment_description TEXT NOT NULL,
  student_remarks TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (accomplishment_id, version_number)
);

-- TABLE 20: accomplishment_reviews
CREATE TABLE IF NOT EXISTS accomplishment_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL,
  reviewed_by BIGINT NOT NULL,
  decision VARCHAR(30) NOT NULL,
  remarks TEXT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 21: evidence_images
CREATE TABLE IF NOT EXISTS evidence_images (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL,
  uploaded_by BIGINT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  image_category VARCHAR(20) NOT NULL,
  caption TEXT NULL,
  display_order SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 22: attendance
CREATE TABLE IF NOT EXISTS attendance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL,
  task_session_id BIGINT NOT NULL,
  attendance_date DATE NOT NULL,
  check_in TIMESTAMPTZ NULL,
  check_out TIMESTAMPTZ NULL,
  recorded_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  verified_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  verified_by BIGINT NULL,
  verified_at TIMESTAMPTZ NULL,
  remarks TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, task_session_id)
);

-- TABLE 23: service_hour_adjustments
CREATE TABLE IF NOT EXISTS service_hour_adjustments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL,
  requested_by BIGINT NOT NULL,
  approved_by BIGINT NULL,
  adjustment_hours NUMERIC(6,2) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 24: report_templates
CREATE TABLE IF NOT EXISTS report_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT NOT NULL,
  template_name VARCHAR(150) NOT NULL,
  template_version VARCHAR(30) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 25: rss_reports
CREATE TABLE IF NOT EXISTS rss_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  report_type VARCHAR(20) NOT NULL,
  accomplishment_submission_id BIGINT NULL,
  section_id BIGINT NULL,
  academic_year_id BIGINT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  file_path VARCHAR(500) NOT NULL,
  file_hash VARCHAR(128) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'generated',
  generated_by BIGINT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 26: report_items
CREATE TABLE IF NOT EXISTS report_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL,
  submission_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, submission_id)
);

-- TABLE 27: notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  related_type VARCHAR(100) NULL,
  related_id BIGINT NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 28: audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NULL,
  action VARCHAR(100) NOT NULL,
  subject_type VARCHAR(150) NULL,
  subject_id BIGINT NULL,
  old_values JSONB NULL,
  new_values JSONB NULL,
  ip_address INET NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
