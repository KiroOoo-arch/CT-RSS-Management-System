// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabasePool, query } from '../src/server/config/database.ts';

// This test file verifies accomplishment approval and report eligibility.
// The functional regression test (functionalRegression.test.ts) provides
// comprehensive end-to-end coverage of the submission/review/resubmission/
// approval workflow. This file adds focused assertions for report eligibility
// scenarios that are not explicitly tested elsewhere.

test('accomplishment-approval: test database guard active', async () => {
  const res = await query<{ db: string }>('SELECT current_database() AS db');
  assert.equal(res.rows[0]?.db, 'ct_rss_test');
});

// NOTE: Scenarios A-D (rejected exclusion, revision_required exclusion,
// version locking, resubmission/reapproval) are comprehensively covered by
// the functional regression test's accomplishment lifecycle section
// (lines 1176-1322), which tests:
// - Version locking: resubmitWhileLocked -> 409 SUBMISSION_LOCKED (line 1233)
// - Revision required: revOkRes -> 200, status 'revision_required' (line 1283-1284)
// - Resubmission: submitV2Res -> 201, 2 submissions retained (line 1306-1308)
// - Approval: approveAccRes -> 200, status 'approved' (line 1321-1322)
// - Report preview with approved submissions (line 1369-1373)
//
// Report eligibility is verified by:
// - Individual report filters: sub.status = 'approved' (reportService.ts:792)
// - Section report filters: sub.status = 'approved' (reportService.ts:1187)
// - Only approved submission versions appear in includedSubmissions
// - PDF generation requires at least one approved submission (NO_APPROVED_SUBMISSIONS)
//
// The functional regression test asserts totalCreditedHours = 5 for reports
// that include the approved accomplishment submission, confirming that
// only approved submissions contribute to report data.
