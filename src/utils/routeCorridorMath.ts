import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LatLngPoint, TransitRoute } from '../types/transit';
import {
  haversineMeters,
  projectPointOntoPolyline,
  simplifyPath,
} from './transitMath';

// Local metric equirectangular projection centered on Clermont-Ferrand (45.777°N)
const REF_LAT = 45.7772;
const METERS_PER_LAT = 111320;
const METERS_PER_LNG = 111320 * Math.cos((REF_LAT * Math.PI) / 180);

function toXY(p: LatLngPoint): [number, number] {
  return [p.lng * METERS_PER_LNG, p.lat * METERS_PER_LAT];
}

function pointToSegDistSqXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { distSq: number; projX: number; projY: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = ax + dx * t;
  const projY = ay + dy * t;
  const ex = px - projX;
  const ey = py - projY;
  return { distSq: ex * ex + ey * ey, projX, projY };
}

function cellKey(cx: number, cy: number): number {
  return (cx + 1_000_000) * 2_000_000 + (cy + 1_000_000);
}

interface MetricSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

class SegmentSpatialIndex {
  private readonly cellSize: number;
  private readonly grid = new Map<number, MetricSeg[]>();

  constructor(cellSizeMeters: number) {
    this.cellSize = cellSizeMeters;
  }

  addPolyline(pts: LatLngPoint[]): void {
    const inv = 1 / this.cellSize;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = toXY(pts[i]);
      const [bx, by] = toXY(pts[i + 1]);
      if (Math.hypot(bx - ax, by - ay) < 0.2) continue;
      const seg: MetricSeg = { ax, ay, bx, by };
      const minCx = Math.floor(Math.min(ax, bx) * inv);
      const maxCx = Math.floor(Math.max(ax, bx) * inv);
      const minCy = Math.floor(Math.min(ay, by) * inv);
      const maxCy = Math.floor(Math.max(ay, by) * inv);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const k = cellKey(cx, cy);
          let bucket = this.grid.get(k);
          if (!bucket) {
            bucket = [];
            this.grid.set(k, bucket);
          }
          bucket.push(seg);
        }
      }
    }
  }

  nearestPoint(
    p: LatLngPoint,
    maxDistMeters: number
  ): { distMeters: number; point: LatLngPoint } | null {
    const [px, py] = toXY(p);
    const inv = 1 / this.cellSize;
    const cx0 = Math.floor(px * inv);
    const cy0 = Math.floor(py * inv);
    const radiusCells = Math.ceil(maxDistMeters * inv);
    const maxSq = maxDistMeters * maxDistMeters;

    let bestSq = maxSq + 1;
    let bestX = px;
    let bestY = py;

    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        const bucket = this.grid.get(cellKey(cx0 + dx, cy0 + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const s = bucket[i];
          const res = pointToSegDistSqXY(px, py, s.ax, s.ay, s.bx, s.by);
          if (res.distSq < bestSq) {
            bestSq = res.distSq;
            bestX = res.projX;
            bestY = res.projY;
          }
        }
      }
    }

    if (bestSq > maxSq) return null;
    return {
      distMeters: Math.sqrt(bestSq),
      point: { lat: bestY / METERS_PER_LAT, lng: bestX / METERS_PER_LNG },
    };
  }
}

function densifyPolyline(pts: LatLngPoint[], maxStepMeters: number): LatLngPoint[] {
  if (pts.length < 2) return pts;
  const out: LatLngPoint[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dist = haversineMeters(a, b);
    if (dist > maxStepMeters) {
      const steps = Math.ceil(dist / maxStepMeters);
      for (let s = 1; s < steps; s++) {
        const f = s / steps;
        out.push({
          lat: a.lat + (b.lat - a.lat) * f,
          lng: a.lng + (b.lng - a.lng) * f,
        });
      }
    }
    out.push(b);
  }
  return out;
}

function polylineLengthMeters(pts: LatLngPoint[]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += haversineMeters(pts[i], pts[i + 1]);
  }
  return total;
}

/**
 * Deduplicates overlapping outbound/inbound shapes and short-turn variants of a SINGLE route
 * into a minimal, complete set of display polylines:
 * - Two-way streets (outbound & inbound within `mergeThresholdMeters`, default 28m) collapse
 *   into ONE clean line, decluttering the map.
 * - Distinct branches (e.g. Line C Studio 120 / L'Arche) and genuine one-way couplets (> 28m)
 *   are preserved and smoothly bridged onto the main trunk with zero visual gaps.
 */
