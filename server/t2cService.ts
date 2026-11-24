import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type {
  LatLngPoint,
  LiveTrafficResponse,
  LiveVehicle,
  NetworkSnapshot,
  PunctualityPeriod,
  RoutePunctualityResponse,
  ServiceAlert,
  ServiceAlertsResponse,
  StationArrival,
  StationArrivalsResponse,
  TransitRoute,
  TransitStation,
  UpcomingStopInfo,
} from '../src/types/transit';
import {
  buildActiveAlertCountByRoute,
  mergeAlertsIntoHistory,
  normalizeGtfsRtAlertEntity,
  normalizeT2CSivAlert,
  type RawGtfsRtAlertEntity,
  type RawT2CSivAlert,
} from '../src/utils/alertsMath';
import {
  buildPunctualityHistory,
  classifyDelayBucket,
  type LiveRouteObservation,
} from '../src/utils/punctualityMath';
import {
  clusterStationPlatforms,
  deduplicateRouteShapes,
  type RawPlatformForClustering,
} from '../src/utils/routeCorridorMath';
import {
  classifyT2CRouteTier,
  simplifyPath,
  sliceBestShapeBetweenStops,
} from '../src/utils/transitMath';

const GTFS_STATIC_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/4e237a58-cd14-4746-b729-1337a40a8a7b';
const GTFS_RT_URL =
  'https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update';
const GTFS_RT_ALERTS_URL = (process.env.T2C_GTFS_RT_ALERTS_URL || '').trim();
const T2C_SIV_ALERTS_URL = 'https://api.t2c.fr/siv/alerts';
const GTFS_CACHE_PATH = '/tmp/t2c_gtfs_cache.zip';
const GTFS_FALLBACK_PATH = '/tmp/t2c_gtfs.zip';
const DISRUPTION_HISTORY_PATH = '/tmp/t2c_disruption_history.json';
const STATIC_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const LIVE_TTL_MS = 8 * 1000; // 8 seconds
const ALERTS_TTL_MS = 25 * 1000; // 25 seconds

interface RawPlatform {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  parentStationId: string;
  wheelchair: boolean;
}

interface InternalStaticStore {
  snapshot: NetworkSnapshot;
  routesById: Map<string, TransitRoute>;
  stationsById: Map<string, TransitStation>;
  platformsById: Map<string, RawPlatform>;
  shapesById: Map<string, LatLngPoint[]>;
  shapesByRouteDir: Map<string, LatLngPoint[][]>;
  tripShapeIdByTripId: Map<string, string>;
}

interface InternalLiveStore {
  response: LiveTrafficResponse;
  arrivalsByStation: Map<string, StationArrival[]>;
  inlineGtfsRtAlerts: ServiceAlert[];
  fetchedAt: number;
}

interface InternalAlertsStore {
  response: ServiceAlertsResponse;
  fetchedAt: number;
}

let staticStore: InternalStaticStore | null = null;
let staticLoadPromise: Promise<InternalStaticStore> | null = null;

let liveStore: InternalLiveStore | null = null;
let liveLoadPromise: Promise<InternalLiveStore> | null = null;

let alertsStore: InternalAlertsStore | null = null;
let alertsLoadPromise: Promise<InternalAlertsStore> | null = null;
let persistedDisruptionHistory: ServiceAlert[] | null = null;

// Rolling in-memory store of real observed GTFS-RT route punctuality snapshots (5-min buckets)
const OBSERVATION_BUCKET_SEC = 300;
const MAX_OBSERVATIONS_PER_ROUTE = 288; // Up to 24h of 5-min observed buckets
const observationsByRoute = new Map<string, LiveRouteObservation[]>();

function recordRouteObservations(vehicles: LiveVehicle[], nowSec: number): void {
  const bucketTs = Math.floor(nowSec / OBSERVATION_BUCKET_SEC) * OBSERVATION_BUCKET_SEC;
  const byRoute = new Map<
    string,
    { early: number; onTime: number; late: number; delaySum: number; count: number }
  >();

  for (const v of vehicles) {
    let agg = byRoute.get(v.routeId);
    if (!agg) {
      agg = { early: 0, onTime: 0, late: 0, delaySum: 0, count: 0 };
      byRoute.set(v.routeId, agg);
    }
    const cls = classifyDelayBucket(v.delaySeconds);
    if (cls === 'early') agg.early++;
    else if (cls === 'late') agg.late++;
    else agg.onTime++;
    agg.delaySum += v.delaySeconds;
    agg.count++;
  }

  for (const [routeId, agg] of byRoute.entries()) {
    let list = observationsByRoute.get(routeId);
    if (!list) {
      list = [];
      observationsByRoute.set(routeId, list);
    }
    const obs: LiveRouteObservation = {
      timestamp: bucketTs,
      earlyCount: agg.early,
      onTimeCount: agg.onTime,
      lateCount: agg.late,
      delaySumSec: agg.delaySum,
      sampleCount: agg.count,
    };
    const last = list[list.length - 1];
    if (last && last.timestamp === bucketTs) {
      list[list.length - 1] = obs;
    } else {
      list.push(obs);
      if (list.length > MAX_OBSERVATIONS_PER_ROUTE) {
        list.shift();
      }
    }
  }
}

