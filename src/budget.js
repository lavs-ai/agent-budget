// src/budget.js
// Local, file-based usage ledger (no server, no telemetry - it's your
// company's $300, not ours). Swap the storage layer for SQLite/Postgres
// later if you need team-wide aggregation (see README "Scaling this").

import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

// Date-only, UTC-safe day index. Mixing `new Date(str)` with local
// `new Date()` causes off-by-one burn-rate errors near midnight/timezone
// boundaries - everything here is computed in whole UTC days instead.
function utcDayIndex(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
}

export function loadBudgetConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No budget config found. Run "agent-budget init --total 300 --days 30" first (or "agent-budget init --unknown --days 30" if you're on a free/opaque-limit plan).`
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

/**
 * @param {string} configPath
 * @param {object} opts
 * @param {number} [opts.total] - required unless opts.unknown is true
 * @param {number} opts.days
 * @param {string} [opts.startDate] - YYYY-MM-DD, defaults to today (UTC)
 * @param {boolean} [opts.unknown] - true for free/opaque-quota plans with no known $ total
 */
export function initBudget(configPath, { total, days, startDate, unknown = false }) {
  if (!unknown && (total === undefined || total === null || Number.isNaN(total))) {
    throw new Error('--total is required unless you pass --unknown (for free/opaque-limit plans)');
  }
  if (!days || days <= 0) {
    throw new Error('--days must be a positive number');
  }
  const cfg = {
    mode: unknown ? 'unknown' : 'known',
    totalBudgetUsd: unknown ? null : total,
    periodDays: days,
    startDate: startDate || new Date().toISOString().slice(0, 10),
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  return cfg;
}

export function loadLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
}

export function recordUsage(ledgerPath, entry) {
  const ledger = loadLedger(ledgerPath);
  ledger.push({ timestamp: new Date().toISOString(), ...entry });
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  return ledger;
}

/**
 * Ledger entries are never deleted (so history/export/audit still works),
 * but every status calculation must only count entries that fall inside
 * the CURRENT budget period - otherwise re-running `init` for a new
 * 30-day pack silently inherits last cycle's spend forever.
 */
function entriesInCurrentPeriod(ledger, budgetCfg) {
  const startDay = utcDayIndex(new Date(budgetCfg.startDate + 'T00:00:00Z'));
  const endDay = startDay + budgetCfg.periodDays; // exclusive
  return ledger.filter((e) => {
    const day = utcDayIndex(new Date(e.timestamp));
    return day >= startDay && day < endDay;
  });
}

/**
 * Core FinOps math: given what's been spent so far and how many days are
 * left in the billing period, tell the user if they're on track to run out
 * early, and what daily spend they need to hold to make it to the last day.
 *
 * Two shapes returned depending on budgetCfg.mode:
 *  - 'known'   -> full $ burn-rate projection (needs a total budget figure)
 *  - 'unknown' -> tier-count heuristic for free/opaque-limit plans where
 *                 there is no $ figure to project against (see README)
 */
export function getStatus(budgetCfg, ledger) {
  const periodEntries = entriesInCurrentPeriod(ledger, budgetCfg);

  const startDay = utcDayIndex(new Date(budgetCfg.startDate + 'T00:00:00Z'));
  const todayDay = utcDayIndex(new Date());
  const daysElapsedRaw = todayDay - startDay + 1;
  // Cap to the period length so a status check run after the period ends
  // (or before it starts) still reports a sane day count.
  const daysElapsed = Math.min(Math.max(1, daysElapsedRaw), budgetCfg.periodDays);

  if (budgetCfg.mode === 'unknown') {
    const tierCounts = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    let highToday = 0;
    for (const e of periodEntries) {
      if (tierCounts[e.tier] !== undefined) tierCounts[e.tier]++;
      if (e.tier === 'HIGH' && utcDayIndex(new Date(e.timestamp)) === todayDay) highToday++;
    }
    const recommendation = highToday >= 5
      ? `${highToday} HIGH-tier calls today. On a free or opaque-limit plan this is the fastest way to trip an undisclosed quota wall - default to MEDIUM/LOW and reserve HIGH for genuine blockers.`
      : 'No unusual HIGH-tier concentration today. Since the real limit is unknown, keep defaulting to the lowest tier that solves the problem.';
    return {
      mode: 'unknown',
      daysElapsed,
      periodDays: budgetCfg.periodDays,
      totalRequests: periodEntries.length,
      tierCounts,
      highToday,
      recommendation,
    };
  }

  const daysRemaining = Math.max(0, budgetCfg.periodDays - daysElapsed);
  const spent = round2(periodEntries.reduce((sum, e) => sum + (e.estimatedCostUsd || 0), 0));
  const remaining = round2(budgetCfg.totalBudgetUsd - spent);

  const dailyBurnRate = round2(spent / daysElapsed);
  const projectedTotalSpend = round2(dailyBurnRate * budgetCfg.periodDays);
  const projectedDepletionDay = dailyBurnRate > 0
    ? Math.ceil(budgetCfg.totalBudgetUsd / dailyBurnRate)
    : null;

  const safeDailyBudget = daysRemaining > 0 ? round2(remaining / daysRemaining) : 0;
  const onTrack = projectedDepletionDay === null || projectedDepletionDay >= budgetCfg.periodDays;

  let recommendation;
  if (remaining <= 0) {
    recommendation = 'BUDGET EXHAUSTED for this period. Switch to LOW tier only, or wait for the next cycle.';
  } else if (!onTrack) {
    const overshootDays = budgetCfg.periodDays - projectedDepletionDay;
    recommendation = `At current burn rate you'll run out ~${overshootDays} day(s) before period end (day ${projectedDepletionDay}/${budgetCfg.periodDays}). Cap yourself at $${safeDailyBudget}/day - default to MEDIUM/LOW tier, reserve HIGH for genuinely hard problems.`;
  } else {
    recommendation = `On track. Safe daily budget: $${safeDailyBudget}/day for the remaining ${daysRemaining} day(s).`;
  }

  return {
    mode: 'known',
    daysElapsed,
    daysRemaining,
    requestsThisPeriod: periodEntries.length,
    spent,
    remaining,
    totalBudgetUsd: budgetCfg.totalBudgetUsd,
    dailyBurnRate,
    projectedTotalSpend,
    projectedDepletionDay,
    safeDailyBudget,
    onTrack,
    recommendation,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
