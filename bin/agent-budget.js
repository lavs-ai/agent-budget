#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import chalk from 'chalk';
import { fileURLToPath } from 'node:url';

import { classify } from '../src/classifier.js';
import { estimateCost } from '../src/estimator.js';
import { loadBudgetConfig, initBudget, loadLedger, recordUsage, getStatus } from '../src/budget.js';
import { formatUsd } from '../src/format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = path.join(process.env.HOME || ROOT, '.agent-budget');
const BUDGET_CONFIG_PATH = path.join(HOME, 'budget.json');
const LEDGER_PATH = path.join(HOME, 'usage.json');
const PRICING_PATH = path.join(ROOT, 'config', 'pricing.yaml');

function loadPricing() {
  return yaml.load(fs.readFileSync(PRICING_PATH, 'utf8'));
}

const program = new Command();
program
  .name('agent-budget')
  .description('Classify prompt complexity, recommend the cheapest sufficient model, track burn rate against your AI credit pack.')
  .version('0.2.0');

program
  .command('init')
  .description('Set up your budget period (run once per allocation cycle, e.g. per Copilot 30-day pack)')
  .option('--total <usd>', 'total budget for the period, e.g. 300', parseFloat)
  .option('--days <n>', 'period length in days', (v) => parseInt(v, 10), 30)
  .option('--start <YYYY-MM-DD>', 'period start date (defaults to today, UTC)')
  .option('--unknown', 'use this if your plan has NO published $ total (free tier / opaque quota) - see README', false)
  .action((opts) => {
    try {
      const cfg = initBudget(BUDGET_CONFIG_PATH, {
        total: opts.total, days: opts.days, startDate: opts.start, unknown: opts.unknown,
      });
      if (cfg.mode === 'unknown') {
        console.log(chalk.green(`Unknown-limit tracking started: ${cfg.periodDays}-day window from ${cfg.startDate}.`));
        console.log(chalk.gray('No $ total set - status will show tier-usage patterns instead of a burn-rate projection.'));
      } else {
        console.log(chalk.green(`Budget initialized: $${cfg.totalBudgetUsd} over ${cfg.periodDays} days starting ${cfg.startDate}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Classify a prompt, recommend a model tier, estimate cost, and log it against your budget')
  .argument('<prompt>', 'the prompt you are about to send')
  .option('--provider <name>', 'provider key from config/pricing.yaml', 'copilot_agent_mode')
  .option('--files <n>', 'number of files in scope', (v) => parseInt(v, 10), 0)
  .option('--context-file <path>', 'path to a file whose size counts as attached context (diff/log/etc)')
  .option('--no-log', 'estimate only, do not write to the usage ledger')
  .action((prompt, opts) => {
    try {
      let contextChars = 0;
      let fullText = prompt;
      if (opts.contextFile) {
        if (!fs.existsSync(opts.contextFile)) {
          console.log(chalk.yellow(`Warning: --context-file "${opts.contextFile}" not found, ignoring.`));
        } else {
          const contextContent = fs.readFileSync(opts.contextFile, 'utf8');
          contextChars = contextContent.length;
          fullText += '\n' + contextContent;
        }
      }

      const { tier, score, reasons } = classify(prompt, { filesReferenced: opts.files, contextChars });
      const pricing = loadPricing();
      const est = estimateCost({ promptText: fullText, provider: opts.provider, tier, pricingConfig: pricing });

      console.log(chalk.bold(`\nComplexity score: ${score}/100  ->  Recommended tier: ${chalk.cyan(tier)}`));
      console.log(`Reasons: ${reasons.join(', ') || 'none flagged'}`);
      console.log(`Model: ${chalk.yellow(est.model)}`);
      console.log(`Est. tokens: ${est.inputTokens} in / ${est.outputTokens} out`);
      console.log(`Est. cost: ${chalk.bold(formatUsd(est.estimatedCostUsd))}\n`);

      if (opts.log) {
        recordUsage(LEDGER_PATH, {
          provider: opts.provider,
          tier,
          score,
          model: est.model,
          estimatedCostUsd: est.estimatedCostUsd,
          promptExcerpt: prompt.slice(0, 120),
        });
        if (fs.existsSync(BUDGET_CONFIG_PATH)) {
          const budgetCfg = loadBudgetConfig(BUDGET_CONFIG_PATH);
          const status = getStatus(budgetCfg, loadLedger(LEDGER_PATH));
          if (status.mode === 'unknown') {
            console.log(chalk.gray(`This period: ${status.totalRequests} calls (LOW ${status.tierCounts.LOW} / MEDIUM ${status.tierCounts.MEDIUM} / HIGH ${status.tierCounts.HIGH})`));
            if (status.highToday >= 5) console.log(chalk.red(status.recommendation));
          } else {
            console.log(chalk.gray(`Budget: ${formatUsd(status.spent)}/${formatUsd(status.totalBudgetUsd)} spent | ${formatUsd(status.remaining)} left | day ${status.daysElapsed}/${status.daysElapsed + status.daysRemaining}`));
            if (!status.onTrack) console.log(chalk.red(status.recommendation));
          }
        } else {
          console.log(chalk.gray('(Run "agent-budget init --total 300 --days 30" to track this against a budget, or "--unknown" if your plan has no published limit.)'));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current burn rate and depletion projection')
  .action(() => {
    try {
      const budgetCfg = loadBudgetConfig(BUDGET_CONFIG_PATH);
      const ledger = loadLedger(LEDGER_PATH);
      const s = getStatus(budgetCfg, ledger);

      if (s.mode === 'unknown') {
        console.log(chalk.bold(`\nUnknown-limit tracking: day ${s.daysElapsed} of ${s.periodDays}`));
        console.log(`Requests this period: ${s.totalRequests}  (LOW ${s.tierCounts.LOW} / MEDIUM ${s.tierCounts.MEDIUM} / HIGH ${s.tierCounts.HIGH})`);
        console.log(s.highToday >= 5 ? chalk.red(s.recommendation) : chalk.green(s.recommendation));
        console.log('');
        return;
      }

      console.log(chalk.bold(`\nBudget period: ${budgetCfg.startDate} + ${budgetCfg.periodDays} days`));
      console.log(`Day ${s.daysElapsed} of ${budgetCfg.periodDays}  |  ${s.daysRemaining} day(s) remaining`);
      console.log(`Spent: ${formatUsd(s.spent)} / ${formatUsd(s.totalBudgetUsd)}   Remaining: ${formatUsd(s.remaining)}`);
      console.log(`Daily burn rate: ${formatUsd(s.dailyBurnRate)}/day   Projected total: ${formatUsd(s.projectedTotalSpend)}`);
      console.log(s.onTrack ? chalk.green(s.recommendation) : chalk.red(s.recommendation));
      console.log(`\nRequests logged this period: ${s.requestsThisPeriod}\n`);
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
