import type { LatLngPoint, LiveVehicle, TransitStation } from '../types/transit';
import { formatShortStationLabel, haversineMeters } from './transitMath';

export type DensityMetricMode = 'congestion' | 'volume';
export type DensityScope = 'network' | 'active-lines';

export interface WeightedDensityPoint {
  vehicleId: string;
  routeId: string;
  routeShortName: string;
  position: LatLngPoint;
  delaySeconds: number;
  weight: number; // Normalized intensity weight ~0.5..2.6
}

export interface DensityHotspot {
  id: string;
  zoneName: string;
  center: LatLngPoint;
  vehicleCount: number;
  delayedCount: number;
  avgDelaySec: number;
  intensityScore: number; // 0-100
  routeShortNames: string[];
}

export interface DensitySummary {
  totalVehicles: number;
  delayedVehicles: number;
  avgDelaySec: number;
  hotspots: DensityHotspot[];
}

/**
 * Computes a spatial kernel weight for a live transit vehicle.
 * - 'volume' mode: focuses on fleet concentration (trams slightly higher capacity).
 * - 'congestion' mode: boosts vehicles running behind schedule in GTFS-RT telemetry.
 */
export function computeVehicleCongestionWeight(
  vehicle: Pick<LiveVehicle, 'routeType' | 'delaySeconds'>,
  mode: DensityMetricMode = 'congestion'
): number {
  const baseWeight = vehicle.routeType === 0 ? 1.25 : 1.0;
  if (mode === 'volume') {
    return baseWeight;
  }

  const positiveDelay = Math.max(0, vehicle.delaySeconds);
  if (positiveDelay <= 90) {
    return baseWeight;
  }
  // Smooth congestion multiplier from 1.0x at 90s up to 2.1x at 10+ minutes delay
  const excessRatio = Math.min(1, (positiveDelay - 90) / 510);
  const delayFactor = 1 + excessRatio * 1.1;
  return Math.round(baseWeight * delayFactor * 100) / 100;
}

/**
 * Computes an appropriate Gaussian kernel radius (in CSS pixels) for a given map zoom level
 * so Clermont-Ferrand corridors merge smoothly into readable hotspots without washing out the map.
 */
export function computeZoomKernelRadiusPx(zoom: number): number {
  const clampedZoom = Math.max(10, Math.min(18, zoom));
  // ~44px at zoom 13 (~550m corridor radius in Clermont-Ferrand), scaling gently with zoom
  const radius = 44 * Math.pow(1.26, clampedZoom - 13);
  return Math.round(Math.max(22, Math.min(110, radius)));
}

interface ColorStop {
  stop: number; // 0..1
  r: number;
  g: number;
  b: number;
  a: number; // 0..255 max alpha at this stop
}

const DARK_THERMAL_STOPS: ColorStop[] = [
  { stop: 0.0, r: 14, g: 165, b: 233, a: 0 }, // Transparent
  { stop: 0.14, r: 14, g: 165, b: 233, a: 88 }, // Sky cyan
  { stop: 0.34, r: 20, g: 184, b: 166, a: 142 }, // Teal
  { stop: 0.56, r: 245, g: 158, b: 11, a: 186 }, // Amber
  { stop: 0.78, r: 249, g: 115, b: 22, a: 214 }, // Deep orange
  { stop: 0.92, r: 239, g: 68, b: 68, a: 232 }, // Crimson red
  { stop: 1.0, r: 254, g: 226, b: 226, a: 242 }, // Incandescent peak
];

let cachedLut: Uint8ClampedArray | null = null;

/**
 * Builds a 256-entry RGBA lookup table (length 1024) optimized for dark control-center map tiles.
 */
export function buildThermalColorLut(): Uint8ClampedArray {
  if (cachedLut) return cachedLut;
  const lut = new Uint8ClampedArray(256 * 4);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lo = DARK_THERMAL_STOPS[0];
    let hi = DARK_THERMAL_STOPS[DARK_THERMAL_STOPS.length - 1];

    for (let s = 0; s < DARK_THERMAL_STOPS.length - 1; s++) {
      if (t >= DARK_THERMAL_STOPS[s].stop && t <= DARK_THERMAL_STOPS[s + 1].stop) {
        lo = DARK_THERMAL_STOPS[s];
        hi = DARK_THERMAL_STOPS[s + 1];
        break;
      }
    }

    const span = Math.max(0.0001, hi.stop - lo.stop);
    const localT = Math.max(0, Math.min(1, (t - lo.stop) / span));

    const offset = i * 4;
    lut[offset] = Math.round(lo.r + (hi.r - lo.r) * localT);
    lut[offset + 1] = Math.round(lo.g + (hi.g - lo.g) * localT);
    lut[offset + 2] = Math.round(lo.b + (hi.b - lo.b) * localT);
    lut[offset + 3] = Math.round(lo.a + (hi.a - lo.a) * localT);
  }

  cachedLut = lut;
  return lut;
}