export function deduplicateRouteShapes(
  rawShapes: ReadonlyArray<LatLngPoint[]>,
  mergeThresholdMeters = 28,
  minBranchLengthMeters = 55
): LatLngPoint[][] {
  const valid = rawShapes
    .filter((s) => s.length >= 2)
    .map((s) => simplifyPath(s, 0.000025))
    .filter((s) => s.length >= 2)
    .sort((a, b) => polylineLengthMeters(b) - polylineLengthMeters(a));

  if (valid.length === 0) return [];

  const accepted: LatLngPoint[][] = [valid[0]];
  const index = new SegmentSpatialIndex(Math.max(30, mergeThresholdMeters));
  index.addPolyline(valid[0]);

  for (let sIdx = 1; sIdx < valid.length; sIdx++) {
    const dense = densifyPolyline(valid[sIdx], 22);
    const covered = new Uint8Array(dense.length);
    for (let i = 0; i < dense.length; i++) {
      covered[i] = index.nearestPoint(dense[i], mergeThresholdMeters) ? 1 : 0;
    }

    // Extract contiguous uncovered runs (genuine one-way legs or alternate branches)
    let i = 0;
    while (i < dense.length) {
      if (covered[i]) {
        i++;
        continue;
      }
      const start = i;
      while (i < dense.length && !covered[i]) i++;
      const end = i - 1;

      const rawRun = dense.slice(start, end + 1);
      if (rawRun.length < 2) continue;

      // Bridge seamlessly to the existing trunk at start/end transitions
      const bridged: LatLngPoint[] = [];
      if (start > 0) {
        const anchor = index.nearestPoint(dense[start - 1], mergeThresholdMeters * 1.4);
        bridged.push(anchor ? anchor.point : dense[start - 1]);
      }
      for (const pt of rawRun) bridged.push(pt);
      if (end + 1 < dense.length) {
        const anchor = index.nearestPoint(dense[end + 1], mergeThresholdMeters * 1.4);
        bridged.push(anchor ? anchor.point : dense[end + 1]);
      }

      if (polylineLengthMeters(bridged) < minBranchLengthMeters) continue;

      const simplified = simplifyPath(bridged, 0.000025);
      if (simplified.length >= 2) {
        accepted.push(simplified);
        index.addPolyline(simplified);
      }
    }
  }

  return accepted;
}

export interface RawPlatformForClustering {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  wheelchair: boolean;
  routeIds: string[];
  hasTram: boolean;
}

export interface ClusteredStationSpec {
  id: string;
  name: string;
  lat: number;
  lng: number;
  wheelchairAccessible: boolean;
  routeIds: string[];
  platformIds: string[];
  mode: 'tram' | 'bus' | 'mixed';
}

function sameRouteSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function greedySpatialClusters(
  items: RawPlatformForClustering[],
  diffRoutesRadiusMeters: number,
  sameRoutesRadiusMeters: number
): RawPlatformForClustering[][] {
  const clusters: Array<{
    members: RawPlatformForClustering[];
    sumLat: number;
    sumLng: number;
    sortedRoutes: string[];
  }> = [];

  for (const item of items) {
    const itemRoutes = item.routeIds.slice().sort();
    let bestCluster: (typeof clusters)[number] | null = null;
    let bestDist = Infinity;

    for (const c of clusters) {
      const limit = sameRouteSet(itemRoutes, c.sortedRoutes)
        ? sameRoutesRadiusMeters
        : diffRoutesRadiusMeters;
      const center = { lat: c.sumLat / c.members.length, lng: c.sumLng / c.members.length };
      const d = haversineMeters(item, center);
      if (d <= limit && d < bestDist) {
        bestDist = d;
        bestCluster = c;
      }
    }

    if (bestCluster) {
      bestCluster.members.push(item);
      bestCluster.sumLat += item.lat;
      bestCluster.sumLng += item.lng;
    } else {
      clusters.push({
        members: [item],
        sumLat: item.lat,
        sumLng: item.lng,
        sortedRoutes: itemRoutes,
      });
    }
  }

  return clusters.map((c) => c.members);
}

/**
 * Splits a GTFS parent station's platforms into physically accurate fixed station points:
 * - Separates Tramway platforms from Bus/BHNS platforms whenever they are physically distinct
 *   (>= `tramBusSplitMeters`, default 22m — e.g. Jaude Tram vs Jaude Bus/BHNS, Delille, Gaillard, 1er Mai).
 * - Keeps opposite-curb platforms of the same street together (<= `sameModeClusterMeters`, default 60m)
 *   as one clean dot centered on the street, while splitting distant platforms on separate streets.
 * - Snaps each fixed cluster onto its primary route's display polyline when within `snapToRouteMeters`
 *   (default 24m) so colored route lines always pass directly through every stop dot.
 */
