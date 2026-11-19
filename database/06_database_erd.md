# CT-RSS Management System — PostgreSQL Entity Relationship Diagram (28 Approved Tables)

## Identity & Access Control
- `users` 1:M `user_roles` M:1 `roles`
- `users` 1:0..1 `students` (via `students.user_id`)
- `users` 1:M `user_roles` (via `assigned_by`)

## Academic Structure
- `colleges` 1:M `programs`
- `programs` 1:M `sections`
- `year_levels` 1:M `sections`
- `students` 1:M `student_section_history`
- `sections` 1:M `student_section_history`
- `academic_years` 1:M `student_section_history`

## Tasks & Applications
- `colleges` 1:M `tasks`
- `task_categories` 1:M `tasks`
- `users` 1:M `tasks` (via `created_by`)
- `tasks` M:N `sections` via `task_target_sections`
- `tasks` M:N `students` via `task_target_students`
- `tasks` 1:M `task_sessions`
- `tasks` 1:M `task_applications`
- `students` 1:M `task_applications`
- `task_applications` 1:M `application_reviews`

## Attendance, Hours, & Accomplishments
- `task_applications` 1:M `attendance` M:1 `task_sessions`
- `task_applications` 1:M `service_hour_adjustments`
- `task_applications` 1:0..1 `accomplishments`
- `accomplishments` 1:M `accomplishment_submissions`
- `accomplishment_submissions` 1:M `accomplishment_reviews`
- `accomplishment_submissions` 1:M `evidence_images`

## Reporting & System Records
- `colleges` 1:M `report_templates` 1:M `rss_reports`
- `colleges` 1:M `rss_reports`
- `accomplishment_submissions` 1:M `rss_reports` (individual reports)
- `rss_reports` 1:M `report_items` M:1 `accomplishment_submissions` (section reports)
- `users` 1:M `notifications`
- `users` 1:M `audit_logs`