/**
 * RFC-4180 compliant single CSV line parser.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function normalizeHexColor(raw: string | undefined, fallback: string): string {
  const cleaned = (raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return fallback;
}

function toNumber(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Number(val) || 0;
  if (typeof val === 'object' && 'toNumber' in (val as Record<string, unknown>)) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val) || 0;
}

async function ensureGtfsZipBuffer(): Promise<Buffer> {
  // Reuse fresh disk cache if available
  for (const candidate of [GTFS_CACHE_PATH, GTFS_FALLBACK_PATH]) {
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (Date.now() - stat.mtimeMs < STATIC_TTL_MS && stat.size > 100_000) {
          return fs.readFileSync(candidate);
        }
      }
    } catch {
      // Ignore cache read issues and fetch fresh
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch(GTFS_STATIC_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'T2Cramptes/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`GTFS static HTTP ${res.status}`);
    }
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    try {
      fs.writeFileSync(GTFS_CACHE_PATH, buf);
    } catch {
      // Non-fatal if /tmp write fails
    }
    return buf;
  } catch (err) {
    // Fallback to any existing cached copy on disk
    for (const candidate of [GTFS_CACHE_PATH, GTFS_FALLBACK_PATH]) {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate);
      }
    }
    throw err;
  }
}

function parseStaticGtfs(zipBuffer: Buffer): InternalStaticStore {
  const zip = new AdmZip(zipBuffer);

  // 1. Agency name
  let agencyName = 'T2C Clermont-Ferrand (SMTC-AC)';
  const agencyEntry = zip.getEntry('agency.txt');
  if (agencyEntry) {
    const lines = agencyEntry.getData().toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines.length >= 2) {
      const headers = parseCsvLine(lines[0]);
      const cols = parseCsvLine(lines[1]);
      const nameIdx = headers.indexOf('agency_name');
      if (nameIdx >= 0 && cols[nameIdx]) {
        agencyName = cols[nameIdx].trim();
      }
    }
  }

  // 2. Routes
  const routesById = new Map<string, TransitRoute>();
  const routesEntry = zip.getEntry('routes.txt');
  if (!routesEntry) throw new Error('GTFS archive missing routes.txt');
  {
    const lines = routesEntry.getData().toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const h = parseCsvLine(lines[0]);
    const idxId = h.indexOf('route_id');
    const idxShort = h.indexOf('route_short_name');
    const idxLong = h.indexOf('route_long_name');
    const idxDesc = h.indexOf('route_desc');
    const idxType = h.indexOf('route_type');
    const idxColor = h.indexOf('route_color');
    const idxTextColor = h.indexOf('route_text_color');
    const idxOrder = h.indexOf('route_sort_order');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCsvLine(line);
      const id = cols[idxId]?.trim();
      if (!id) continue;
      const shortName = (cols[idxShort] || id).trim();
      const tier = classifyT2CRouteTier(shortName);

      routesById.set(id, {
        id,
        shortName,
        longName: (cols[idxLong] || shortName).trim(),
        description: (cols[idxDesc] || `Line ${shortName}`).trim(),
        routeType: Number(cols[idxType] ?? 3),
        color: normalizeHexColor(cols[idxColor], '#38BDF8'),
        textColor: normalizeHexColor(cols[idxTextColor], '#FFFFFF'),
        sortOrder: Number(cols[idxOrder] ?? 999),
        tier,
        headsigns: [],
        shapes: [],
        stationIds: [],
      });
    }
  }

  // 3. Stops (collect raw parent stations + raw platforms before mode/spatial clustering)
  const rawParentStations = new Map<string, { id: string; name: string; lat: number; lng: number; wheel: boolean }>();
  const rawPlatformsById = new Map<
    string,
    {
      stopId: string;
      name: string;
      lat: number;
      lng: number;
      rawParentId: string;
      wheelchair: boolean;
    }
  >();
  const stopsEntry = zip.getEntry('stops.txt');
  if (!stopsEntry) throw new Error('GTFS archive missing stops.txt');
  {
    const lines = stopsEntry.getData().toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const h = parseCsvLine(lines[0]);
    const idxId = h.indexOf('stop_id');
    const idxName = h.indexOf('stop_name');
    const idxLat = h.indexOf('stop_lat');
    const idxLon = h.indexOf('stop_lon');
    const idxLocType = h.indexOf('location_type');
    const idxWheel = h.indexOf('wheelchair_boarding');
    const idxParent = h.indexOf('parent_station');

    const rawRows: Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      locType: number;
      wheel: boolean;
      parent: string;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCsvLine(line);
      const id = cols[idxId]?.trim();
      const lat = Number(cols[idxLat]);
      const lng = Number(cols[idxLon]);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      rawRows.push({
        id,
        name: (cols[idxName] || id).trim(),
        lat,
        lng,
        locType: Number(cols[idxLocType] || 0),
        wheel: cols[idxWheel] === '1',
        parent: (cols[idxParent] || '').trim(),
      });
    }

    for (const row of rawRows) {
      if (row.locType === 1) {
        rawParentStations.set(row.id, {
          id: row.id,
          name: row.name,
          lat: row.lat,
          lng: row.lng,
          wheel: row.wheel,
        });
      }
    }

    for (const row of rawRows) {
      if (row.locType === 1) continue;
      const rawParentId = row.parent && rawParentStations.has(row.parent) ? row.parent : row.id;
      if (!rawParentStations.has(rawParentId)) {
        rawParentStations.set(rawParentId, {
          id: rawParentId,
          name: row.name,
          lat: row.lat,
          lng: row.lng,
          wheel: row.wheel,
        });
      }
      rawPlatformsById.set(row.id, {
        stopId: row.id,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        rawParentId,
        wheelchair: row.wheel,
      });
    }
  }

  // 4. Trips: collect headsigns, ALL distinct shapes per (route, direction), trip->shape map, and representative trips
  const routeHeadsigns = new Map<string, Set<string>>();
  const routeDirShapeIds = new Map<string, Set<string>>(); // key: `${routeId}:${dirId}`
  const routeAllShapeIds = new Map<string, Set<string>>();
  const tripShapeIdByTripId = new Map<string, string>();
  const representativeTripByShape = new Map<string, { routeId: string; dirId: number }>();
  const neededShapeIds = new Set<string>();

  const tripsEntry = zip.getEntry('trips.txt');
  if (tripsEntry) {
    const lines = tripsEntry.getData().toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const h = parseCsvLine(lines[0]);
    const idxTripId = h.indexOf('trip_id');
    const idxRouteId = h.indexOf('route_id');
    const idxHeadsign = h.indexOf('trip_headsign');
    const idxDir = h.indexOf('direction_id');
    const idxShape = h.indexOf('shape_id');

    const seenRouteDirShape = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCsvLine(line);
      const tripId = cols[idxTripId]?.trim();
      const routeId = cols[idxRouteId]?.trim();
      const headsign = (cols[idxHeadsign] || '').trim();
      const dirId = Number(cols[idxDir] || 0);
      const shapeId = (cols[idxShape] || '').trim();

      if (!tripId || !routeId || !routesById.has(routeId)) continue;

      if (headsign) {
        let hs = routeHeadsigns.get(routeId);
        if (!hs) {
          hs = new Set<string>();
          routeHeadsigns.set(routeId, hs);
        }
        if (hs.size < 4) hs.add(headsign);
      }

      if (shapeId) {
        tripShapeIdByTripId.set(tripId, shapeId);

        const rdKey = `${routeId}:${dirId}`;
        let rdShapes = routeDirShapeIds.get(rdKey);
        if (!rdShapes) {
          rdShapes = new Set<string>();
          routeDirShapeIds.set(rdKey, rdShapes);
        }
        rdShapes.add(shapeId);

        let allShapes = routeAllShapeIds.get(routeId);
        if (!allShapes) {
          allShapes = new Set<string>();
          routeAllShapeIds.set(routeId, allShapes);
        }
        allShapes.add(shapeId);
        neededShapeIds.add(shapeId);

        const rdsKey = `${rdKey}:${shapeId}`;
        if (!seenRouteDirShape.has(rdsKey)) {
          seenRouteDirShape.add(rdsKey);
          representativeTripByShape.set(tripId, { routeId, dirId });
        }
      }
    }
  }

  // 5. Shapes: load & lightly simplify ALL distinct shapes (preserving every branch & loop!)
  const rawShapes = new Map<string, Array<{ seq: number; lat: number; lng: number }>>();
  const shapesEntry = zip.getEntry('shapes.txt');
  if (shapesEntry) {
    const lines = shapesEntry.getData().toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const h = parseCsvLine(lines[0]);
    const idxShape = h.indexOf('shape_id');
    const idxLat = h.indexOf('shape_pt_lat');
    const idxLon = h.indexOf('shape_pt_lon');
    const idxSeq = h.indexOf('shape_pt_sequence');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCsvLine(line);
      const shapeId = cols[idxShape]?.trim();
      if (!shapeId || !neededShapeIds.has(shapeId)) continue;
      const lat = Number(cols[idxLat]);
      const lng = Number(cols[idxLon]);
      const seq = Number(cols[idxSeq]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let pts = rawShapes.get(shapeId);
      if (!pts) {
        pts = [];
        rawShapes.set(shapeId, pts);
      }
      pts.push({ seq, lat, lng });
    }
  }

  const shapesById = new Map<string, LatLngPoint[]>();
  for (const [shapeId, pts] of rawShapes.entries()) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => a.seq - b.seq);
    const simplified = simplifyPath(
      pts.map((p) => ({ lat: p.lat, lng: p.lng })),
      0.000025
    );
    if (simplified.length >= 2) {
      shapesById.set(shapeId, simplified);
    }
  }

  // Group directional shapes per (routeId, dirId) sorted longest-first for fast vehicle snapping
  const shapesByRouteDir = new Map<string, LatLngPoint[][]>();
  for (const [rdKey, shapeIdSet] of routeDirShapeIds.entries()) {
    const list: LatLngPoint[][] = [];
    for (const sid of shapeIdSet) {
      const pts = shapesById.get(sid);
      if (pts && pts.length >= 2) list.push(pts);
    }
    list.sort((a, b) => b.length - a.length);
    if (list.length > 0) {
      shapesByRouteDir.set(rdKey, list);
    }
  }

  // Deduplicate overlapping outbound/inbound streets within each route while keeping all branches & one-way loops
  const displayShapesByRouteId = new Map<string, LatLngPoint[][]>();
  const routeSortOrderById = new Map<string, number>();

  for (const [routeId, route] of routesById.entries()) {
    routeSortOrderById.set(routeId, route.sortOrder);
    const hs = routeHeadsigns.get(routeId);
    route.headsigns = hs ? Array.from(hs) : [];

    const allIds = routeAllShapeIds.get(routeId);
    const allShapes: LatLngPoint[][] = [];
    if (allIds) {
      for (const sid of allIds) {
        const pts = shapesById.get(sid);
        if (pts && pts.length >= 2) allShapes.push(pts);
      }
    }
    const deduped = deduplicateRouteShapes(allShapes, 28, 55);
    route.shapes = deduped;
    displayShapesByRouteId.set(routeId, deduped);
  }

  // 6. Platform-to-route mapping via representative trips in stop_times.txt
  const platformRouteSets = new Map<string, Set<string>>();
  const stopTimesEntry = zip.getEntry('stop_times.txt');
  if (stopTimesEntry) {
    const text = stopTimesEntry.getData().toString('utf8').replace(/^\uFEFF/, '');
    const firstNewline = text.indexOf('\n');
    const headerCols = parseCsvLine(text.slice(0, firstNewline).trim());
    const idxTrip = headerCols.indexOf('trip_id');
    const idxStop = headerCols.indexOf('stop_id');

    let pos = firstNewline + 1;
    while (pos < text.length) {
      let nextNl = text.indexOf('\n', pos);
      if (nextNl === -1) nextNl = text.length;
      const line = text.slice(pos, nextNl);
      pos = nextNl + 1;

      if (!line) continue;
      const firstComma = line.indexOf(',');
      if (firstComma === -1) continue;
      const tripId = idxTrip === 0 ? line.slice(0, firstComma).trim() : '';
      const tripMeta =
        idxTrip === 0
          ? representativeTripByShape.get(tripId)
          : representativeTripByShape.get(parseCsvLine(line)[idxTrip]?.trim() || '');
      if (!tripMeta) continue;

      const cols = parseCsvLine(line);
      const stopId = cols[idxStop]?.trim();
      if (!stopId || !rawPlatformsById.has(stopId)) continue;

      let pSet = platformRouteSets.get(stopId);
      if (!pSet) {
        pSet = new Set<string>();
        platformRouteSets.set(stopId, pSet);
      }
      pSet.add(tripMeta.routeId);
    }
  }

  // 7. Cluster platforms into physically exact fixed stops (separating Tram vs Bus/BHNS at hubs like Jaude)
  const platformsByRawParent = new Map<string, RawPlatformForClustering[]>();
  for (const [stopId, rawP] of rawPlatformsById.entries()) {
    const rSet = platformRouteSets.get(stopId);
    const routeIds = rSet ? Array.from(rSet) : [];
    const hasTram = routeIds.some((rid) => routesById.get(rid)?.routeType === 0);
    let list = platformsByRawParent.get(rawP.rawParentId);
    if (!list) {
      list = [];
      platformsByRawParent.set(rawP.rawParentId, list);
    }
    list.push({
      stopId,
      name: rawP.name,
      lat: rawP.lat,
      lng: rawP.lng,
      wheelchair: rawP.wheelchair,
      routeIds,
      hasTram,
    });
  }

  const platformsById = new Map<string, RawPlatform>();
  const stationsById = new Map<string, TransitStation>();
  const routeStationSets = new Map<string, Set<string>>();
  const coreRouteIds = new Set(['A', 'B', 'C']);

  for (const [rawParentId, parentMeta] of rawParentStations.entries()) {
    const rawPlats = platformsByRawParent.get(rawParentId) || [];
    const clusters = clusterStationPlatforms(
      rawParentId,
      parentMeta.name,
      rawPlats,
      displayShapesByRouteId,
      routeSortOrderById
    );

    const assignedStopIds = new Set<string>();
    for (const cluster of clusters) {
      const coreCount = cluster.routeIds.filter((r) => coreRouteIds.has(r)).length;
      const upperName = cluster.name.toUpperCase();
      const isMajorHub =
        coreCount >= 2 ||
        cluster.routeIds.length >= 4 ||
        upperName.includes('JAUDE') ||
        upperName.includes('GARE SNCF') ||
        upperName.includes('LA PARDIEU') ||
        upperName.includes('GAILLARD') ||
        upperName.includes('DELILLE') ||
        upperName.includes('CHAMPRATEL') ||
        upperName.includes('ROYAT') ||
        upperName.includes('LES VERGNES');

      stationsById.set(cluster.id, {
        id: cluster.id,
        name: cluster.name,
        lat: cluster.lat,
        lng: cluster.lng,
        wheelchairAccessible: cluster.wheelchairAccessible,
        routeIds: cluster.routeIds,
        platformIds: cluster.platformIds,
        isMajorHub,
      });

      for (const rid of cluster.routeIds) {
        let stSet = routeStationSets.get(rid);
        if (!stSet) {
          stSet = new Set<string>();
          routeStationSets.set(rid, stSet);
        }
        stSet.add(cluster.id);
      }

      for (const stopId of cluster.platformIds) {
        const rawP = rawPlatformsById.get(stopId);
        if (!rawP) continue;
        assignedStopIds.add(stopId);
        platformsById.set(stopId, {
          stopId: rawP.stopId,
          name: rawP.name,
          lat: rawP.lat,
          lng: rawP.lng,
          parentStationId: cluster.id,
          wheelchair: rawP.wheelchair,
        });
      }
    }

    // Keep any unscheduled/inactive platform mapped to the first cluster (or rawParentId) for GTFS-RT safety
    const fallbackStationId = clusters[0]?.id || rawParentId;
    for (const rawP of rawPlats) {
      if (assignedStopIds.has(rawP.stopId)) continue;
      platformsById.set(rawP.stopId, {
        stopId: rawP.stopId,
        name: rawP.name,
        lat: rawP.lat,
        lng: rawP.lng,
        parentStationId: fallbackStationId,
        wheelchair: rawP.wheelchair,
      });
    }
  }

  for (const [routeId, route] of routesById.entries()) {
    const stSet = routeStationSets.get(routeId);
    route.stationIds = stSet ? Array.from(stSet) : [];
  }

  // Keep only routes that have geometry or are core
  const routes = Array.from(routesById.values())
    .filter((r) => r.shapes.length > 0 || r.tier === 'core')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.shortName.localeCompare(b.shortName));

  // Keep only stations served by at least one active route
  const stations = Array.from(stationsById.values())
    .filter((s) => s.routeIds.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return {
    snapshot: {
      agencyName,
      loadedAt: Date.now(),
      sourceUrl: GTFS_STATIC_URL,
      routes,
      stations,
    },
    routesById,
    stationsById,
    platformsById,
    shapesById,
    shapesByRouteDir,
    tripShapeIdByTripId,
  };
}

export async function getStaticStore(): Promise<InternalStaticStore> {
  if (staticStore && Date.now() - staticStore.snapshot.loadedAt < STATIC_TTL_MS) {
    return staticStore;
  }
  if (!staticLoadPromise) {
    staticLoadPromise = (async () => {
      const buf = await ensureGtfsZipBuffer();
      const parsed = parseStaticGtfs(buf);
      staticStore = parsed;
      return parsed;
    })().finally(() => {
      staticLoadPromise = null;
    });
  }
  return staticLoadPromise;
}

export async function getNetworkSnapshot(): Promise<NetworkSnapshot> {
  const store = await getStaticStore();
  return store.snapshot;
}

async function fetchAndDecodeLiveFeed(store: InternalStaticStore): Promise<InternalLiveStore> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const res = await fetch(GTFS_RT_URL, {
    signal: controller.signal,
    headers: { 'User-Agent': 'T2Cramptes/1.0' },
  });
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`GTFS-RT HTTP ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

  const feedTimestamp = toNumber(feed.header?.timestamp) || Math.floor(Date.now() / 1000);
  const serverNowSeconds = Math.floor(Date.now() / 1000);
  const feedAgeSec = Math.abs(serverNowSeconds - feedTimestamp);
  const feedStatus: 'live' | 'stale' | 'degraded' =
    feedAgeSec <= 300 ? 'live' : feedAgeSec <= 1800 ? 'stale' : 'degraded';

  const vehicles: LiveVehicle[] = [];
  const inlineGtfsRtAlerts: ServiceAlert[] = [];
  const arrivalsByStation = new Map<string, StationArrival[]>();
  const activeCountByRoute: Record<string, number> = {};
  let totalRtTrips = 0;

  for (const entity of feed.entity) {
    if (entity.alert) {
      const normalized = normalizeGtfsRtAlertEntity(
        entity as unknown as RawGtfsRtAlertEntity,
        serverNowSeconds
      );
      if (normalized) {
        inlineGtfsRtAlerts.push(normalized);
      }
    }
    const tu = entity.tripUpdate;
    if (!tu || !tu.trip || !tu.stopTimeUpdate || tu.stopTimeUpdate.length === 0) continue;

    totalRtTrips++;
    const routeId = tu.trip.routeId || '';
    const route = store.routesById.get(routeId);
    if (!route) continue;

    const tripId = tu.trip.tripId || entity.id;
    const directionId = tu.trip.directionId ?? 0;
    const vehicleLabel = tu.vehicle?.label || tu.vehicle?.id || null;

    // Resolve all stop time updates into clean ordered points
    interface ResolvedStop {
      stopId: string;
      stationId: string;
      stationName: string;
      lat: number;
      lng: number;
      arrivalTime: number;
      departureTime: number;
      delaySeconds: number;
      sequence: number;
    }

    const stops: ResolvedStop[] = [];
    for (const stu of tu.stopTimeUpdate) {
      const stopId = stu.stopId || '';
      const platform = store.platformsById.get(stopId);
      if (!platform) continue;
      const arr = toNumber(stu.arrival?.time) || toNumber(stu.departure?.time);
      const dep = toNumber(stu.departure?.time) || arr;
      if (arr <= 0) continue;
      const delay = toNumber(stu.arrival?.delay ?? stu.departure?.delay ?? 0);
      const parentStation = store.stationsById.get(platform.parentStationId);
      stops.push({
        stopId,
        stationId: platform.parentStationId,
        stationName: parentStation?.name || platform.name,
        lat: platform.lat,
        lng: platform.lng,
        arrivalTime: arr,
        departureTime: dep,
        delaySeconds: delay,
        sequence: stu.stopSequence ?? stops.length + 1,
      });
    }

    if (stops.length < 2) continue;
    stops.sort((a, b) => a.sequence - b.sequence || a.arrivalTime - b.arrivalTime);

    const headsign = stops[stops.length - 1].stationName;
    const firstDep = stops[0].departureTime;
    const lastArr = stops[stops.length - 1].arrivalTime;

    // Determine if vehicle is currently active in transit (including 90s boarding window at terminus)
    const isActive = firstDep <= serverNowSeconds + 90 && lastArr >= serverNowSeconds - 30;
    const vehicleId = isActive ? `veh_${tripId}` : null;

    // Populate station arrivals index for upcoming stops (within next 90 mins)
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      // Exclude terminus drop-off-only last stop? Keep last stop if it's arrival, or skip if only arrival?
      // Users waiting at a station want departures/arrivals; skip the very last stop where passengers only alight
      if (i === stops.length - 1) continue;
      if (st.arrivalTime < serverNowSeconds - 45 || st.arrivalTime > serverNowSeconds + 5400) {
        continue;
      }

      let list = arrivalsByStation.get(st.stationId);
      if (!list) {
        list = [];
        arrivalsByStation.set(st.stationId, list);
      }
      list.push({
        tripId,
        vehicleId,
        routeId: route.id,
        routeShortName: route.shortName,
        routeColor: route.color,
        routeTextColor: route.textColor,
        routeType: route.routeType,
        directionId,
        headsign,
        stopId: st.stopId,
        arrivalTime: st.arrivalTime,
        departureTime: st.departureTime,
        delaySeconds: st.delaySeconds,
        isActiveVehicle: isActive,
      });
    }

    if (!isActive) continue;

    // Find current active segment [prevStop -> nextStop]
    let prevIdx = 0;
    let nextIdx = 1;

    if (serverNowSeconds <= stops[0].departureTime) {
      prevIdx = 0;
      nextIdx = 1;
    } else if (serverNowSeconds >= stops[stops.length - 1].arrivalTime) {
      prevIdx = stops.length - 2;
      nextIdx = stops.length - 1;
    } else {
      for (let i = 0; i < stops.length - 1; i++) {
        if (
          stops[i].departureTime <= serverNowSeconds &&
          stops[i + 1].arrivalTime >= serverNowSeconds
        ) {
          prevIdx = i;
          nextIdx = i + 1;
          break;
        }
        // Dwelling at stop i (arrival <= now <= departure)
        if (
          stops[i].arrivalTime <= serverNowSeconds &&
          stops[i].departureTime >= serverNowSeconds
        ) {
          prevIdx = i;
          nextIdx = Math.min(i + 1, stops.length - 1);
          break;
        }
        if (stops[i].arrivalTime > serverNowSeconds) {
          prevIdx = Math.max(0, i - 1);
          nextIdx = i;
          break;
        }
      }
    }

    const prevStop = stops[prevIdx];
    const nextStop = stops[nextIdx];

    // Project segment onto exact trip shape (or best directional branch) and align onto rendered display line
    const exactShapeId = store.tripShapeIdByTripId.get(tripId);
    const exactTripShape = exactShapeId ? store.shapesById.get(exactShapeId) : undefined;
    const sameDirShapes = store.shapesByRouteDir.get(`${route.id}:${directionId}`) || [];
    const altDirShapes =
      store.shapesByRouteDir.get(`${route.id}:${directionId === 0 ? 1 : 0}`) || [];
    const candidates: Array<LatLngPoint[] | undefined> = exactTripShape
      ? [exactTripShape, ...sameDirShapes, ...altDirShapes]
      : [...sameDirShapes, ...altDirShapes];
    const fromPt: LatLngPoint = { lat: prevStop.lat, lng: prevStop.lng };
    const toPt: LatLngPoint = { lat: nextStop.lat, lng: nextStop.lng };

    const segmentPath = sliceBestShapeBetweenStops(candidates, fromPt, toPt, route.shapes);

    const upcomingStops: UpcomingStopInfo[] = stops.slice(nextIdx, nextIdx + 8).map((s) => ({
      stopId: s.stopId,
      stationId: s.stationId,
      stationName: s.stationName,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      delaySeconds: s.delaySeconds,
    }));

    activeCountByRoute[route.id] = (activeCountByRoute[route.id] || 0) + 1;

    vehicles.push({
      id: vehicleId!,
      tripId,
      routeId: route.id,
      routeShortName: route.shortName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      routeType: route.routeType,
      directionId,
      headsign,
      vehicleLabel,
      prevStopId: prevStop.stopId,
      prevStopName: prevStop.stationName,
      nextStopId: nextStop.stopId,
      nextStopName: nextStop.stationName,
      nextStationId: nextStop.stationId,
      prevDepTime: prevStop.departureTime,
      nextArrTime: nextStop.arrivalTime,
      delaySeconds: nextStop.delaySeconds,
      segmentPath,
      stopsRemaining: Math.max(1, stops.length - nextIdx),
      upcomingStops,
    });
  }

  // Sort every station's arrivals chronologically
  for (const list of arrivalsByStation.values()) {
    list.sort((a, b) => a.arrivalTime - b.arrivalTime);
  }

  // Sort vehicles by route sort order then headsign
  vehicles.sort((a, b) => {
    const oa = store.routesById.get(a.routeId)?.sortOrder ?? 999;
    const ob = store.routesById.get(b.routeId)?.sortOrder ?? 999;
    return oa - ob || a.headsign.localeCompare(b.headsign, 'fr');
  });

  // Record real-time punctuality snapshot for every route present in this live poll
  recordRouteObservations(vehicles, serverNowSeconds);

  const fetchedAt = Date.now();
  return {
    response: {
      feedTimestamp,
      fetchedAt,
      serverNowSeconds,
      feedStatus,
      totalRtTrips,
      activeVehicleCount: vehicles.length,
      activeCountByRoute,
      vehicles,
    },
    arrivalsByStation,
    inlineGtfsRtAlerts,
    fetchedAt,
  };
}

export async function getLiveStore(forceRefresh = false): Promise<InternalLiveStore> {
  if (!forceRefresh && liveStore && Date.now() - liveStore.fetchedAt < LIVE_TTL_MS) {
    return liveStore;
  }

  const store = await getStaticStore();

  if (!liveLoadPromise) {
    liveLoadPromise = fetchAndDecodeLiveFeed(store)
      .then((fresh): InternalLiveStore => {
        liveStore = fresh;
        return fresh;
      })
      .catch((err): InternalLiveStore => {
        if (liveStore) {
          return {
            ...liveStore,
            response: {
              ...liveStore.response,
              feedStatus: 'degraded' as const,
              serverNowSeconds: Math.floor(Date.now() / 1000),
            },
          };
        }
        throw err;
      })
      .finally(() => {
        liveLoadPromise = null;
      });
  }
  return liveLoadPromise;
}

export async function getLiveTraffic(
  routeIds?: string[],
  forceRefresh = false
): Promise<LiveTrafficResponse> {
  const live = await getLiveStore(forceRefresh);
  if (!routeIds || routeIds.length === 0) {
    return live.response;
  }
  const filterSet = new Set(routeIds);
  const filteredVehicles = live.response.vehicles.filter((v) => filterSet.has(v.routeId));
  return {
    ...live.response,
    vehicles: filteredVehicles,
  };
}

export async function getStationArrivals(
  stationId: string
): Promise<StationArrivalsResponse | null> {
  const [store, live] = await Promise.all([getStaticStore(), getLiveStore(false)]);
  const station = store.stationsById.get(stationId);
  if (!station) return null;

  const arrivals = (live.arrivalsByStation.get(stationId) || []).slice(0, 30);
  return {
    station,
    feedTimestamp: live.response.feedTimestamp,
    serverNowSeconds: Math.floor(Date.now() / 1000),
    arrivals,
  };
}

export async function getRoutePunctuality(
  routeId: string,
  period: PunctualityPeriod
): Promise<RoutePunctualityResponse | null> {
  const [store, live] = await Promise.all([getStaticStore(), getLiveStore(false)]);
  const route = store.routesById.get(routeId);
  if (!route) return null;

  const obs = observationsByRoute.get(routeId) || [];
  return buildPunctualityHistory({
    routeId: route.id,
    routeShortName: route.shortName,
    routeColor: route.color,
    routeTextColor: route.textColor,
    routeType: route.routeType,
    period,
    nowEpochSec: live.response.serverNowSeconds || Math.floor(Date.now() / 1000),
    observations: obs,
  });
}

export function getCacheInfo(): { cachePath: string; exists: boolean } {
  return {
    cachePath: path.basename(GTFS_CACHE_PATH),
    exists: fs.existsSync(GTFS_CACHE_PATH) || fs.existsSync(GTFS_FALLBACK_PATH),
  };
}

function loadDisruptionHistoryFromDisk(): ServiceAlert[] {
  if (persistedDisruptionHistory) return persistedDisruptionHistory;
  try {
    if (fs.existsSync(DISRUPTION_HISTORY_PATH)) {
      const raw = fs.readFileSync(DISRUPTION_HISTORY_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        persistedDisruptionHistory = parsed as ServiceAlert[];
        return persistedDisruptionHistory;
      }
    }
  } catch {
    // Ignore corrupt disk cache
  }
  persistedDisruptionHistory = [];
  return persistedDisruptionHistory;
}

function saveDisruptionHistoryToDisk(history: ServiceAlert[]): void {
  persistedDisruptionHistory = history;
  try {
    fs.writeFileSync(DISRUPTION_HISTORY_PATH, JSON.stringify(history), 'utf8');
  } catch {
    // Non-fatal if /tmp write fails
  }
}

async function fetchExternalGtfsRtAlerts(nowSec: number): Promise<{ alerts: ServiceAlert[]; feedTimestamp: number }> {
  if (!GTFS_RT_ALERTS_URL) {
    return { alerts: [], feedTimestamp: nowSec };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(GTFS_RT_ALERTS_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'T2Cramptes/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return { alerts: [], feedTimestamp: nowSec };

    const buf = Buffer.from(await res.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
    const feedTimestamp = toNumber(feed.header?.timestamp) || nowSec;
    const alerts: ServiceAlert[] = [];
    for (const entity of feed.entity) {
      if (!entity.alert) continue;
      const norm = normalizeGtfsRtAlertEntity(entity as unknown as RawGtfsRtAlertEntity, nowSec);
      if (norm) alerts.push(norm);
    }
    return { alerts, feedTimestamp };
  } catch {
    return { alerts: [], feedTimestamp: nowSec };
  }
}

async function fetchT2CSivAlerts(nowSec: number): Promise<ServiceAlert[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(T2C_SIV_ALERTS_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'T2Cramptes/1.0',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return [];
    return (json as RawT2CSivAlert[])
      .filter((item) => item && item.id)
      .map((item) => normalizeT2CSivAlert(item, nowSec));
  } catch {
    return [];
  }
}

/**
 * Detects sustained live operational delay advisories from GTFS-RT TripUpdates
 * when a route has >= 3 active vehicles averaging >= 4 minutes behind schedule.
 */
