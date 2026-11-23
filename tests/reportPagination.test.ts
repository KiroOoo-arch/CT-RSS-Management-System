// MUST be the first import: validates .env.test before any other module is evaluated.
import './testSetup.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabasePool, query } from '../src/server/config/database.ts';
import { listRssReports } from '../src/server/services/reportService.ts';

test('report-pagination: default pagination returns correct shape', async () => {
  const result = await listRssReports({});
  assert.ok(Array.isArray(result.reports), 'reports should be an array');
  assert.equal(typeof result.totalCount, 'number', 'totalCount should be a number');
  assert.equal(typeof result.page, 'number', 'page should be a number');
  assert.equal(typeof result.pageSize, 'number', 'pageSize should be a number');
  assert.equal(result.page, 1, 'default page should be 1');
  assert.equal(result.pageSize, 20, 'default pageSize should be 20');
  assert.ok(result.totalCount >= 0, 'totalCount should be non-negative');
  assert.ok(result.reports.length <= result.pageSize, 'reports length should not exceed pageSize');
});

test('report-pagination: explicit page and pageSize', async () => {
  const result = await listRssReports({ page: 1, pageSize: 5 });
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 5);
  assert.ok(result.reports.length <= 5);
});

test('report-pagination: invalid page defaults to 1', async () => {
  const result = await listRssReports({ page: 0, pageSize: 10 });
  assert.equal(result.page, 1, 'page 0 should default to 1');
});

test('report-pagination: invalid pageSize defaults to 20', async () => {
  const result = await listRssReports({ page: 1, pageSize: 0 });
  assert.equal(result.pageSize, 20, 'pageSize 0 should default to 20');
});

test('report-pagination: max pageSize enforced at 100', async () => {
  const result = await listRssReports({ page: 1, pageSize: 200 });
  assert.equal(result.pageSize, 100, 'pageSize 200 should be capped to 100');
});

test('report-pagination: totalCount accuracy', async () => {
  const result1 = await listRssReports({ page: 1, pageSize: 100 });
  // Fetch all pages and verify total count
  let totalFetched = 0;
  let page = 1;
  while (true) {
    const r = await listRssReports({ page, pageSize: 100 });
    totalFetched += r.reports.length;
    if (r.reports.length < 100) break;
    page++;
    if (page > 10) break; // safety
  }
  assert.equal(totalFetched, result1.totalCount,
    `Total fetched (${totalFetched}) should equal totalCount (${result1.totalCount})`);
});

test.after(async () => {
  await closeDatabasePool();
});