import type { LatLngPoint, RouteTier } from '../types/transit';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6371000;

/**
 * Haversine distance in meters between two WGS84 coordinates.
 */
export function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compass bearing in degrees [0, 360) from point A to point B (0 = North, 90 = East).
 */
export function calculateBearing(a: LatLngPoint, b: LatLngPoint): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const raw = Math.atan2(y, x) * RAD_TO_DEG;
  return (raw + 360) % 360;
}

export interface PreparedPolylinePath {
  path: LatLngPoint[];
  cumDist: Float64Array;
  segBearings: Float32Array;
  totalLength: number;
}

const preparedPathCache = new WeakMap<LatLngPoint[], PreparedPolylinePath>();

/**
 * Precomputes cumulative Haversine distances and compass bearings for a segment polyline
 * so 30fps vehicle interpolation performs zero trig and zero heap allocations per frame.
 * Results are cached per path array identity via WeakMap.
 */
export function preparePolylinePath(path: LatLngPoint[]): PreparedPolylinePath {
  const cached = preparedPathCache.get(path);
  if (cached) return cached;

  const n = path.length;
  if (n < 2) {
    const empty: PreparedPolylinePath = {
      path,
      cumDist: new Float64Array(n),
      segBearings: new Float32Array(0),
      totalLength: 0,
    };
    preparedPathCache.set(path, empty);
    return empty;
  }

  const cumDist = new Float64Array(n);
  const segBearings = new Float32Array(n - 1);
  let total = 0;

  for (let i = 0; i < n - 1; i++) {
    total += haversineMeters(path[i], path[i + 1]);
    cumDist[i + 1] = total;
    segBearings[i] = calculateBearing(path[i], path[i + 1]);
  }

  const prepared: PreparedPolylinePath = {
    path,
    cumDist,
    segBearings,
    totalLength: total,
  };
  preparedPathCache.set(path, prepared);
  return prepared;
}

function sampleCoordAtDistance(
  prepared: PreparedPolylinePath,
  targetDist: number,
  out: { lat: number; lng: number }
): void {
  const { path, cumDist, totalLength } = prepared;
  const n = path.length;
  if (targetDist <= 0) {
    out.lat = path[0].lat;
    out.lng = path[0].lng;
    return;
  }
  if (targetDist >= totalLength) {
    out.lat = path[n - 1].lat;
    out.lng = path[n - 1].lng;
    return;
  }

  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumDist[mid + 1] < targetDist) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const segStartDist = cumDist[lo];
  const segLen = cumDist[lo + 1] - segStartDist;
  const localT = segLen > 0 ? Math.max(0, Math.min(1, (targetDist - segStartDist) / segLen)) : 0;
  const start = path[lo];
  const end = path[lo + 1];
  out.lat = start.lat + (end.lat - start.lat) * localT;
  out.lng = start.lng + (end.lng - start.lng) * localT;
}

const lookBehindScratch = { lat: 0, lng: 0 };
const lookAheadScratch = { lat: 0, lng: 0 };

/**
 * Zero-allocation variant of samplePreparedPath for 30fps vehicle animation loops.
 * Writes directly into the caller-supplied `out` object to avoid per-frame GC pressure.
 * Uses a smooth look-ahead tangent window along the polyline (~22m span) so vehicle
 * directional arrows stay aligned with the street and immune to tiny vertex quantization noise.
 */
