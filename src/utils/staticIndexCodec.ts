import type { LatLngPoint } from '../types/transit';

export interface PlatformRecord {
  parentStationId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CompactStaticIndexV1 {
  platforms: Record<string, [string, string, number, number]>;
  displayShapesByRoute?: Record<string, [number, number][][]>;
  shapesByRouteDir: Record<string, [number, number][][] | [number, number][]>;
}

export interface CompactStaticIndexV2 {
  v: 2;
  /** stopId -> [parentStationId, platformName, lat, lng] */
  platforms: Record<string, [string, string, number, number]>;
  /** Deduplicated precision-5 Google-encoded polylines */
  polylines: string[];
  /** routeId -> indices into polylines[] */
  displayShapesByRoute: Record<string, number[]>;
  /** "routeId:directionId" -> indices into polylines[] */
  shapesByRouteDir: Record<string, number[]>;
}

export type CompactStaticIndex = CompactStaticIndexV1 | CompactStaticIndexV2;

export interface DecodedStaticIndex {
  platforms: Map<string, PlatformRecord>;
  displayShapesByRoute: Map<string, LatLngPoint[][]>;
  shapesByRouteDir: Map<string, LatLngPoint[][]>;
}

const POLYLINE_SCALE = 1e5;

function encodeSignedInt(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

/**
 * Encodes a polyline into Google Encoded Polyline Algorithm Format (precision 1e5, ~1.1m accuracy).
 */
export function encodePolyline(points: readonly LatLngPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';

  for (let i = 0; i < points.length; i++) {
    const lat = Math.round(points[i].lat * POLYLINE_SCALE);
    const lng = Math.round(points[i].lng * POLYLINE_SCALE);
    result += encodeSignedInt(lat - lastLat);
    result += encodeSignedInt(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }

  return result;
}

/**
 * Decodes a precision-5 Google Encoded Polyline string back into LatLngPoint[].
 */
export function decodePolyline(encoded: string): LatLngPoint[] {
  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  while (index < len) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < len);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < len);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({
      lat: lat / POLYLINE_SCALE,
      lng: lng / POLYLINE_SCALE,
    });
  }

  return points;
}

/**
 * Encodes platforms, display shapes, and directional shapes into CompactStaticIndexV2
 * with deduplicated polyline table (~70% smaller JSON than raw float coordinate arrays).
 */
export function encodeStaticIndexV2(input: {
  platforms: Map<string, PlatformRecord> | Record<string, PlatformRecord>;
  displayShapesByRoute: Map<string, LatLngPoint[][]> | Record<string, LatLngPoint[][]>;
  shapesByRouteDir: Map<string, LatLngPoint[][]> | Record<string, LatLngPoint[][]>;
}): CompactStaticIndexV2 {
  const platforms: Record<string, [string, string, number, number]> = {};
  const platformEntries =
    input.platforms instanceof Map
      ? Array.from(input.platforms.entries())
      : Object.entries(input.platforms);

  for (const [stopId, p] of platformEntries) {
    platforms[stopId] = [
      p.parentStationId,
      p.name,
      Number(p.lat.toFixed(6)),
      Number(p.lng.toFixed(6)),
    ];
  }

  const polylines: string[] = [];
  const polylineIndex = new Map<string, number>();

  const internPolyline = (pts: readonly LatLngPoint[]): number => {
    const encoded = encodePolyline(pts);
    const existing = polylineIndex.get(encoded);
    if (existing !== undefined) return existing;
    const idx = polylines.length;
    polylines.push(encoded);
    polylineIndex.set(encoded, idx);
    return idx;
  };

  const displayShapesByRoute: Record<string, number[]> = {};
  const displayEntries =
    input.displayShapesByRoute instanceof Map
      ? Array.from(input.displayShapesByRoute.entries())
      : Object.entries(input.displayShapesByRoute);

  for (const [routeId, list] of displayEntries) {
    displayShapesByRoute[routeId] = list
      .filter((poly) => poly.length >= 2)
      .map((poly) => internPolyline(poly));
  }

  const shapesByRouteDir: Record<string, number[]> = {};
  const dirEntries =
    input.shapesByRouteDir instanceof Map
      ? Array.from(input.shapesByRouteDir.entries())
      : Object.entries(input.shapesByRouteDir);

  for (const [key, list] of dirEntries) {
    shapesByRouteDir[key] = list
      .filter((poly) => poly.length >= 2)
      .map((poly) => internPolyline(poly));
  }

  return {
    v: 2,
    platforms,
    polylines,
    displayShapesByRoute,
    shapesByRouteDir,
  };
}

/**
 * Decodes either CompactStaticIndexV2 (compact polylines) or legacy V1 coordinate arrays.
 */
export function decodeStaticIndex(raw: CompactStaticIndex): DecodedStaticIndex {
  const platforms = new Map<string, PlatformRecord>();
  for (const [stopId, tuple] of Object.entries(raw.platforms || {})) {
    platforms.set(stopId, {
      parentStationId: tuple[0],
      name: tuple[1],
      lat: tuple[2],
      lng: tuple[3],
    });
  }

  const displayShapesByRoute = new Map<string, LatLngPoint[][]>();
  const shapesByRouteDir = new Map<string, LatLngPoint[][]>();

  if ('v' in raw && raw.v === 2 && Array.isArray(raw.polylines)) {
    const decodedPool: LatLngPoint[][] = raw.polylines.map((enc) => decodePolyline(enc));

    for (const [routeId, indices] of Object.entries(raw.displayShapesByRoute || {})) {
      const shapes: LatLngPoint[][] = [];
      for (const idx of indices) {
        const poly = decodedPool[idx];
        if (poly && poly.length >= 2) shapes.push(poly);
      }
      displayShapesByRoute.set(routeId, shapes);
    }

    for (const [key, indices] of Object.entries(raw.shapesByRouteDir || {})) {
      const shapes: LatLngPoint[][] = [];
      for (const idx of indices) {
        const poly = decodedPool[idx];
        if (poly && poly.length >= 2) shapes.push(poly);
      }
      shapesByRouteDir.set(key, shapes);
    }

    return { platforms, displayShapesByRoute, shapesByRouteDir };
  }

  const v1 = raw as CompactStaticIndexV1;
  for (const [routeId, polys] of Object.entries(v1.displayShapesByRoute || {})) {
    if (!Array.isArray(polys)) continue;
    displayShapesByRoute.set(
      routeId,
      polys.map((poly) => poly.map(([lat, lng]) => ({ lat, lng })))
    );
  }

  for (const [key, shapeList] of Object.entries(v1.shapesByRouteDir || {})) {
    if (!Array.isArray(shapeList) || shapeList.length === 0) continue;
    if (Array.isArray(shapeList[0]) && typeof shapeList[0][0] === 'number') {
      shapesByRouteDir.set(key, [
        (shapeList as [number, number][]).map(([lat, lng]) => ({ lat, lng })),
      ]);
    } else {
      shapesByRouteDir.set(
        key,
        (shapeList as [number, number][][]).map((poly) =>
          poly.map(([lat, lng]) => ({ lat, lng }))
        )
      );
    }
  }

  return { platforms, displayShapesByRoute, shapesByRouteDir };
}
