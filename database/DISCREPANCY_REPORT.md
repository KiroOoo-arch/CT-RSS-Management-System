# Schema Verification & Discrepancy Report (Milestone 2)

## Summary
- **Approved Target Tables:** 28
- **Implemented Tables in `02_create_tables.sql`:** 28
- **Extra Unapproved Tables Added:** 0 (migrations execute cleanly without introducing a 29th tracking table)

## Key Verification Notes
1. **Identity & Roles:** `users`, `roles`, and `user_roles` match the approved schema. Only `RSS Coordinator`, `Student`, and `Section Representative` are seeded.
2. **Session Invalidation Without Extra Tables:** Signed `HttpOnly` session tokens store a `sha256(sid)` digest in `users.remember_token`, enabling server-side invalidation on logout within the 28-table constraint.
3. **Partial Unique Indexes:** `uq_academic_years_single_current` and `uq_student_section_history_current` are enforced in `04_indexes.sql`.
4. **Historical Record Preservation:** Foreign keys use `ON DELETE RESTRICT` or `ON DELETE SET NULL` for official/historical records; only `task_target_sections` and `task_target_students` cascade on parent task deletion.
5. **Uninvented Institutional Data:** `task_categories`, `programs`, `academic_years`, `sections`, and fake student records are intentionally omitted from `05_seed_data.sql`.