export function samplePreparedPathInto(
  prepared: PreparedPolylinePath,
  rawProgress: number,
  out: { lat: number; lng: number; bearing: number }
): void {
  const { path, segBearings, totalLength } = prepared;
  const n = path.length;
  if (n === 0) {
    out.lat = 45.7772;
    out.lng = 3.087;
    out.bearing = 0;
    return;
  }
  if (n === 1) {
    out.lat = path[0].lat;
    out.lng = path[0].lng;
    out.bearing = 0;
    return;
  }
  if (totalLength < 0.01) {
    out.lat = path[n - 1].lat;
    out.lng = path[n - 1].lng;
    out.bearing = calculateBearing(path[0], path[n - 1]);
    return;
  }

  const t = rawProgress <= 0 ? 0 : rawProgress >= 1 ? 1 : rawProgress;
  const targetDist = totalLength * t;

  if (t === 0) {
    out.lat = path[0].lat;
    out.lng = path[0].lng;
  } else if (t === 1) {
    out.lat = path[n - 1].lat;
    out.lng = path[n - 1].lng;
  } else {
    sampleCoordAtDistance(prepared, targetDist, out);
  }

  // Smooth look-ahead tangent bearing along the polyline
  let dBehind = Math.max(0, targetDist - 8);
  let dAhead = Math.min(totalLength, targetDist + 14);
  if (dAhead - dBehind < 4) {
    dBehind = 0;
    dAhead = totalLength;
  }
  if (dAhead - dBehind >= 0.5) {
    sampleCoordAtDistance(prepared, dBehind, lookBehindScratch);
    sampleCoordAtDistance(prepared, dAhead, lookAheadScratch);
    out.bearing = calculateBearing(lookBehindScratch, lookAheadScratch);
  } else {
    out.bearing = t >= 1 ? segBearings[n - 2] : segBearings[0];
  }
}

/**
 * Fast O(log N) zero-trig interpolation along a precomputed polyline path.
 */
export function samplePreparedPath(
  prepared: PreparedPolylinePath,
  rawProgress: number
): { position: LatLngPoint; bearing: number } {
  const out = { lat: 0, lng: 0, bearing: 0 };
  samplePreparedPathInto(prepared, rawProgress, out);
  return {
    position: { lat: out.lat, lng: out.lng },
    bearing: out.bearing,
  };
}

/**
 * Smoothly interpolates position and bearing along a polyline path for fraction t in [0, 1].
 */
export function interpolateAlongPath(
  path: LatLngPoint[],
  rawProgress: number
): { position: LatLngPoint; bearing: number } {
  return samplePreparedPath(preparePolylinePath(path), rawProgress);
}

/**
 * Computes current progress fraction [0, 1] between departure and arrival timestamps.
 */
export function computeSegmentProgress(
  nowSeconds: number,
  prevDepTime: number,
  nextArrTime: number
): number {
  const duration = nextArrTime - prevDepTime;
  if (duration <= 0) {
    return nowSeconds >= nextArrTime ? 1 : 0;
  }
  return Math.max(0, Math.min(1, (nowSeconds - prevDepTime) / duration));
}

/**
 * Finds the nearest vertex index on a polyline to a target coordinate.
 * Uses fast local equirectangular squared-distance inside the loop and exact Haversine once
 * on the winning vertex (~6x faster during GTFS-RT live vehicle snapping).
 */
export function findNearestPointIndex(
  shape: LatLngPoint[],
  target: LatLngPoint,
  minIndex = 0
): { index: number; distanceMeters: number } {
  const start = Math.max(0, minIndex);
  if (start >= shape.length) {
    return { index: start, distanceMeters: Infinity };
  }

  const cosLat = Math.cos(target.lat * DEG_TO_RAD);
  const tLat = target.lat;
  const tLng = target.lng;
  let bestIdx = start;
  let bestSq = Infinity;

  for (let i = start; i < shape.length; i++) {
    const dLat = shape[i].lat - tLat;
    const dLng = (shape[i].lng - tLng) * cosLat;
    const sq = dLat * dLat + dLng * dLng;
    if (sq < bestSq) {
      bestSq = sq;
      bestIdx = i;
    }
  }

  return {
    index: bestIdx,
    distanceMeters: haversineMeters(shape[bestIdx], target),
  };
}

export interface PolylineProjection {
  point: LatLngPoint;
  segmentIndex: number;
  t: number;
  alongMeters: number;
  distanceMeters: number;
}

/**
 * Projects a target point perpendicularly onto every segment of a polyline (never vertex-only),
 * returning the exact closest point ON the polyline with cumulative distance >= minAlongMeters.
 * Eliminates backward vertex snapping on long simplified straight segments.
 */
