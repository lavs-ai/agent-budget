# agent-budget

[![CI](https://github.com/<you>/agent-budget/actions/workflows/ci.yml/badge.svg)](https://github.com/<you>/agent-budget/actions/workflows/ci.yml)

**Stop guessing which AI model to use, and stop running out of credits on day 22 of a 30-day pack.**

`agent-budget` is a CLI that:
1. **Classifies** your prompt's complexity (heuristic, offline, zero cost)
2. **Recommends** the cheapest model tier that can actually solve it (LOW/MEDIUM/HIGH → mapped to real models)
3. **Estimates** the $ cost of that call before you send it
4. **Tracks** cumulative spend against your fixed period budget (e.g. Copilot's $300/30-day agent-mode allocation) and warns you *before* you run dry

This exists because most companies hand developers a fixed AI credit pack (Copilot: $300/30 days for agent mode) with **zero visibility** into per-prompt cost. Devs default to the strongest model for everything "just in case," burn the pack by day 20-25, and go dark for the rest of the cycle. This tool fixes that with data, not guesswork.

## Install

```bash
git clone https://github.com/<you>/agent-budget.git
cd agent-budget
npm install
npm link   # makes `agent-budget` available globally
```

## On a free tier / plan with no published limit?

If your company or provider doesn't tell you the $ total (e.g. a "free plan" that just cuts you off one day with no warning), use unknown-limit mode instead — it can't project a burn rate without a total, but it flags risky usage patterns (e.g. a burst of HIGH-tier calls) before you find out the hard way:

```bash
agent-budget init --unknown --days 30
agent-budget check "..." --provider copilot_agent_mode
agent-budget status
# -> "5 HIGH-tier calls today. On a free or opaque-limit plan this is
#     the fastest way to trip an undisclosed quota wall."
```

## Quickstart

```bash
# 1. Set up your period once (matches your company's allocation cycle)
agent-budget init --total 300 --days 30

# 2. Before every prompt, check it
agent-budget check "fix a typo in the README" --provider copilot_agent_mode
# -> tier: LOW, model: gpt-4.1, est cost: $0.01

agent-budget check "Redesign the payment service for multi-region active-active, refactor across the whole repo" \
  --provider copilot_agent_mode --files 12
# -> tier: HIGH, model: opus/gpt-5, est cost: $0.40

# 3. Check burn rate any time
agent-budget status
# -> Day 12/30 | Spent $148/$300 | Burn rate $12.3/day
# -> "You'll run out ~4 days early. Cap yourself at $6.80/day."
```

Every `check` call logs itself to `~/.agent-budget/usage.json` and re-evaluates your burn rate, so `status` is always current without extra bookkeeping. Re-running `init` starts a new period — only usage timestamped inside the new period's date window counts toward `status`, so a fresh cycle always starts at $0 spent regardless of history in the ledger.

## Testing

```bash
npm test
```
21 tests covering the classifier's tier boundaries, the cost math for both billing models, and the budget tracker's period-reset logic. CI runs this on every push against Node 18/20/22 (see `.github/workflows/ci.yml`).

## How classification works

Pure heuristics — no LLM call to decide whether to call an LLM. Signals: prompt length, complexity/simplicity keywords, presence of a stack trace, number of files in scope, size of attached context. See [`src/classifier.js`](src/classifier.js) — it's ~70 lines, read it, tune it for your team's vocabulary.

## Pricing config is yours to own

[`config/pricing.yaml`](config/pricing.yaml) is the single file you edit when your provider changes pricing or your org changes plans. Two billing models supported out of the box:
- `token` — pay per input/output million-tokens (direct Claude/OpenAI API)
- `multiplier` — pay in "premium requests" against an allocation (Copilot agent-mode style)

Add your own provider block; the CLI doesn't care which one you pick.

## Architecture

```
prompt ──▶ classifier.js ──▶ tier (LOW/MEDIUM/HIGH)
                                   │
config/pricing.yaml ───────────────┼──▶ estimator.js ──▶ est. $ cost
                                   │
                                   ▼
                            budget.js (ledger + burn-rate math)
                                   │
                                   ▼
                     status: on-track? safe daily $ cap?
```

## Roadmap (open-source now → hosted later)

| Stage | What | License |
|---|---|---|
| v0 (now) | CLI, local ledger, heuristic classifier | MIT, public repo |
| v1 | VS Code extension — inline tier badge as you type, one-click "downgrade to Sonnet" | MIT |
| v2 | Team dashboard: aggregate every dev's `usage.json` (via the included GitHub Action) into one burn-rate view for engineering managers | Free tier + paid team tier |
| v3 | Slack/Teams alerts ("You're 80% through your pack, 9 days left"), org-wide policy enforcement (block HIGH tier past X% spent) | Paid (hosted SaaS) |
| v4 | Learned classifier (fine-tuned on your team's actual usage → outcome data) instead of static heuristics | Paid, enterprise |

The free CLI never gets crippled to sell the SaaS — the dashboard/alerts/policy layer is genuinely new value (cross-developer aggregation you can't get from a local JSON file), not a feature held hostage.

## Scaling this to a team

The local `usage.json` ledger is intentionally dumb (no server, no telemetry) for v0. To go multi-dev:
1. Point `LEDGER_PATH` at a shared SQLite file (Turso/LibSQL for zero-ops sync) or Postgres
2. Keep `pricing.yaml` centralized in a shared repo so the whole team recommends from the same tier map
3. The included `.github/workflows/usage-report.yml` is the seed for a daily org-wide burn-rate digest

## Why not just use the AI to classify the prompt?

Because calling Claude to decide whether to call Claude burns the exact budget you're trying to protect. The classifier has to be free and instant, or the tool doesn't pay for itself. If you want a smarter (paid) classifier later, that's the v4 "learned classifier" — trained offline on logged (prompt → actual token usage) pairs, run entirely locally at inference time.

## Known limitations

- **The classifier is a heuristic, not ground truth.** It will misjudge prompts that don't match its keyword lists (e.g. a domain-specific term it doesn't recognize as "complex"). Tune `src/classifier.js` against a week of your own real prompts before trusting it blindly.
- **Cost estimates are approximate.** Token counts use a chars-per-4 heuristic (industry-standard rough estimate), not the actual tokenizer of whichever model you use. Treat `check` output as a planning signal, not an invoice.
- **`config/pricing.yaml` ships placeholder numbers.** Update `input_per_mtok`/`output_per_mtok`/`unit_cost_usd` to match your actual plan before relying on the dollar figures.
- **Single-user by design (v0).** The ledger is a local file; it doesn't know about other developers' usage. See "Scaling this" above for the team path.

## License

MIT — see [LICENSE](LICENSE).
