import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGtfsFreshness } from './gtfsFreshness';

const DAY_MS = 86_400_000;

test('evaluateGtfsFreshness marks recent snapshots as fresh and >= 35d snapshots as stale', () => {
  const now = 1_750_000_000_000;
  const fresh = evaluateGtfsFreshness(now - 10 * DAY_MS, now);
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.ageDays, 10);

  const stale = evaluateGtfsFreshness(now - 42 * DAY_MS, now);
  assert.equal(stale.isStale, true);
  assert.equal(stale.ageDays, 42);
});

test('evaluateGtfsFreshness gracefully ignores missing or invalid timestamps', () => {
  assert.equal(evaluateGtfsFreshness(null).isStale, false);
  assert.equal(evaluateGtfsFreshness(undefined).isStale, false);
  assert.equal(evaluateGtfsFreshness(0).isStale, false);
});
