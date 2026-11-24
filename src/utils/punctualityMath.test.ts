import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPunctualityHistory,
  classifyDelayBucket,
  computePunctualityRates,
  formatAvgDelaySeconds,
  normalizePeriod,
} from './punctualityMath';
import type { PunctualityPeriod } from '../types/transit';

test('classifyDelayBucket applies ±90s threshold accurately', () => {
  assert.equal(classifyDelayBucket(-120), 'early');
  assert.equal(classifyDelayBucket(-90), 'early');
  assert.equal(classifyDelayBucket(-89), 'ontime');
  assert.equal(classifyDelayBucket(0), 'ontime');
  assert.equal(classifyDelayBucket(89), 'ontime');
  assert.equal(classifyDelayBucket(90), 'late');
  assert.equal(classifyDelayBucket(240), 'late');
});

test('computePunctualityRates produces percentages summing to 100', () => {
  const rates = computePunctualityRates(2, 15, 3);
  assert.equal(rates.earlyPct, 10);
  assert.equal(rates.latePct, 15);
  assert.equal(rates.onTimePct, 75);
  assert.equal(rates.earlyPct + rates.onTimePct + rates.latePct, 100);

  const empty = computePunctualityRates(0, 0, 0);
  assert.equal(empty.onTimePct, 100);
});

test('buildPunctualityHistory generates valid series for every period and preserves live bucket', () => {
  const now = 1_795_104_000;
  const periods: Array<{ period: PunctualityPeriod; expectedLen: number }> = [
    { period: '6h', expectedLen: 12 },
    { period: '24h', expectedLen: 24 },
    { period: '7d', expectedLen: 7 },
    { period: '30d', expectedLen: 15 },
    { period: 'all', expectedLen: 12 },
  ];

  const liveObs = [
    {
      timestamp: now,
      earlyCount: 4,
      onTimeCount: 12,
      lateCount: 4,
      delaySumSec: 360,
      sampleCount: 20,
    },
  ];

  for (const { period, expectedLen } of periods) {
    const res = buildPunctualityHistory({
      routeId: 'A',
      routeShortName: 'A',
      routeColor: '#A81815',
      routeTextColor: '#FFFFFF',
      routeType: 0,
      period,
      nowEpochSec: now,
      observations: liveObs,
    });

    assert.equal(res.buckets.length, expectedLen, `Period ${period} bucket count`);

    for (const b of res.buckets) {
      assert.ok(b.earlyPct >= 0 && b.earlyPct <= 100);
      assert.ok(b.latePct >= 0 && b.latePct <= 100);
      assert.ok(b.onTimePct >= 0 && b.onTimePct <= 100);
      const sum = Math.round((b.earlyPct + b.onTimePct + b.latePct) * 10) / 10;
      assert.equal(sum, 100, `Bucket ${b.label} sum should be 100, got ${sum}`);
    }

    const latest = res.buckets[res.buckets.length - 1];
    assert.equal(latest.source, 'live');
    assert.equal(latest.earlyPct, 20);
    assert.equal(latest.latePct, 20);
    assert.equal(latest.onTimePct, 60);
    assert.equal(res.summary.liveSampleCount, 20);
  }
});

test('normalizePeriod and formatAvgDelaySeconds handle edge inputs cleanly', () => {
  assert.equal(normalizePeriod('7d'), '7d');
  assert.equal(normalizePeriod('all'), 'all');
  assert.equal(normalizePeriod('invalid'), '24h');
  assert.equal(normalizePeriod(undefined), '24h');

  assert.equal(formatAvgDelaySeconds(5), 'On schedule');
  assert.equal(formatAvgDelaySeconds(42), '+42s');
  assert.equal(formatAvgDelaySeconds(-90), '-1.5 min');
});