export function projectPointOntoPolyline(
  shape: LatLngPoint[],
  target: LatLngPoint,
  minAlongMeters = 0
): PolylineProjection | null {
  if (shape.length < 2) return null;
  const prepared = preparePolylinePath(shape);
  const { cumDist } = prepared;
  const cosLat = Math.cos(target.lat * DEG_TO_RAD);
  const tx = target.lng * cosLat;
  const ty = target.lat;

  let bestSq = Infinity;
  let bestSeg = -1;
  let bestT = 0;
  let bestAlong = 0;
  let bestLat = shape[0].lat;
  let bestLng = shape[0].lng;

  for (let i = 0; i < shape.length - 1; i++) {
    const segStartAlong = cumDist[i];
    const segEndAlong = cumDist[i + 1];
    if (segEndAlong + 1e-6 < minAlongMeters) continue;

    const a = shape[i];
    const b = shape[i + 1];
    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = lenSq > 0 ? ((tx - ax) * dx + (ty - ay) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const segLen = segEndAlong - segStartAlong;
    if (minAlongMeters > segStartAlong && segLen > 0) {
      const minT = Math.min(1, (minAlongMeters - segStartAlong) / segLen);
      if (t < minT) t = minT;
    }

    const px = ax + dx * t;
    const py = ay + dy * t;
    const ex = tx - px;
    const ey = ty - py;
    const sq = ex * ex + ey * ey;

    if (sq < bestSq) {
      bestSq = sq;
      bestSeg = i;
      bestT = t;
      bestAlong = segStartAlong + segLen * t;
      bestLat = a.lat + (b.lat - a.lat) * t;
      bestLng = a.lng + (b.lng - a.lng) * t;
    }
  }

  if (bestSeg < 0) return null;
  const point = { lat: bestLat, lng: bestLng };
  return {
    point,
    segmentIndex: bestSeg,
    t: bestT,
    alongMeters: bestAlong,
    distanceMeters: haversineMeters(point, target),
  };
}

function findCandidateProjections(
  shape: LatLngPoint[],
  target: LatLngPoint,
  maxDistMeters: number
): PolylineProjection[] {
  if (shape.length < 2) return [];
  const prepared = preparePolylinePath(shape);
  const { cumDist } = prepared;
  const cosLat = Math.cos(target.lat * DEG_TO_RAD);
  const tx = target.lng * cosLat;
  const ty = target.lat;
  // Rough squared degree threshold with 20% headroom before exact Haversine check
  const maxDeg = (maxDistMeters * 1.2) / 111000;
  const maxDegSq = maxDeg * maxDeg;

  const hits: PolylineProjection[] = [];
  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i];
    const b = shape[i + 1];
    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = lenSq > 0 ? ((tx - ax) * dx + (ty - ay) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const px = ax + dx * t;
    const py = ay + dy * t;
    const ex = tx - px;
    const ey = ty - py;
    const sq = ex * ex + ey * ey;
    if (sq > maxDegSq) continue;

    const point = {
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    };
    const distM = haversineMeters(point, target);
    if (distM > maxDistMeters) continue;

    const alongMeters = cumDist[i] + (cumDist[i + 1] - cumDist[i]) * t;
    const prev = hits[hits.length - 1];
    if (prev && alongMeters - prev.alongMeters < 90) {
      if (distM < prev.distanceMeters) {
        hits[hits.length - 1] = {
          point,
          segmentIndex: i,
          t,
          alongMeters,
          distanceMeters: distM,
        };
      }
    } else {
      hits.push({
        point,
        segmentIndex: i,
        t,
        alongMeters,
        distanceMeters: distM,
      });
    }
  }
  return hits;
}

function buildSlicedSubPolyline(
  shape: LatLngPoint[],
  start: PolylineProjection,
  end: PolylineProjection
): LatLngPoint[] {
  const result: LatLngPoint[] = [start.point];
  for (let i = start.segmentIndex + 1; i <= end.segmentIndex; i++) {
    const pt = shape[i];
    const prev = result[result.length - 1];
    if (haversineMeters(prev, pt) >= 0.6) {
      result.push(pt);
    }
  }
  if (haversineMeters(result[result.length - 1], end.point) >= 0.6) {
    result.push(end.point);
  }
  if (result.length < 2) {
    return [start.point, end.point];
  }
  return result;
}