export function clusterStationPlatforms(
  parentId: string,
  parentName: string,
  platforms: RawPlatformForClustering[],
  routeShapesById: Map<string, LatLngPoint[][]>,
  routeSortOrderById: Map<string, number>,
  options?: {
    tramBusSplitMeters?: number;
    sameModeClusterMeters?: number;
    snapToRouteMeters?: number;
  }
): ClusteredStationSpec[] {
  const active = platforms.filter((p) => p.routeIds.length > 0);
  if (active.length === 0) return [];

  const tramBusSplitM = options?.tramBusSplitMeters ?? 22;
  const sameModeClusterM = options?.sameModeClusterMeters ?? 60;
  const snapToRouteM = options?.snapToRouteMeters ?? 24;

  const tramPlats = active.filter((p) => p.hasTram);
  const busPlats = active.filter((p) => !p.hasTram);

  let modeGroups: Array<{ mode: 'tram' | 'bus' | 'mixed'; items: RawPlatformForClustering[] }>;

  if (tramPlats.length > 0 && busPlats.length > 0) {
    // Check physical separation between Tram and Bus platforms
    let minCrossDist = Infinity;
    for (const tp of tramPlats) {
      for (const bp of busPlats) {
        const d = haversineMeters(tp, bp);
        if (d < minCrossDist) minCrossDist = d;
      }
    }
    if (minCrossDist >= tramBusSplitM) {
      modeGroups = [
        { mode: 'tram', items: tramPlats },
        { mode: 'bus', items: busPlats },
      ];
    } else {
      modeGroups = [{ mode: 'mixed', items: active }];
    }
  } else if (tramPlats.length > 0) {
    modeGroups = [{ mode: 'tram', items: tramPlats }];
  } else {
    modeGroups = [{ mode: 'bus', items: busPlats }];
  }

  const rawSpecs: Array<{
    mode: 'tram' | 'bus' | 'mixed';
    members: RawPlatformForClustering[];
    routeIds: string[];
  }> = [];

  for (const grp of modeGroups) {
    const spatial = greedySpatialClusters(grp.items, sameModeClusterM, 135);
    for (const members of spatial) {
      const rSet = new Set<string>();
      for (const m of members) {
        for (const rid of m.routeIds) rSet.add(rid);
      }
      const routeIds = Array.from(rSet).sort(
        (a, b) => (routeSortOrderById.get(a) ?? 999) - (routeSortOrderById.get(b) ?? 999)
      );
      rawSpecs.push({ mode: grp.mode, members, routeIds });
    }
  }

  const hasTramBusSplit =
    rawSpecs.some((s) => s.mode === 'tram') && rawSpecs.some((s) => s.mode === 'bus');

  let busIdx = 0;
  let tramIdx = 0;

  return rawSpecs.map((spec) => {
    // Stable deterministic centroid of this physical cluster's platforms
    let sumLat = 0;
    let sumLng = 0;
    let wheelchair = false;
    for (const m of spec.members) {
      sumLat += m.lat;
      sumLng += m.lng;
      if (m.wheelchair) wheelchair = true;
    }
    const centroid: LatLngPoint = {
      lat: sumLat / spec.members.length,
      lng: sumLng / spec.members.length,
    };

    // Snap statically onto the primary route's deduplicated display polyline if within 24m
    // so the colored route line always passes cleanly through the fixed stop dot
    let finalPt = centroid;
    let bestSnapDist = snapToRouteM;
    for (const rid of spec.routeIds) {
      const shapes = routeShapesById.get(rid);
      if (!shapes) continue;
      for (const sh of shapes) {
        const proj = projectPointOntoPolyline(sh, centroid, 0);
        if (proj && proj.distanceMeters <= bestSnapDist) {
          bestSnapDist = proj.distanceMeters;
          finalPt = proj.point;
        }
      }
      // Once snapped closely onto the highest-priority route (lowest sortOrder), stop
      if (bestSnapDist <= 14) break;
    }

    let id = parentId;
    let name = parentName;

    if (rawSpecs.length > 1) {
      if (hasTramBusSplit && spec.mode === 'tram') {
        tramIdx++;
        id = tramIdx === 1 ? `${parentId}__tram` : `${parentId}__tram${tramIdx}`;
        name = tramIdx === 1 ? `${parentName} (Tram)` : `${parentName} (Tram ${tramIdx})`;
      } else if (hasTramBusSplit && spec.mode === 'bus') {
        busIdx++;
        id = busIdx === 1 ? `${parentId}__bus` : `${parentId}__bus${busIdx}`;
        name = busIdx === 1 ? `${parentName} (Bus)` : `${parentName} (Bus ${busIdx})`;
      } else {
        busIdx++;
        id = busIdx === 1 ? parentId : `${parentId}__q${busIdx}`;
        name = parentName;
      }
    }

    return {
      id,
      name,
      lat: Number(finalPt.lat.toFixed(6)),
      lng: Number(finalPt.lng.toFixed(6)),
      wheelchairAccessible: wheelchair,
      routeIds: spec.routeIds,
      platformIds: spec.members.map((m) => m.stopId),
      mode: spec.mode,
    };
  });
}