function buildLiveDelayAdvisories(
  store: InternalStaticStore,
  live: InternalLiveStore,
  nowSec: number
): ServiceAlert[] {
  const byRoute = new Map<string, { sumDelay: number; maxDelay: number; delayedCount: number; total: number }>();
  for (const v of live.response.vehicles) {
    let agg = byRoute.get(v.routeId);
    if (!agg) {
      agg = { sumDelay: 0, maxDelay: 0, delayedCount: 0, total: 0 };
      byRoute.set(v.routeId, agg);
    }
    agg.sumDelay += v.delaySeconds;
    if (v.delaySeconds > agg.maxDelay) agg.maxDelay = v.delaySeconds;
    if (v.delaySeconds >= 180) agg.delayedCount++;
    agg.total++;
  }

  const advisories: ServiceAlert[] = [];
  for (const [routeId, agg] of byRoute.entries()) {
    const avgDelaySec = agg.total > 0 ? Math.round(agg.sumDelay / agg.total) : 0;
    if (agg.total >= 3 && avgDelaySec >= 240 && agg.delayedCount >= 2) {
      const route = store.routesById.get(routeId);
      const shortName = route?.shortName || routeId;
      const avgMin = Math.round(avgDelaySec / 60);
      const maxMin = Math.round(agg.maxDelay / 60);
      const bucketHour = Math.floor(nowSec / 3600);
      advisories.push({
        id: `gtfsrt-delay-${routeId}-${bucketHour}`,
        source: 'gtfs-rt-delay',
        sourceLabel: 'GTFS-RT TripUpdates Telemetry',
        status: 'active',
        severity: avgDelaySec >= 420 ? 'severe' : 'moderate',
        priority: avgDelaySec >= 420 ? 0 : 1,
        cause: 'OTHER_CAUSE',
        effect: 'SIGNIFICANT_DELAYS',
        headerText: `Line ${shortName}: Significant delays detected (+${avgMin} min avg)`,
        descriptionPlain: `${agg.delayedCount} of ${agg.total} active vehicles on Line ${shortName} are running more than 3 minutes behind schedule (peak delay +${maxMin} min) in the live GTFS-RT feed.`,
        paragraphs: [
          `${agg.delayedCount} of ${agg.total} active vehicles on Line ${shortName} are currently delayed by more than 3 minutes in real-time GTFS-RT telemetry.`,
          `Average schedule offset across active units is +${avgMin} min, with a peak observed delay of +${maxMin} min.`,
        ],
        bulletPoints: [],
        affectedRouteIds: [routeId],
        affectedStopNames: [],
        accessibilityNote: null,
        links: [],
        activePeriods: [{ start: nowSec, end: null }],
        startTime: nowSec,
        endTime: null,
        createdAt: nowSec,
        updatedAt: nowSec,
        firstSeenAt: nowSec,
        lastSeenAt: nowSec,
        resolvedAt: null,
        revisionHistory: [
          {
            timestamp: nowSec,
            kind: 'observed',
            summary: `Detected via live GTFS-RT TripUpdates (${agg.delayedCount}/${agg.total} vehicles delayed)`,
          },
        ],
      });
    }
  }
  return advisories;
}