export interface SlicedSegmentResult {
  path: LatLngPoint[];
  matched: boolean;
  errorMeters: number;
  lengthMeters: number;
  reversed: boolean;
}

/**
 * Extracts the exact on-shape polyline between two consecutive stops using perpendicular
 * segment projection. Guarantees strictly forward travel ON the route line with zero
 * backward vertex snapping or straight-line building cuts on long straight streets.
 */
export function sliceShapeBetweenStopsDetailed(
  shape: LatLngPoint[] | undefined,
  fromStop: LatLngPoint,
  toStop: LatLngPoint,
  options?: { maxSnapDistMeters?: number; allowReverse?: boolean }
): SlicedSegmentResult {
  const directDist = haversineMeters(fromStop, toStop);
  if (!shape || shape.length < 2) {
    return {
      path: [fromStop, toStop],
      matched: false,
      errorMeters: Infinity,
      lengthMeters: directDist,
      reversed: false,
    };
  }

  const maxSnapDist = options?.maxSnapDistMeters ?? 110;
  const maxAllowedLength = Math.max(directDist * 4.5, directDist + 450, 120);

  const tryForward = (
    a: LatLngPoint,
    b: LatLngPoint
  ): {
    start: PolylineProjection;
    end: PolylineProjection;
    sliceDist: number;
    score: number;
  } | null => {
    const starts = findCandidateProjections(shape, a, maxSnapDist);
    if (starts.length === 0) return null;

    let best: {
      start: PolylineProjection;
      end: PolylineProjection;
      sliceDist: number;
      score: number;
    } | null = null;

    for (const start of starts) {
      const end = projectPointOntoPolyline(shape, b, start.alongMeters + 1);
      if (!end || end.distanceMeters > maxSnapDist) continue;
      const sliceDist = end.alongMeters - start.alongMeters;
      if (sliceDist < 1 || sliceDist > maxAllowedLength) continue;
      // Reject degenerate match where endpoints barely move relative to direct distance
      if (directDist > 40 && sliceDist < directDist * 0.45) continue;

      const err = start.distanceMeters + end.distanceMeters;
      const score = err + sliceDist * 0.012;
      if (!best || score < best.score) {
        best = { start, end, sliceDist, score };
      }
    }
    return best;
  };

  const fwd = tryForward(fromStop, toStop);
  const rev = options?.allowReverse ? tryForward(toStop, fromStop) : null;

  if (fwd && (!rev || fwd.score <= rev.score)) {
    const path = buildSlicedSubPolyline(shape, fwd.start, fwd.end);
    return {
      path,
      matched: true,
      errorMeters: (fwd.start.distanceMeters + fwd.end.distanceMeters) / 2,
      lengthMeters: fwd.sliceDist,
      reversed: false,
    };
  }

  if (rev) {
    const path = buildSlicedSubPolyline(shape, rev.start, rev.end).reverse();
    return {
      path,
      matched: true,
      errorMeters: (rev.start.distanceMeters + rev.end.distanceMeters) / 2,
      lengthMeters: rev.sliceDist,
      reversed: true,
    };
  }

  return {
    path: [fromStop, toStop],
    matched: false,
    errorMeters: Infinity,
    lengthMeters: directDist,
    reversed: false,
  };
}

/**
 * Extracts the exact polyline sub-path between two consecutive stops along a GTFS shape.
 * Falls back to a clean straight segment only if either stop is off-shape or reversed.
 */
export function sliceShapeBetweenStops(
  shape: LatLngPoint[] | undefined,
  fromStop: LatLngPoint,
  toStop: LatLngPoint
): LatLngPoint[] {
  return sliceShapeBetweenStopsDetailed(shape, fromStop, toStop).path;
}

/**
 * Picks the best matching shape across a route's directional variants (preferring exact
 * trip shape first), and optionally snaps onto the route's deduplicated display geometry
 * when both directions share the same two-way street (<= 30m) so vehicles ride 0.0m dead-center
 * on the rendered colored line in BOTH directions.
 */
