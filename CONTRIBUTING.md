# Contributing

## Setup
```bash
git clone https://github.com/<you>/agent-budget.git
cd agent-budget
npm install
npm test
```
All 21 tests should pass before you start. If they don't, something's wrong with your environment (Node 18+ required), not the code.

## Before opening a PR
- `npm test` must pass (CI will also run it on Node 18/20/22).
- If you change `src/classifier.js` scoring, add a test in `test/classifier.test.js` showing the specific prompt pattern you're fixing.
- If you add a provider to `config/pricing.yaml`, it doesn't need a code change — the CLI reads it generically.

## Where things live
- `src/classifier.js` — complexity scoring (pure functions, easiest place to contribute)
- `src/estimator.js` — cost math
- `src/budget.js` — ledger + burn-rate projection
- `bin/agent-budget.js` — CLI wiring only; keep logic in `src/`, not here

## Reporting a bad classification
Open an issue with the exact prompt text and what tier you expected vs. got. That's the single most useful contribution — the classifier only gets better with real examples.
