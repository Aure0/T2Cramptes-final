import type { LatLngPoint, TransitStation } from '../types/transit';
import type { AppLocale } from './i18n';

const EARTH_RADIUS_M = 6_371_000;
const WALK_SPEED_M_PER_MIN = 78; // ~4.7 km/h realistic urban walking pace

export interface NearbyStationEntry {
  station: TransitStation;
  distanceMeters: number;
  walkMinutes: number;
}

export function haversineDistanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateWalkMinutes(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 1;
  return Math.max(1, Math.round(distanceMeters / WALK_SPEED_M_PER_MIN));
}

export function formatDistanceLabel(distanceMeters: number, locale: AppLocale): string {
  const safeMeters = Math.max(0, Math.round(distanceMeters));
  if (safeMeters < 1000) {
    return `${Math.max(10, Math.round(safeMeters / 10) * 10)} m`;
  }
  const km = (safeMeters / 1000).toFixed(1);
  return locale === 'fr' ? `${km.replace('.', ',')} km` : `${km} km`;
}

/**
 * Returns the closest T2C stops within `maxDistanceMeters` sorted by walking distance.
 */
export function findNearbyStations(
  origin: LatLngPoint,
  stations: readonly TransitStation[],
  options: { limit?: number; maxDistanceMeters?: number } = {}
): NearbyStationEntry[] {
  const limit = options.limit ?? 6;
  const maxDistanceMeters = options.maxDistanceMeters ?? 2500;
  const out: NearbyStationEntry[] = [];

  for (const station of stations) {
    const distanceMeters = haversineDistanceMeters(origin, {
      lat: station.lat,
      lng: station.lng,
    });
    if (distanceMeters <= maxDistanceMeters) {
      out.push({
        station,
        distanceMeters,
        walkMinutes: estimateWalkMinutes(distanceMeters),
      });
    }
  }

  out.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return out.slice(0, limit);
}
