// src/classifier.js
// Deterministic, offline, zero-cost complexity classifier.
// Deliberately NOT an LLM call - calling an LLM to decide whether to call
// an LLM defeats the purpose of a budget tool. Pure heuristics only.

const HIGH_SIGNALS = [
  /architect(ure)?/i, /refactor/i, /migrat(e|ion)/i, /redesign/i,
  /race condition/i, /concurrenc(y|e)/i, /deadlock/i, /memory leak/i,
  /root cause/i, /security (vuln|audit|review)/i, /performance (issue|bottleneck)/i,
  /across (the |multiple )?(files|codebase|repo|services)/i,
  /distributed/i, /multi-?agent/i, /orchestrat/i, /end-?to-?end/i,
  /design (a |the )?system/i, /scal(e|ing|ability)/i,
];

const LOW_SIGNALS = [
  /\btypo\b/i, /rename/i, /\bformat(ting)?\b/i, /add (a )?comment/i,
  /one-?line/i, /\bindent/i, /update readme/i, /bump version/i,
  /add \.gitignore/i, /simple/i, /trivial/i, /small (fix|change)/i,
];

const STACK_TRACE = /(Traceback \(most recent call last\)|\bat \S+\(.*:\d+:\d+\)|Exception in thread|line \d+, in )/;

/**
 * @param {string} prompt - raw user prompt text
 * @param {object} [ctx]
 * @param {number} [ctx.filesReferenced] - number of distinct files/paths in the prompt or attached context
 * @param {number} [ctx.contextChars] - size of attached code/context (diff, logs, files) in characters
 * @returns {{ tier: 'LOW'|'MEDIUM'|'HIGH', score: number, reasons: string[] }}
 */
export function classify(prompt, ctx = {}) {
  const { filesReferenced = 0, contextChars = 0 } = ctx;
  const reasons = [];
  let score = 0;

  // 1. Raw prompt length (proxy for how much the user had to explain)
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  if (words > 150) { score += 20; reasons.push(`long prompt (${words} words)`); }
  else if (words > 60) { score += 10; reasons.push(`medium prompt (${words} words)`); }
  else { score += 2; }

  // 2. High-complexity keyword signals
  const highHits = HIGH_SIGNALS.filter((re) => re.test(prompt));
  if (highHits.length) {
    score += Math.min(40, highHits.length * 15);
    reasons.push(`complexity keywords: ${highHits.length}`);
  }

  // 3. Low-complexity keyword signals (pulls score down)
  const lowHits = LOW_SIGNALS.filter((re) => re.test(prompt));
  if (lowHits.length && !highHits.length) {
    score -= Math.min(25, lowHits.length * 12);
    reasons.push(`simple-task keywords: ${lowHits.length}`);
  }

  // 4. Stack trace / error log present -> real debugging, bump up
  if (STACK_TRACE.test(prompt)) {
    score += 15;
    reasons.push('stack trace / error log detected');
  }

  // 5. Multi-file scope
  if (filesReferenced >= 5) { score += 25; reasons.push(`${filesReferenced} files in scope`); }
  else if (filesReferenced >= 2) { score += 12; reasons.push(`${filesReferenced} files in scope`); }

  // 6. Size of attached context (large diffs/logs = more reasoning required)
  // Weighted high enough that a large attachment alone (e.g. a big diff or
  // log pasted after a one-line prompt) is sufficient to leave LOW tier -
  // a short instruction doesn't mean a small problem.
  if (contextChars > 20000) { score += 26; reasons.push('large attached context (>20k chars)'); }
  else if (contextChars > 5000) { score += 12; reasons.push('moderate attached context'); }

  score = Math.max(0, Math.min(100, score));

  let tier;
  if (score >= 55) tier = 'HIGH';
  else if (score >= 25) tier = 'MEDIUM';
  else tier = 'LOW';

  return { tier, score, reasons };
}
