// src/estimator.js
// Turns (prompt + attached context + tier) into an estimated $ cost,
// using the pricing.yaml config. No network calls, no API keys needed
// to just get an estimate.

export function estimateTokens(text, charsPerToken = 4) {
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

/**
 * @param {object} params
 * @param {string} params.promptText - full prompt incl. attached context
 * @param {string} params.provider - key in pricing.yaml `providers`
 * @param {'LOW'|'MEDIUM'|'HIGH'} params.tier
 * @param {object} params.pricingConfig - parsed pricing.yaml
 * @param {number} [params.expectedOutputTokens] - override the default ratio
 */
export function estimateCost({ promptText, provider, tier, pricingConfig, expectedOutputTokens }) {
  const providerCfg = pricingConfig.providers[provider];
  if (!providerCfg) throw new Error(`Unknown provider "${provider}" - check config/pricing.yaml`);
  const tierCfg = providerCfg.tiers[tier];
  if (!tierCfg) throw new Error(`Unknown tier "${tier}" for provider "${provider}"`);

  const charsPerToken = pricingConfig.estimation?.chars_per_token ?? 4;
  const outputRatio = pricingConfig.estimation?.default_output_input_ratio ?? 2.5;

  const inputTokens = estimateTokens(promptText, charsPerToken);
  const outputTokens = expectedOutputTokens ?? Math.ceil(inputTokens * outputRatio);

  if (providerCfg.billing === 'token') {
    const inputCost = (inputTokens / 1_000_000) * tierCfg.input_per_mtok;
    const outputCost = (outputTokens / 1_000_000) * tierCfg.output_per_mtok;
    return {
      model: tierCfg.model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: round4(inputCost + outputCost),
      billing: 'token',
    };
  }

  if (providerCfg.billing === 'multiplier') {
    const unitCost = providerCfg.unit_cost_usd;
    const costUsd = unitCost * tierCfg.multiplier;
    return {
      model: tierCfg.model,
      inputTokens,
      outputTokens,
      premiumRequestMultiplier: tierCfg.multiplier,
      estimatedCostUsd: round4(costUsd),
      billing: 'multiplier',
    };
  }

  throw new Error(`Unknown billing type "${providerCfg.billing}" for provider "${provider}"`);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
