import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classifier.js';

test('trivial fix classifies as LOW', () => {
  const { tier } = classify('fix a typo in the README, change "recieve" to "receive"');
  assert.equal(tier, 'LOW');
});

test('debugging with a stack trace and a few files classifies as MEDIUM', () => {
  const { tier } = classify(
    'Getting this exception intermittently in prod, need root cause: Traceback (most recent call last): File app.py line 42, in handler ConnectionResetError',
    { filesReferenced: 3 }
  );
  assert.equal(tier, 'MEDIUM');
});

test('multi-file architecture redesign classifies as HIGH', () => {
  const { tier } = classify(
    'Redesign the payment service architecture to support multi-region active-active with eventual consistency, refactor across the entire codebase, must be highly scalable and handle race conditions in the ledger',
    { filesReferenced: 12 }
  );
  assert.equal(tier, 'HIGH');
});

test('empty prompt does not throw and defaults to LOW', () => {
  const { tier, score } = classify('');
  assert.equal(tier, 'LOW');
  assert.ok(score >= 0);
});

test('large attached context alone can push a short prompt above LOW', () => {
  const bigContext = 'x'.repeat(25000);
  const { tier } = classify('review this', { contextChars: bigContext.length });
  assert.notEqual(tier, 'LOW');
});

test('score is always clamped between 0 and 100', () => {
  const longSpammy = 'refactor architecture migrate redesign '.repeat(20);
  const { score } = classify(longSpammy, { filesReferenced: 50, contextChars: 100000 });
  assert.ok(score >= 0 && score <= 100);
});
