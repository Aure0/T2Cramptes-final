export interface GtfsFreshnessStatus {
  isStale: boolean;
  ageDays: number;
  thresholdDays: number;
}

export const DEFAULT_GTFS_STALE_THRESHOLD_DAYS = 35;
const MS_PER_DAY = 86_400_000;

/**
 * Evaluates whether the bundled/cached static GTFS network topology is older than
 * `thresholdDays` (default 35 days) so users know when a topology rebuild is due.
 */
export function evaluateGtfsFreshness(
  loadedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
  thresholdDays: number = DEFAULT_GTFS_STALE_THRESHOLD_DAYS
): GtfsFreshnessStatus {
  if (typeof loadedAtMs !== 'number' || !Number.isFinite(loadedAtMs) || loadedAtMs <= 0) {
    return { isStale: false, ageDays: 0, thresholdDays };
  }
  const ageDays = Math.max(0, Math.floor((nowMs - loadedAtMs) / MS_PER_DAY));
  return {
    isStale: ageDays >= thresholdDays,
    ageDays,
    thresholdDays,
  };
}