async function fetchAndBuildServiceAlerts(): Promise<InternalAlertsStore> {
  const nowSec = Math.floor(Date.now() / 1000);
  const [store, live, externalGtfsRt, sivAlerts] = await Promise.all([
    getStaticStore(),
    getLiveStore(false).catch(() => null),
    fetchExternalGtfsRtAlerts(nowSec),
    fetchT2CSivAlerts(nowSec),
  ]);

  const inlineGtfsRtAlerts = live?.inlineGtfsRtAlerts || [];
  const liveDelayAdvisories = live ? buildLiveDelayAdvisories(store, live, nowSec) : [];

  // Combine GTFS-RT ServiceAlerts + official T2C SIV ServiceAlerts + live severe delay advisories
  const combinedById = new Map<string, ServiceAlert>();
  for (const alert of [...externalGtfsRt.alerts, ...inlineGtfsRtAlerts, ...sivAlerts, ...liveDelayAdvisories]) {
    if (!combinedById.has(alert.id)) {
      combinedById.set(alert.id, alert);
    }
  }

  const liveAlerts = Array.from(combinedById.values());
  const existingHistory = loadDisruptionHistoryFromDisk();
  const { activeAlerts, history } = mergeAlertsIntoHistory(existingHistory, liveAlerts, nowSec, 200);
  saveDisruptionHistoryToDisk(history);

  const gtfsRtEntityCount = externalGtfsRt.alerts.length + inlineGtfsRtAlerts.length;
  const feedSource =
    gtfsRtEntityCount > 0
      ? 'GTFS-RT ServiceAlerts + T2C SIV'
      : 'T2C ServiceAlerts (SIV + GTFS-RT)';

  const fetchedAt = Date.now();
  return {
    fetchedAt,
    response: {
      fetchedAt,
      feedTimestamp: live?.response.feedTimestamp || externalGtfsRt.feedTimestamp || nowSec,
      feedSource,
      gtfsRtEntityCount,
      activeAlerts,
      history,
      activeAlertCountByRoute: buildActiveAlertCountByRoute(activeAlerts),
    },
  };
}

export async function getServiceAlerts(forceRefresh = false): Promise<ServiceAlertsResponse> {
  if (!forceRefresh && alertsStore && Date.now() - alertsStore.fetchedAt < ALERTS_TTL_MS) {
    return alertsStore.response;
  }

  if (!alertsLoadPromise) {
    alertsLoadPromise = fetchAndBuildServiceAlerts()
      .then((fresh) => {
        alertsStore = fresh;
        return fresh;
      })
      .catch((err) => {
        if (alertsStore) return alertsStore;
        throw err;
      })
      .finally(() => {
        alertsLoadPromise = null;
      });
  }

  const res = await alertsLoadPromise;
  return res.response;
}