/**
 * Clusters live weighted vehicle positions into top high-traffic / congestion zones
 * named by the nearest Clermont-Ferrand station.
 */
export function computeDensityHotspots(
  points: WeightedDensityPoint[],
  stations: TransitStation[],
  clusterRadiusMeters = 680,
  maxHotspots = 3
): DensitySummary {
  if (points.length === 0) {
    return {
      totalVehicles: 0,
      delayedVehicles: 0,
      avgDelaySec: 0,
      hotspots: [],
    };
  }

  let totalDelay = 0;
  let delayedVehicles = 0;
  for (const p of points) {
    totalDelay += p.delaySeconds;
    if (p.delaySeconds >= 120) delayedVehicles++;
  }

  // Greedy density-peak clustering: score every point by total weight within radius
  const neighborScores = points.map((p, idx) => {
    let score = 0;
    for (let j = 0; j < points.length; j++) {
      const dist = haversineMeters(p.position, points[j].position);
      if (dist <= clusterRadiusMeters) {
        const falloff = 1 - (dist / clusterRadiusMeters) * 0.55;
        score += points[j].weight * falloff;
      }
    }
    return { idx, score };
  });

  neighborScores.sort((a, b) => b.score - a.score);

  const assigned = new Set<number>();
  const rawClusters: Array<{
    members: WeightedDensityPoint[];
    weightSum: number;
    center: LatLngPoint;
  }> = [];

  for (const candidate of neighborScores) {
    if (assigned.has(candidate.idx)) continue;
    const seed = points[candidate.idx];
    const members: WeightedDensityPoint[] = [];
    let weightSum = 0;
    let latSum = 0;
    let lngSum = 0;

    for (let j = 0; j < points.length; j++) {
      if (assigned.has(j)) continue;
      if (haversineMeters(seed.position, points[j].position) <= clusterRadiusMeters) {
        assigned.add(j);
        members.push(points[j]);
        weightSum += points[j].weight;
        latSum += points[j].position.lat * points[j].weight;
        lngSum += points[j].position.lng * points[j].weight;
      }
    }

    if (members.length > 0 && weightSum > 0) {
      rawClusters.push({
        members,
        weightSum,
        center: {
          lat: latSum / weightSum,
          lng: lngSum / weightSum,
        },
      });
    }
    if (rawClusters.length >= maxHotspots) break;
  }

  const peakWeight = rawClusters[0]?.weightSum || 1;
  const hotspots: DensityHotspot[] = rawClusters.map((c, idx) => {
    // Label zone using nearest station (preferring major hubs within 500m)
    let bestStation: TransitStation | null = null;
    let bestScore = Infinity;
    for (const st of stations) {
      const dist = haversineMeters(c.center, { lat: st.lat, lng: st.lng });
      const adjusted = st.isMajorHub && dist <= 550 ? dist * 0.65 : dist;
      if (adjusted < bestScore) {
        bestScore = adjusted;
        bestStation = st;
      }
    }

    const zoneName = bestStation
      ? formatShortStationLabel(bestStation.name)
      : `Sector ${idx + 1}`;
    const clusterDelaySum = c.members.reduce((acc, m) => acc + m.delaySeconds, 0);
    const clusterDelayed = c.members.filter((m) => m.delaySeconds >= 120).length;
    const routes = Array.from(new Set(c.members.map((m) => m.routeShortName))).slice(0, 4);

    // Calibrate intensity score 0-100 reflecting both relative peak and absolute vehicle count
    const absoluteFactor = Math.min(1, c.weightSum / Math.max(3.5, peakWeight));
    const intensityScore = Math.max(18, Math.min(100, Math.round(absoluteFactor * 100)));

    return {
      id: `hotspot-${idx}-${zoneName}`,
      zoneName,
      center: c.center,
      vehicleCount: c.members.length,
      delayedCount: clusterDelayed,
      avgDelaySec: Math.round(clusterDelaySum / c.members.length),
      intensityScore,
      routeShortNames: routes,
    };
  });

  return {
    totalVehicles: points.length,
    delayedVehicles,
    avgDelaySec: Math.round(totalDelay / points.length),
    hotspots,
  };
}