export function sliceBestShapeBetweenStops(
  directionalCandidates: ReadonlyArray<LatLngPoint[] | undefined>,
  fromStop: LatLngPoint,
  toStop: LatLngPoint,
  displayShapes?: ReadonlyArray<LatLngPoint[]>
): LatLngPoint[] {
  let bestDir: SlicedSegmentResult | null = null;

  for (let i = 0; i < directionalCandidates.length; i++) {
    const cand = directionalCandidates[i];
    if (!cand || cand.length < 2) continue;
    const res = sliceShapeBetweenStopsDetailed(cand, fromStop, toStop, {
      maxSnapDistMeters: 95,
      allowReverse: false,
    });
    if (!res.matched) continue;
    // Slight preference for earlier (exact trip / primary direction) candidate when errors are tied
    const bias = i === 0 ? 0 : 4;
    if (!bestDir || res.errorMeters + bias < bestDir.errorMeters) {
      bestDir = res;
      if (i === 0 && res.errorMeters <= 12) break;
    }
  }

  // If deduplicated display polylines are available, prefer riding the exact rendered colored line
  // whenever it passes within 32m of both stops and matches the true directional route length!
  if (displayShapes && displayShapes.length > 0) {
    let bestDisplay: SlicedSegmentResult | null = null;
    for (const dShape of displayShapes) {
      if (dShape.length < 2) continue;
      const res = sliceShapeBetweenStopsDetailed(dShape, fromStop, toStop, {
        maxSnapDistMeters: 38,
        allowReverse: true,
      });
      if (!res.matched) continue;
      if (bestDir) {
        const lenRatio = res.lengthMeters / Math.max(1, bestDir.lengthMeters);
        if (lenRatio < 0.82 || lenRatio > 1.18) continue;
      }
      if (!bestDisplay || res.errorMeters < bestDisplay.errorMeters) {
        bestDisplay = res;
      }
    }
    if (bestDisplay) {
      return bestDisplay.path;
    }
  }

  if (bestDir) {
    return bestDir.path;
  }

  // Final lenient fallback across any candidate shape (allowing reverse if direction_id mismatched)
  for (const cand of directionalCandidates) {
    if (!cand || cand.length < 2) continue;
    const res = sliceShapeBetweenStopsDetailed(cand, fromStop, toStop, {
      maxSnapDistMeters: 160,
      allowReverse: true,
    });
    if (res.matched) return res.path;
  }

  return [fromStop, toStop];
}

/**
 * Douglas-Peucker polyline simplification (tolerance in degrees, e.g. 0.00004 ~= 4m).
 */
