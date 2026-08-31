import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, estimateTokens } from '../src/estimator.js';

const pricingConfig = {
  providers: {
    token_provider: {
      billing: 'token',
      tiers: {
        LOW: { model: 'cheap-model', input_per_mtok: 1, output_per_mtok: 5 },
      },
    },
    multiplier_provider: {
      billing: 'multiplier',
      unit_cost_usd: 0.04,
      tiers: {
        HIGH: { model: 'expensive-model', multiplier: 10 },
      },
    },
  },
  estimation: { chars_per_token: 4, default_output_input_ratio: 2 },
};

test('estimateTokens divides chars by charsPerToken and rounds up, minimum 1', () => {
  assert.equal(estimateTokens('abcd', 4), 1);
  assert.equal(estimateTokens('abcde', 4), 2);
  assert.equal(estimateTokens('', 4), 1);
});

test('token billing computes input + output cost correctly', () => {
  const promptText = 'a'.repeat(4000); // -> 1000 input tokens at 4 chars/token
  const result = estimateCost({ promptText, provider: 'token_provider', tier: 'LOW', pricingConfig });
  // 1000 input tokens @ $1/mtok = $0.001; 2000 output tokens (2x ratio) @ $5/mtok = $0.01
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.outputTokens, 2000);
  assert.equal(result.estimatedCostUsd, 0.011);
  assert.equal(result.billing, 'token');
});

test('multiplier billing computes unit_cost * multiplier regardless of prompt size', () => {
  const result = estimateCost({ promptText: 'short', provider: 'multiplier_provider', tier: 'HIGH', pricingConfig });
  assert.equal(result.estimatedCostUsd, 0.4); // 0.04 * 10
  assert.equal(result.billing, 'multiplier');
});

test('unknown provider throws a clear error, not a crash', () => {
  assert.throws(
    () => estimateCost({ promptText: 'x', provider: 'nope', tier: 'LOW', pricingConfig }),
    /Unknown provider/
  );
});

test('unknown tier for a valid provider throws a clear error', () => {
  assert.throws(
    () => estimateCost({ promptText: 'x', provider: 'token_provider', tier: 'HIGH', pricingConfig }),
    /Unknown tier/
  );
});

test('explicit expectedOutputTokens overrides the default ratio', () => {
  const promptText = 'a'.repeat(4000);
  const result = estimateCost({
    promptText, provider: 'token_provider', tier: 'LOW', pricingConfig, expectedOutputTokens: 500,
  });
  assert.equal(result.outputTokens, 500);
});
