-- CT-RSS Management System (Lapu-Lapu City College — College of Technology)
-- 03_constraints.sql
-- Idempotent foreign keys and check constraints preserving historical records.

DO $$
BEGIN
  -- CHECK CONSTRAINTS
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_account_status') THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_account_status
      CHECK (account_status IN ('pending', 'active', 'suspended', 'deactivated'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_academic_years_dates') THEN
    ALTER TABLE academic_years
      ADD CONSTRAINT chk_academic_years_dates
      CHECK (end_date > start_date);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_students_registration_status') THEN
    ALTER TABLE students
      ADD CONSTRAINT chk_students_registration_status
      CHECK (registration_status IN ('pending', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_section_history_dates') THEN
    ALTER TABLE student_section_history
      ADD CONSTRAINT chk_student_section_history_dates
      CHECK (ended_at IS NULL OR ended_at >= enrolled_at);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_visibility') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_visibility
      CHECK (visibility IN ('all_students', 'specific_sections', 'selected_students'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_capacity') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_capacity
      CHECK (capacity IS NULL OR capacity > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_required_hours') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_required_hours
      CHECK (required_hours IS NULL OR required_hours >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_application_dates') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_application_dates
      CHECK (application_start IS NULL OR application_deadline IS NULL OR application_deadline > application_start);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_activity_dates') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_activity_dates
      CHECK (activity_start IS NULL OR activity_end IS NULL OR activity_end > activity_start);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_status') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT chk_tasks_status
      CHECK (status IN ('draft', 'published', 'ongoing', 'completed', 'cancelled', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_sessions_time_range') THEN
    ALTER TABLE task_sessions
      ADD CONSTRAINT chk_task_sessions_time_range
      CHECK (end_time > start_time);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_applications_status') THEN
    ALTER TABLE task_applications
      ADD CONSTRAINT chk_task_applications_status
      CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_reviews_decision') THEN
    ALTER TABLE application_reviews
      ADD CONSTRAINT chk_application_reviews_decision
      CHECK (decision IN ('approved', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accomplishments_status') THEN
    ALTER TABLE accomplishments
      ADD CONSTRAINT chk_accomplishments_status
      CHECK (status IN ('draft', 'submitted', 'revision_required', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accomplishment_submissions_version') THEN
    ALTER TABLE accomplishment_submissions
      ADD CONSTRAINT chk_accomplishment_submissions_version
      CHECK (version_number > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accomplishment_submissions_status') THEN
    ALTER TABLE accomplishment_submissions
      ADD CONSTRAINT chk_accomplishment_submissions_status
      CHECK (status IN ('submitted', 'approved', 'revision_required', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accomplishment_reviews_decision') THEN
    ALTER TABLE accomplishment_reviews
      ADD CONSTRAINT chk_accomplishment_reviews_decision
      CHECK (decision IN ('approved', 'revision_required', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_evidence_images_file_size') THEN
    ALTER TABLE evidence_images
      ADD CONSTRAINT chk_evidence_images_file_size
      CHECK (file_size > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_evidence_images_category') THEN
    ALTER TABLE evidence_images
      ADD CONSTRAINT chk_evidence_images_category
      CHECK (image_category IN ('before', 'during', 'after', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_check_times') THEN
    ALTER TABLE attendance
      ADD CONSTRAINT chk_attendance_check_times
      CHECK (check_in IS NULL OR check_out IS NULL OR check_out > check_in);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_recorded_hours') THEN
    ALTER TABLE attendance
      ADD CONSTRAINT chk_attendance_recorded_hours
      CHECK (recorded_hours >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_verified_hours') THEN
    ALTER TABLE attendance
      ADD CONSTRAINT chk_attendance_verified_hours
      CHECK (verified_hours >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_verification_status') THEN
    ALTER TABLE attendance
      ADD CONSTRAINT chk_attendance_verification_status
      CHECK (verification_status IN ('pending', 'verified', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_hour_adjustments_status') THEN
    ALTER TABLE service_hour_adjustments
      ADD CONSTRAINT chk_service_hour_adjustments_status
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rss_reports_type') THEN
    ALTER TABLE rss_reports
      ADD CONSTRAINT chk_rss_reports_type
      CHECK (report_type IN ('individual', 'section'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rss_reports_version') THEN
    ALTER TABLE rss_reports
      ADD CONSTRAINT chk_rss_reports_version
      CHECK (version > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rss_reports_status') THEN
    ALTER TABLE rss_reports
      ADD CONSTRAINT chk_rss_reports_status
      CHECK (status IN ('generated', 'approved', 'archived'));
  END IF;

  -- FOREIGN KEYS (Historical integrity: RESTRICT or SET NULL; safe junction CASCADE only)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_user') THEN
    ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_role') THEN
    ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_role
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_assigned_by') THEN
    ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_assigned_by
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_programs_college') THEN
    ALTER TABLE programs ADD CONSTRAINT fk_programs_college
      FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sections_program') THEN
    ALTER TABLE sections ADD CONSTRAINT fk_sections_program
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sections_year_level') THEN
    ALTER TABLE sections ADD CONSTRAINT fk_sections_year_level
      FOREIGN KEY (year_level_id) REFERENCES year_levels(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_students_user') THEN
    ALTER TABLE students ADD CONSTRAINT fk_students_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_students_reviewed_by') THEN
    ALTER TABLE students ADD CONSTRAINT fk_students_reviewed_by
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ssh_student') THEN
    ALTER TABLE student_section_history ADD CONSTRAINT fk_ssh_student
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ssh_section') THEN
    ALTER TABLE student_section_history ADD CONSTRAINT fk_ssh_section
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ssh_academic_year') THEN
    ALTER TABLE student_section_history ADD CONSTRAINT fk_ssh_academic_year
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_college') THEN
    ALTER TABLE tasks ADD CONSTRAINT fk_tasks_college
      FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_category') THEN
    ALTER TABLE tasks ADD CONSTRAINT fk_tasks_category
      FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_created_by') THEN
    ALTER TABLE tasks ADD CONSTRAINT fk_tasks_created_by
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tts_task') THEN
    ALTER TABLE task_target_sections ADD CONSTRAINT fk_tts_task
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tts_section') THEN
    ALTER TABLE task_target_sections ADD CONSTRAINT fk_tts_section
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ttst_task') THEN
    ALTER TABLE task_target_students ADD CONSTRAINT fk_ttst_task
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ttst_student') THEN
    ALTER TABLE task_target_students ADD CONSTRAINT fk_ttst_student
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_sessions_task') THEN
    ALTER TABLE task_sessions ADD CONSTRAINT fk_task_sessions_task
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_applications_task') THEN
    ALTER TABLE task_applications ADD CONSTRAINT fk_task_applications_task
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_applications_student') THEN
    ALTER TABLE task_applications ADD CONSTRAINT fk_task_applications_student
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_reviews_application') THEN
    ALTER TABLE application_reviews ADD CONSTRAINT fk_app_reviews_application
      FOREIGN KEY (application_id) REFERENCES task_applications(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_reviews_reviewed_by') THEN
    ALTER TABLE application_reviews ADD CONSTRAINT fk_app_reviews_reviewed_by
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_accomplishments_application') THEN
    ALTER TABLE accomplishments ADD CONSTRAINT fk_accomplishments_application
      FOREIGN KEY (application_id) REFERENCES task_applications(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_accomplishments_reviewed_by') THEN
    ALTER TABLE accomplishments ADD CONSTRAINT fk_accomplishments_reviewed_by
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_acc_sub_accomplishment') THEN
    ALTER TABLE accomplishment_submissions ADD CONSTRAINT fk_acc_sub_accomplishment
      FOREIGN KEY (accomplishment_id) REFERENCES accomplishments(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_acc_sub_submitted_by') THEN
    ALTER TABLE accomplishment_submissions ADD CONSTRAINT fk_acc_sub_submitted_by
      FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_acc_reviews_submission') THEN
    ALTER TABLE accomplishment_reviews ADD CONSTRAINT fk_acc_reviews_submission
      FOREIGN KEY (submission_id) REFERENCES accomplishment_submissions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_acc_reviews_reviewed_by') THEN
    ALTER TABLE accomplishment_reviews ADD CONSTRAINT fk_acc_reviews_reviewed_by
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evidence_submission') THEN
    ALTER TABLE evidence_images ADD CONSTRAINT fk_evidence_submission
      FOREIGN KEY (submission_id) REFERENCES accomplishment_submissions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evidence_uploaded_by') THEN
    ALTER TABLE evidence_images ADD CONSTRAINT fk_evidence_uploaded_by
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_application') THEN
    ALTER TABLE attendance ADD CONSTRAINT fk_attendance_application
      FOREIGN KEY (application_id) REFERENCES task_applications(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_session') THEN
    ALTER TABLE attendance ADD CONSTRAINT fk_attendance_session
      FOREIGN KEY (task_session_id) REFERENCES task_sessions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_verified_by') THEN
    ALTER TABLE attendance ADD CONSTRAINT fk_attendance_verified_by
      FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sha_application') THEN
    ALTER TABLE service_hour_adjustments ADD CONSTRAINT fk_sha_application
      FOREIGN KEY (application_id) REFERENCES task_applications(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sha_requested_by') THEN
    ALTER TABLE service_hour_adjustments ADD CONSTRAINT fk_sha_requested_by
      FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sha_approved_by') THEN
    ALTER TABLE service_hour_adjustments ADD CONSTRAINT fk_sha_approved_by
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_report_templates_college') THEN
    ALTER TABLE report_templates ADD CONSTRAINT fk_report_templates_college
      FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_report_templates_uploaded_by') THEN
    ALTER TABLE report_templates ADD CONSTRAINT fk_report_templates_uploaded_by
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rss_reports_college') THEN
    ALTER TABLE rss_reports ADD CONSTRAINT fk_rss_reports_college
      FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rss_reports_template') THEN
    ALTER TABLE rss_reports ADD CONSTRAINT fk_rss_reports_template
      FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rss_reports_submission') THEN
    ALTER TABLE rss_reports ADD CONSTRAINT fk_rss_reports_submission
      FOREIGN KEY (accomplishment_submission_id) REFERENCES accomplishment_submissions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rss_reports_section') THEN
    ALTER TABLE rss_reports ADD CONSTRAINT fk_rss_reports_section
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rss_reports_academic_year') THEN
    ALTER TABLE rss_reports ADD CONSTRAINT fk_rss_reports_academic_year
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rss_reports_generated_by') THEN
    ALTER TABLE rss_reports ADD CONSTRAINT fk_rss_reports_generated_by
      FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_report_items_report') THEN
    ALTER TABLE report_items ADD CONSTRAINT fk_report_items_report
      FOREIGN KEY (report_id) REFERENCES rss_reports(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_report_items_submission') THEN
    ALTER TABLE report_items ADD CONSTRAINT fk_report_items_submission
      FOREIGN KEY (submission_id) REFERENCES accomplishment_submissions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notifications_user') THEN
    ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_logs_user') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