export function simplifyPath(points: LatLngPoint[], tolerance = 0.00004): LatLngPoint[] {
  if (points.length <= 2) return points;

  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxSqDist = 0;
    let index = first;

    for (let i = first + 1; i < last; i++) {
      const sqDist = sqSegmentDistance(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const result: LatLngPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

function sqSegmentDistance(p: LatLngPoint, a: LatLngPoint, b: LatLngPoint): number {
  let x = a.lng;
  let y = a.lat;
  let dx = b.lng - x;
  let dy = b.lat - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.lng - x) * dx + (p.lat - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b.lng;
      y = b.lat;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.lng - x;
  dy = p.lat - y;
  return dx * dx + dy * dy;
}

/**
 * Classifies a T2C route into its InspiRe service tier.
 */
export function classifyT2CRouteTier(shortName: string): RouteTier {
  const upper = shortName.trim().toUpperCase();
  if (upper === 'A' || upper === 'B' || upper === 'C') return 'core';
  if (/^E\d+$/.test(upper)) return 'essential';
  if (/^S\d+$/.test(upper)) return 'secondary';
  if (/^P\d+$/.test(upper) || upper === 'C.BEN') return 'local';
  return 'other';
}

/**
 * Formats an arrival countdown in clean transit-board language.
 */
export function formatEtaCountdown(
  arrivalEpochSec: number,
  nowEpochSec: number,
  locale: 'en' | 'fr' = 'en'
): string {
  const diffSec = Math.round(arrivalEpochSec - nowEpochSec);
  if (diffSec <= 45) return locale === 'fr' ? 'Proche' : 'Due';
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (locale === 'fr') {
    return rem === 0 ? `${hrs} h` : `${hrs} h ${String(rem).padStart(2, '0')}`;
  }
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

/**
 * Formats schedule adherence with both status tone and human-readable label (never color-only).
 */
export function formatDelayStatus(
  delaySeconds: number,
  locale: 'en' | 'fr' = 'en'
): {
  label: string;
  tone: 'ontime' | 'delayed' | 'early';
} {
  if (delaySeconds >= 90) {
    const mins = Math.round(delaySeconds / 60);
    return {
      label: locale === 'fr' ? `+${mins} min retard` : `+${mins} min late`,
      tone: 'delayed',
    };
  }
  if (delaySeconds <= -90) {
    const mins = Math.round(Math.abs(delaySeconds) / 60);
    return {
      label: locale === 'fr' ? `${mins} min avance` : `${mins} min early`,
      tone: 'early',
    };
  }
  return { label: locale === 'fr' ? 'À l’heure' : 'On time', tone: 'ontime' };
}

const PARIS_CLOCK_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const PARIS_CLOCK_HMS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Formats a Unix epoch timestamp into Clermont-Ferrand local time (Europe/Paris HH:MM).
 */
export function formatParisClock(epochSeconds: number, includeSeconds = false): string {
  const date = new Date(epochSeconds * 1000);
  return (includeSeconds ? PARIS_CLOCK_HMS : PARIS_CLOCK_HM).format(date);
}

/**
 * Official Clermont Auvergne Métropole & T2C GTFS municipality prefixes, sorted longest-first
 * so compound names (e.g. "Pérignat-lès-Sarliève", "Cournon-d'Auvergne") match before shorter tokens.
 */
const T2C_COMMUNE_CANONICAL_PREFIXES: ReadonlyArray<{ pattern: RegExp; canonical: string }> = [
  { pattern: /^Saint[-\s]Gen[eè]s[-\s]Champanelle\b/i, canonical: 'saint-genes-champanelle' },
  { pattern: /^P[eé]rignat[-\s]l[eè]s[-\s]Sarli[eè]ve\b/i, canonical: 'perignat-les-sarlieve' },
  { pattern: /^Les\s+Martres[-\s]d['’]Arti[eè]re\b/i, canonical: 'les-martres-d-artiere' },
  { pattern: /^P[eé]rignat[-\s](?:sur|[eè]s)[-\s]Allier\b/i, canonical: 'perignat-sur-allier' },
  { pattern: /^Cournon[-\s]d['’]Auvergne\b/i, canonical: 'cournon-d-auvergne' },
  { pattern: /^Clermont[-\s]Ferrand\b/i, canonical: 'clermont-ferrand' },
  { pattern: /^Clermont[-\s]Fd\b/i, canonical: 'clermont-ferrand' },
  { pattern: /^Pont[-\s]du[-\s]Ch[aâ]teau\b/i, canonical: 'pont-du-chateau' },
  { pattern: /^Saint[-\s]Beauzire\b/i, canonical: 'saint-beauzire' },
  { pattern: /^Mur[-\s]sur[-\s]Allier\b/i, canonical: 'mur-sur-allier' },
  { pattern: /^Saint[-\s]Ours\b/i, canonical: 'saint-ours' },
  { pattern: /^Chamali[eè]res\b/i, canonical: 'chamalieres' },
  { pattern: /^Ch[aâ]teaugay\b/i, canonical: 'chateaugay' },
  { pattern: /^Le\s+Cendre\b/i, canonical: 'le-cendre' },
  { pattern: /^Malintrat\b/i, canonical: 'malintrat' },
  { pattern: /^Romagnat\b/i, canonical: 'romagnat' },
  { pattern: /^Beaumont\b/i, canonical: 'beaumont' },
  { pattern: /^Nohanent\b/i, canonical: 'nohanent' },
  { pattern: /^Chanonat\b/i, canonical: 'chanonat' },
  { pattern: /^Aubi[eè]re\b/i, canonical: 'aubiere' },
  { pattern: /^C[eé]bazat\b/i, canonical: 'cebazat' },
  { pattern: /^Orcines\b/i, canonical: 'orcines' },
  { pattern: /^Lempdes\b/i, canonical: 'lempdes' },
  { pattern: /^Blanzat\b/i, canonical: 'blanzat' },
  { pattern: /^Chappes\b/i, canonical: 'chappes' },
  { pattern: /^Ceyrat\b/i, canonical: 'ceyrat' },
  { pattern: /^Aulnat\b/i, canonical: 'aulnat' },
  { pattern: /^Gerzat\b/i, canonical: 'gerzat' },
  { pattern: /^Durtol\b/i, canonical: 'durtol' },
  { pattern: /^Dallet\b/i, canonical: 'dallet' },
  { pattern: /^Royat\b/i, canonical: 'royat' },
  { pattern: /^Sayat\b/i, canonical: 'sayat' },
  { pattern: /^Mezel\b/i, canonical: 'mezel' },
];

function matchLeadingCommune(
  text: string
): { canonical: string; remainder: string } | null {
  for (const entry of T2C_COMMUNE_CANONICAL_PREFIXES) {
    const m = entry.pattern.exec(text);
    if (!m) continue;
    const after = text.slice(m[0].length);
    // Require a whitespace or dash separator so partial words are never truncated
    const sepMatch = /^(?:\s*[-–—]\s*|\s+)/.exec(after);
    if (!sepMatch) continue;
    const remainder = after.slice(sepMatch[0].length).trim();
    if (!remainder) return null;
    return { canonical: entry.canonical, remainder };
  }
  return null;
}

/**
 * Strips leading T2C municipality prefixes (e.g. "Clermont-Ferrand Bibliothèque de l'Hôtel Dieu"
 * -> "Bibliothèque de l'Hôtel Dieu", "Cournon-d'Auvergne Alouettes" -> "Alouettes").
 * Also removes a redundant immediate repetition of the exact same commune (e.g.
 * "Aubière AUBIÈRE Pl. des Ramacles" -> "Pl. des Ramacles"), while preserving distinct secondary
 * place names (e.g. "Chamalières ROYAT Pl. Allard" -> "ROYAT Pl. Allard").
 */
export function formatShortStationLabel(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return fullName;

  const first = matchLeadingCommune(trimmed);
  if (!first) return trimmed;

  const second = matchLeadingCommune(first.remainder);
  if (second && second.canonical === first.canonical) {
    return second.remainder;
  }

  return first.remainder;
}

export interface LiveFeedClockResolution {
  serverNowSeconds: number;
  feedAgeSec: number;
  feedStatus: 'live' | 'stale' | 'degraded';
  calibratedFromFeed: boolean;
}

/**
 * Resolves the effective clock and staleness status for browser-decoded GTFS-RT feeds.
 * Preserves genuine upstream staleness (120s..3600s behind wall clock) while safely falling
 * back to the feed timestamp if the user's device clock is clearly misconfigured (ahead/behind
 * by > 1 hour, or lagging > 90s behind the feed's own publication timestamp).
 */
export function resolveLiveFeedClock(
  clientNowSeconds: number,
  rawFeedTimestamp: number | null | undefined
): LiveFeedClockResolution {
  const feedTimestamp =
    typeof rawFeedTimestamp === 'number' && rawFeedTimestamp > 0
      ? rawFeedTimestamp
      : clientNowSeconds;
  const clockSkewSec = clientNowSeconds - feedTimestamp;
  const deviceClockBroken = clockSkewSec < -90 || clockSkewSec > 3600;

  if (deviceClockBroken) {
    return {
      serverNowSeconds: feedTimestamp,
      feedAgeSec: 0,
      feedStatus: 'live',
      calibratedFromFeed: true,
    };
  }

  const feedAgeSec = Math.max(0, clockSkewSec);
  const feedStatus: 'live' | 'stale' | 'degraded' =
    feedAgeSec <= 300 ? 'live' : feedAgeSec <= 1800 ? 'stale' : 'degraded';

  return {
    serverNowSeconds: clientNowSeconds,
    feedAgeSec,
    feedStatus,
    calibratedFromFeed: false,
  };
}

/**
 * Normalizes text for fast accent-, hyphen-, and apostrophe-insensitive French transit search
 * (e.g. "cebazat" matches "CÉBAZAT", "hotel dieu" matches "Hôtel-Dieu", "pont du chateau" matches "Pont-du-Château").
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