interface MicroSegment {
  routeIdx: number;
  routeId: string;
  sortOrder: number;
  polyIdx: number;
  segIdx: number;
  a: LatLngPoint;
  b: LatLngPoint;
  mx: number;
  my: number;
  ux: number; // unit tangent x
  uy: number; // unit tangent y
  lenM: number;
}

export interface StackedCorridorOptions {
  focusedRouteId: string | null;
  showDensity: boolean;
  corridorMatchMeters?: number;
  maxAngleDiffDeg?: number;
}

/**
 * Builds parallel-stacked GeoJSON route features for MapLibre GL `line-offset` rendering:
 * - Solo stretches stay centered at `offsetSlot = 0`.
 * - Shared corridors where N >= 2 enabled routes run along the same street assign centered
 *   parallel slots `rank - (N - 1) / 2` ordered deterministically by `route.sortOrder`.
 * - Uses reference-route dot-product tangent alignment (comparing each co-running route against
 *   the lowest-`sortOrder` route in that corridor) so routes digitized in opposite directions
 *   NEVER overlap or flip across North/South curves!
 */
export function buildStackedCorridorFeatures(
  visibleRoutes: ReadonlyArray<TransitRoute>,
  options: StackedCorridorOptions
): FeatureCollection<LineString> {
  if (visibleRoutes.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  // Deterministic corridor ordering: Tram A -> BHNS B -> BHNS C -> E1..E7 -> S10.. -> P30..
  const orderedRoutes = visibleRoutes
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.shortName.localeCompare(b.shortName));

  const corridorMatchM = options.corridorMatchMeters ?? 26;
  const cosMaxAngle = Math.cos(((options.maxAngleDiffDeg ?? 34) * Math.PI) / 180);
  const cellSize = Math.max(30, corridorMatchM + 4);
  const invCell = 1 / cellSize;

  // Step 1: Break each route's deduplicated polylines into ~38m micro-segments and index spatially
  const perRoutePolys: MicroSegment[][][] = [];
  const grid = new Map<number, MicroSegment[]>();

  for (let rIdx = 0; rIdx < orderedRoutes.length; rIdx++) {
    const route = orderedRoutes[rIdx];
    const polysOut: MicroSegment[][] = [];

    for (let pIdx = 0; pIdx < route.shapes.length; pIdx++) {
      const raw = route.shapes[pIdx];
      if (raw.length < 2) continue;
      const dense = densifyPolyline(raw, 38);
      const segs: MicroSegment[] = [];

      for (let i = 0; i < dense.length - 1; i++) {
        const a = dense[i];
        const b = dense[i + 1];
        const [ax, ay] = toXY(a);
        const [bx, by] = toXY(b);
        const dx = bx - ax;
        const dy = by - ay;
        const lenM = Math.hypot(dx, dy);
        if (lenM < 0.8) continue;

        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;
        const seg: MicroSegment = {
          routeIdx: rIdx,
          routeId: route.id,
          sortOrder: route.sortOrder,
          polyIdx: pIdx,
          segIdx: segs.length,
          a,
          b,
          mx,
          my,
          ux: dx / lenM,
          uy: dy / lenM,
          lenM,
        };
        segs.push(seg);

        const cx = Math.floor(mx * invCell);
        const cy = Math.floor(my * invCell);
        const k = cellKey(cx, cy);
        let bucket = grid.get(k);
        if (!bucket) {
          bucket = [];
          grid.set(k, bucket);
        }
        bucket.push(seg);
      }

      if (segs.length > 0) {
        polysOut.push(segs);
      }
    }

    perRoutePolys.push(polysOut);
  }

  // Step 2: For every micro-segment, detect all parallel co-running routes in the 3x3 cell window
  const matchSq = corridorMatchM * corridorMatchM;
  const features: Feature<LineString>[] = [];

  // Emit in reverse sortOrder so higher-priority routes (A, B, C) still paint slightly crisp at junctions
  for (let rIdx = orderedRoutes.length - 1; rIdx >= 0; rIdx--) {
    const route = orderedRoutes[rIdx];
    const isCore = route.tier === 'core';
    const isFocused = options.focusedRouteId === null || options.focusedRouteId === route.id;
    const baseWeight = isCore ? 4.0 : 2.8;
    const rawCoreOpacity = isFocused ? (isCore ? 0.95 : 0.84) : 0.25;
    const rawCasingOpacity = isFocused ? 0.82 : 0.16;
    const coreOpacity = options.showDensity ? rawCoreOpacity * 0.65 : rawCoreOpacity;
    const casingOpacity = options.showDensity ? rawCasingOpacity * 0.6 : rawCasingOpacity;

    const polys = perRoutePolys[rIdx];
    for (let pIdx = 0; pIdx < polys.length; pIdx++) {
      const segs = polys[pIdx];
      const slots = new Float32Array(segs.length);

      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const cx0 = Math.floor(s.mx * invCell);
        const cy0 = Math.floor(s.my * invCell);

        // Track best matching neighbor per distinct routeIdx
        const coRoutes = new Map<number, { distSq: number; seg: MicroSegment }>();
        coRoutes.set(rIdx, { distSq: 0, seg: s });

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = grid.get(cellKey(cx0 + dx, cy0 + dy));
            if (!bucket) continue;
            for (let j = 0; j < bucket.length; j++) {
              const other = bucket[j];
              if (other.routeIdx === rIdx) continue;
              const ox = other.mx - s.mx;
              const oy = other.my - s.my;
              const dSq = ox * ox + oy * oy;
              if (dSq > matchSq) continue;

              // Must run roughly parallel (either same or opposite direction)
              const dot = s.ux * other.ux + s.uy * other.uy;
              if (Math.abs(dot) < cosMaxAngle) continue;

              const prev = coRoutes.get(other.routeIdx);
              if (!prev || dSq < prev.distSq) {
                coRoutes.set(other.routeIdx, { distSq: dSq, seg: other });
              }
            }
          }
        }

        const n = coRoutes.size;
        if (n <= 1) {
          slots[i] = 0;
          continue;
        }

        const sortedIndices = Array.from(coRoutes.keys()).sort((a, b) => a - b);
        const rank = sortedIndices.indexOf(rIdx);
        const refIdx = sortedIndices[0];
        const refSeg = coRoutes.get(refIdx)!.seg;

        // Centered parallel slot; gently compress spacing slightly when >= 5 lines share one street
        const compression = n >= 6 ? 0.78 : n >= 5 ? 0.86 : 1.0;
        const rawSlot = (rank - (n - 1) / 2) * compression;

        // Align sign relative to the reference route's tangent vector -> zero compass flips!
        const sign = refIdx === rIdx || s.ux * refSeg.ux + s.uy * refSeg.uy >= 0 ? 1 : -1;
        // Quantize to quarter-slots for clean feature merging
        slots[i] = Math.round(rawSlot * sign * 4) / 4;
      }

      // Step 3: Smooth isolated 1-segment glitches at oblique street crossings
      if (segs.length >= 3) {
        const smoothed = new Float32Array(slots);
        for (let i = 1; i < segs.length - 1; i++) {
          if (slots[i - 1] === slots[i + 1] && slots[i] !== slots[i - 1]) {
            smoothed[i] = slots[i - 1];
          }
        }
        slots.set(smoothed);
      }

      // Step 4: Merge consecutive segments sharing the same `offsetSlot` into clean LineStrings
      let runStart = 0;
      while (runStart < segs.length) {
        const slot = slots[runStart];
        let runEnd = runStart;
        while (runEnd + 1 < segs.length && slots[runEnd + 1] === slot) {
          runEnd++;
        }

        const coords: [number, number][] = [[segs[runStart].a.lng, segs[runStart].a.lat]];
        for (let k = runStart; k <= runEnd; k++) {
          coords.push([segs[k].b.lng, segs[k].b.lat]);
        }

        features.push({
          type: 'Feature',
          properties: {
            routeId: route.id,
            shortName: route.shortName,
            color: route.color,
            weight: baseWeight,
            casingWeight: baseWeight + 2.2,
            coreOpacity,
            casingOpacity,
            offsetSlot: slot,
          },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        });

        runStart = runEnd + 1;
      }
    }
  }

  return { type: 'FeatureCollection', features };
}
