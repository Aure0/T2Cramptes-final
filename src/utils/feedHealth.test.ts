import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFeedHealth,
  formatRelativeAge,
  STALE_FEED_TIMESTAMP_THRESHOLD_SEC,
  STALE_POLL_THRESHOLD_SEC,
} from './feedHealth';

const BASE_NOW_SEC = 1_760_000_000;
const BASE_NOW_MS = BASE_NOW_SEC * 1000;

test('formatRelativeAge formats seconds, minutes, and hours cleanly', () => {
  assert.equal(formatRelativeAge(null), 'unknown');
  assert.equal(formatRelativeAge(0), 'just now');
  assert.equal(formatRelativeAge(4), 'just now');
  assert.equal(formatRelativeAge(15), '15s ago');
  assert.equal(formatRelativeAge(125), '2m ago');
  assert.equal(formatRelativeAge(3600), '1h ago');
  assert.equal(formatRelativeAge(3900), '1h 5m ago');
});

test('evaluateFeedHealth returns connecting during initial fetch before data arrives', () => {
  const result = evaluateFeedHealth({
    isOnline: true,
    hasData: false,
    serverFeedStatus: null,
    feedTimestampSec: null,
    lastSuccessAtMs: null,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 0,
    lastError: null,
  });

  assert.equal(result.state, 'connecting');
  assert.equal(result.isWarning, false);
  assert.equal(result.severity, 'ok');
});

test('evaluateFeedHealth returns live when feed and poll are fresh', () => {
  const result = evaluateFeedHealth({
    isOnline: true,
    hasData: true,
    serverFeedStatus: 'live',
    feedTimestampSec: BASE_NOW_SEC - 12,
    lastSuccessAtMs: BASE_NOW_MS - 8_000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 0,
    lastError: null,
  });

  assert.equal(result.state, 'live');
  assert.equal(result.isWarning, false);
  assert.equal(result.severity, 'ok');
  assert.equal(result.shortLabel, 'Live');
  assert.equal(result.formattedAge, '12s ago');
});

test('evaluateFeedHealth marks feed stale when poll age or GTFS-RT header age crosses threshold', () => {
  const staleByPoll = evaluateFeedHealth({
    isOnline: true,
    hasData: true,
    serverFeedStatus: 'live',
    feedTimestampSec: BASE_NOW_SEC - 10,
    lastSuccessAtMs: BASE_NOW_MS - (STALE_POLL_THRESHOLD_SEC + 5) * 1000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 0,
    lastError: null,
  });

  assert.equal(staleByPoll.state, 'stale');
  assert.equal(staleByPoll.isWarning, true);
  assert.equal(staleByPoll.severity, 'warning');
  assert.equal(staleByPoll.shortLabel, 'Stale');

  const staleByHeader = evaluateFeedHealth({
    isOnline: true,
    hasData: true,
    serverFeedStatus: 'live',
    feedTimestampSec: BASE_NOW_SEC - (STALE_FEED_TIMESTAMP_THRESHOLD_SEC + 30),
    lastSuccessAtMs: BASE_NOW_MS - 5_000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 0,
    lastError: null,
  });

  assert.equal(staleByHeader.state, 'stale');
  assert.equal(staleByHeader.isWarning, true);
  assert.equal(staleByHeader.formattedAge, '3m ago');
});

test('evaluateFeedHealth escalates from single transient failure (stale) to unreachable', () => {
  const singleFailure = evaluateFeedHealth({
    isOnline: true,
    hasData: true,
    serverFeedStatus: 'live',
    feedTimestampSec: BASE_NOW_SEC - 20,
    lastSuccessAtMs: BASE_NOW_MS - 20_000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 1,
    lastError: 'HTTP 503',
  });

  assert.equal(singleFailure.state, 'stale');
  assert.equal(singleFailure.isWarning, true);

  const repeatedFailure = evaluateFeedHealth({
    isOnline: true,
    hasData: true,
    serverFeedStatus: 'live',
    feedTimestampSec: BASE_NOW_SEC - 65,
    lastSuccessAtMs: BASE_NOW_MS - 65_000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 2,
    lastError: 'HTTP 503',
  });

  assert.equal(repeatedFailure.state, 'unreachable');
  assert.equal(repeatedFailure.isWarning, true);
  assert.equal(repeatedFailure.severity, 'error');
  assert.match(repeatedFailure.detail, /2 failed polls/);
});

test('evaluateFeedHealth flags server degraded status and browser offline as unreachable', () => {
  const serverDegraded = evaluateFeedHealth({
    isOnline: true,
    hasData: true,
    serverFeedStatus: 'degraded',
    feedTimestampSec: BASE_NOW_SEC - 400,
    lastSuccessAtMs: BASE_NOW_MS - 5_000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 0,
    lastError: null,
  });

  assert.equal(serverDegraded.state, 'unreachable');
  assert.equal(serverDegraded.isWarning, true);
  assert.equal(serverDegraded.shortLabel, 'Unreachable');

  const browserOffline = evaluateFeedHealth({
    isOnline: false,
    hasData: true,
    serverFeedStatus: 'live',
    feedTimestampSec: BASE_NOW_SEC - 30,
    lastSuccessAtMs: BASE_NOW_MS - 30_000,
    nowMs: BASE_NOW_MS,
    nowEpochSec: BASE_NOW_SEC,
    consecutiveFailures: 0,
    lastError: null,
  });

  assert.equal(browserOffline.state, 'unreachable');
  assert.equal(browserOffline.shortLabel, 'Offline');
  assert.equal(browserOffline.isWarning, true);
});
