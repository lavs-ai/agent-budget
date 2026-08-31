import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initBudget, loadBudgetConfig, getStatus } from '../src/budget.js';

function tmpPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-budget-test-')), name);
}

test('initBudget requires --total unless unknown is set', () => {
  assert.throws(() => initBudget(tmpPath('budget.json'), { days: 30 }), /required/);
});

test('initBudget requires a positive day count', () => {
  assert.throws(() => initBudget(tmpPath('budget.json'), { total: 300, days: 0 }), /positive/);
});

test('initBudget writes and loadBudgetConfig reads back the same config', () => {
  const p = tmpPath('budget.json');
  const written = initBudget(p, { total: 300, days: 30, startDate: '2026-08-01' });
  const read = loadBudgetConfig(p);
  assert.deepEqual(read, written);
});

test('getStatus: on-track scenario reports a positive safe daily budget', () => {
  const budgetCfg = { mode: 'known', totalBudgetUsd: 300, periodDays: 30, startDate: todayMinusDays(2) };
  const ledger = [
    { timestamp: new Date().toISOString(), estimatedCostUsd: 5, tier: 'MEDIUM' },
  ];
  const s = getStatus(budgetCfg, ledger);
  assert.equal(s.onTrack, true);
  assert.ok(s.safeDailyBudget > 0);
});

test('getStatus: fast burn correctly projects early depletion', () => {
  const budgetCfg = { mode: 'known', totalBudgetUsd: 300, periodDays: 30, startDate: todayMinusDays(2) };
  const ledger = [
    { timestamp: new Date().toISOString(), estimatedCostUsd: 45, tier: 'HIGH' },
  ];
  const s = getStatus(budgetCfg, ledger);
  assert.equal(s.onTrack, false);
  assert.ok(s.projectedDepletionDay < 30);
});

// --- Regression test for the bug found in review: re-running init for a new
// billing period must NOT inherit spend logged under the previous period. ---
test('getStatus excludes ledger entries from before the current period start (period-reset bug)', () => {
  const budgetCfg = { mode: 'known', totalBudgetUsd: 300, periodDays: 30, startDate: '2026-08-01' };
  const ledger = [
    // spend from a previous cycle (July) - must be ignored
    { timestamp: '2026-07-15T10:00:00Z', estimatedCostUsd: 280, tier: 'HIGH' },
  ];
  const s = getStatus(budgetCfg, ledger);
  assert.equal(s.spent, 0);
  assert.equal(s.remaining, 300);
  assert.equal(s.requestsThisPeriod, 0);
});

test('getStatus excludes ledger entries that fall after the current period ends', () => {
  const budgetCfg = { mode: 'known', totalBudgetUsd: 300, periodDays: 30, startDate: '2026-08-01' };
  const ledger = [
    { timestamp: '2026-09-15T10:00:00Z', estimatedCostUsd: 100, tier: 'HIGH' }, // next cycle already
  ];
  const s = getStatus(budgetCfg, ledger);
  assert.equal(s.spent, 0);
});

test('getStatus in unknown mode returns tier counts, not a $ projection', () => {
  const budgetCfg = { mode: 'unknown', periodDays: 30, startDate: todayMinusDays(1) };
  const ledger = [
    { timestamp: new Date().toISOString(), tier: 'HIGH' },
    { timestamp: new Date().toISOString(), tier: 'HIGH' },
    { timestamp: new Date().toISOString(), tier: 'LOW' },
  ];
  const s = getStatus(budgetCfg, ledger);
  assert.equal(s.mode, 'unknown');
  assert.equal(s.tierCounts.HIGH, 2);
  assert.equal(s.tierCounts.LOW, 1);
  assert.equal(s.totalBudgetUsd, undefined);
});

test('getStatus caps daysElapsed at periodDays instead of showing "day 61 of 30"', () => {
  const budgetCfg = { mode: 'known', totalBudgetUsd: 300, periodDays: 30, startDate: '2020-01-01' };
  const s = getStatus(budgetCfg, []);
  assert.ok(s.daysElapsed <= 30);
});

function todayMinusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
