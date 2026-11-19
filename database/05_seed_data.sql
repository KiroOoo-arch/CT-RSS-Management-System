-- CT-RSS Management System (Lapu-Lapu City College — College of Technology)
-- 05_seed_data.sql
-- Verified reference seed data only.
-- NOTE: task_categories, programs, sections, academic_years, and fake students are
-- intentionally NOT invented or seeded.

INSERT INTO roles (name, description)
VALUES
  ('RSS Coordinator', 'Primary operational authority for registrations, academic structure, task publication, application reviews, attendance verification, hour adjustments, accomplishment reviews, and official RSS reports.'),
  ('Student', 'Student participant account with access to personal profile, eligible RSS tasks, applications, verified attendance hours, versioned accomplishments, and authorized individual reports.'),
  ('Section Representative', 'Read-only section representative role limited to authorized section information, tasks, and permitted participation summaries.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO colleges (name, code, description, is_active)
VALUES
  ('College of Technology', 'CT', 'Initial deployment college at Lapu-Lapu City College.', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO year_levels (name, sort_order)
VALUES
  ('1st Year', 1),
  ('2nd Year', 2),
  ('3rd Year', 3),
  ('4th Year', 4)
ON CONFLICT (name) DO NOTHING;
