import type {
  LatLngPoint,
  LiveTrafficResponse,
  LiveVehicle,
  NetworkSnapshot,
  PunctualityPeriod,
  RoutePunctualityResponse,
  ServiceAlertsResponse,
  StationArrival,
  StationArrivalsResponse,
  TransitRoute,
  TransitStation,
  UpcomingStopInfo,
} from '../types/transit';
import { decodeGtfsRtFeedMessage } from '../utils/gtfsRtDecoder';
import {
  buildPunctualityHistory,
  classifyDelayBucket,
  type LiveRouteObservation,
} from '../utils/punctualityMath';
import {
  resolveLiveFeedClock,
  sliceBestShapeBetweenStops,
} from '../utils/transitMath';

const GTFS_RT_PUBLIC_URL =
  'https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const IS_STATIC_MODE = import.meta.env.VITE_STATIC_MODE === 'true' && !API_BASE_URL;

interface CompactStaticIndex {
  /** stopId -> [parentStationId, platformName, lat, lng] */
  platforms: Record<string, [string, string, number, number]>;
  /** routeId -> deduplicated display polylines [[[lat, lng], ...], ...] */
  displayShapesByRoute?: Record<string, [number, number][][]>;
  /** "routeId:directionId" -> [[[lat, lng], ...], ...] (or legacy single polyline [[lat, lng], ...]) */
  shapesByRouteDir: Record<string, [number, number][][] | [number, number][]>;
}

interface BrowserStaticCache {
  snapshot: NetworkSnapshot;
  routesById: Map<string, TransitRoute>;
  stationsById: Map<string, TransitStation>;
  platformsById: Map<
    string,
    { parentStationId: string; name: string; lat: number; lng: number }
  >;
  shapesByRouteDir: Map<string, LatLngPoint[][]>;
}

interface BrowserLiveCache {
  response: LiveTrafficResponse;
  arrivalsByStation: Map<string, StationArrival[]>;
  fetchedAtMs: number;
}

let browserStaticCache: BrowserStaticCache | null = null;
let browserStaticPromise: Promise<BrowserStaticCache> | null = null;
let browserLiveCache: BrowserLiveCache | null = null;
let browserLivePromise: Promise<BrowserLiveCache> | null = null;
const browserObservationsByRoute = new Map<string, LiveRouteObservation[]>();

const OBSERVATION_BUCKET_SEC = 300;
const MAX_OBSERVATIONS_PER_ROUTE = 288;
const SEGMENT_CACHE_MAX = 4000;
const segmentPathCache = new Map<string, LatLngPoint[]>();

function sliceSegmentCached(
  routeId: string,
  directionId: number,
  prevStopId: string,
  nextStopId: string,
  primaryShapes: LatLngPoint[][] | undefined,
  altShapes: LatLngPoint[][] | undefined,
  displayShapes: LatLngPoint[][] | undefined,
  fromPt: LatLngPoint,
  toPt: LatLngPoint
): LatLngPoint[] {
  const key = `${routeId}:${directionId}|${prevStopId}|${nextStopId}`;
  const hit = segmentPathCache.get(key);
  if (hit) return hit;

  const candidates: LatLngPoint[][] = [
    ...(primaryShapes || []),
    ...(altShapes || []),
  ];
  const segmentPath = sliceBestShapeBetweenStops(candidates, fromPt, toPt, displayShapes);

  if (segmentPathCache.size >= SEGMENT_CACHE_MAX) {
    segmentPathCache.clear();
  }
  segmentPathCache.set(key, segmentPath);
  return segmentPath;
}

function resolveStaticDataUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}data/${fileName}`;
}

function recordBrowserObservations(vehicles: LiveVehicle[], nowSec: number): void {
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
    let list = browserObservationsByRoute.get(routeId);
    if (!list) {
      list = [];
      browserObservationsByRoute.set(routeId, list);
    }
    const obs: LiveRouteObservation = {
      timestamp: bucketTs,
      earlyCount: agg.early,
      onTimeCount: agg.onTime,
      lateCount: agg.late,
      delaySumSec: agg.delaySum,
      sampleCount: agg.count,
    };
    const existingIdx = list.findIndex((o) => o.timestamp === bucketTs);
    if (existingIdx >= 0) {
      list[existingIdx] = obs;
    } else {
      list.push(obs);
      if (list.length > MAX_OBSERVATIONS_PER_ROUTE) {
        list.splice(0, list.length - MAX_OBSERVATIONS_PER_ROUTE);
      }
    }
  }
}

async function ensureBrowserStaticCache(): Promise<BrowserStaticCache> {
  if (browserStaticCache) return browserStaticCache;
  if (!browserStaticPromise) {
    browserStaticPromise = (async () => {
      const [netRes, idxRes] = await Promise.all([
        fetch(resolveStaticDataUrl('network.json')),
        fetch(resolveStaticDataUrl('static-index.json')),
      ]);
      if (!netRes.ok) throw new Error(`Static network HTTP ${netRes.status}`);
      if (!idxRes.ok) throw new Error(`Static index HTTP ${idxRes.status}`);

      const snapshot = (await netRes.json()) as NetworkSnapshot;
      const idx = (await idxRes.json()) as CompactStaticIndex;

      const routesById = new Map<string, TransitRoute>();
      for (const r of snapshot.routes) routesById.set(r.id, r);

      const stationsById = new Map<string, TransitStation>();
      for (const s of snapshot.stations) stationsById.set(s.id, s);

      const platformsById = new Map<
        string,
        { parentStationId: string; name: string; lat: number; lng: number }
      >();
      for (const [stopId, tuple] of Object.entries(idx.platforms || {})) {
        platformsById.set(stopId, {
          parentStationId: tuple[0],
          name: tuple[1],
          lat: tuple[2],
          lng: tuple[3],
        });
      }

      const shapesByRouteDir = new Map<string, LatLngPoint[][]>();
      for (const [key, raw] of Object.entries(idx.shapesByRouteDir || {})) {
        if (!Array.isArray(raw) || raw.length === 0) continue;
        // Support both new multi-branch format [[[lat, lng], ...], ...] and legacy [[lat, lng], ...]
        if (Array.isArray(raw[0]) && typeof raw[0][0] === 'number') {
          shapesByRouteDir.set(key, [
            (raw as [number, number][]).map(([lat, lng]) => ({ lat, lng })),
          ]);
        } else {
          shapesByRouteDir.set(
            key,
            (raw as [number, number][][]).map((poly) =>
              poly.map(([lat, lng]) => ({ lat, lng }))
            )
          );
        }
      }

      // Rebuild each route's deduplicated display polylines from static-index.json when omitted in network.json
      const displayMap = idx.displayShapesByRoute || {};
      for (const route of snapshot.routes) {
        if (!Array.isArray(route.shapes) || route.shapes.length === 0) {
          const preDeduped = displayMap[route.id];
          if (Array.isArray(preDeduped) && preDeduped.length > 0) {
            route.shapes = preDeduped.map((poly) =>
              poly.map(([lat, lng]) => ({ lat, lng }))
            );
          } else {
            const dir0 = shapesByRouteDir.get(`${route.id}:0`) || [];
            const dir1 = shapesByRouteDir.get(`${route.id}:1`) || [];
            route.shapes = [...dir0.slice(0, 1), ...dir1.slice(0, 1)];
          }
        }
      }

      browserStaticCache = {
        snapshot,
        routesById,
        stationsById,
        platformsById,
        shapesByRouteDir,
      };
      return browserStaticCache;
    })().finally(() => {
      browserStaticPromise = null;
    });
  }
  return browserStaticPromise;
}

async function fetchDirectGtfsRtLive(force = false): Promise<BrowserLiveCache> {
  if (!force && browserLiveCache && Date.now() - browserLiveCache.fetchedAtMs < 6_000) {
    return browserLiveCache;
  }
  if (!force && browserLivePromise) {
    return browserLivePromise;
  }

  const run = (async (): Promise<BrowserLiveCache> => {
    const store = await ensureBrowserStaticCache();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(GTFS_RT_PUBLIC_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`GTFS-RT HTTP ${res.status}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const feed = decodeGtfsRtFeedMessage(bytes);

    const clientNowSeconds = Math.floor(Date.now() / 1000);
    const feedTimestamp = feed.header.timestamp || clientNowSeconds;
    const { serverNowSeconds, feedStatus } = resolveLiveFeedClock(
      clientNowSeconds,
      feed.header.timestamp
    );

  const vehicles: LiveVehicle[] = [];
  const arrivalsByStation = new Map<string, StationArrival[]>();
  const activeCountByRoute: Record<string, number> = {};
  let totalRtTrips = 0;

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    if (!tu || !tu.trip || tu.stopTimeUpdate.length === 0) continue;

    totalRtTrips++;
    const routeId = tu.trip.routeId || '';
    const route = store.routesById.get(routeId);
    if (!route) continue;

    const tripId = tu.trip.tripId || entity.id;
    const directionId = tu.trip.directionId ?? 0;
    const vehicleLabel = tu.vehicle?.label || tu.vehicle?.id || null;

    const stops: Array<{
      stopId: string;
      stationId: string;
      stationName: string;
      lat: number;
      lng: number;
      arrivalTime: number;
      departureTime: number;
      delaySeconds: number;
      sequence: number;
    }> = [];

    for (const stu of tu.stopTimeUpdate) {
      const stopId = stu.stopId || '';
      const platform = store.platformsById.get(stopId);
      if (!platform) continue;
      const arr = stu.arrival?.time || stu.departure?.time || 0;
      const dep = stu.departure?.time || arr;
      if (arr <= 0) continue;
      const delay = stu.arrival?.delay ?? stu.departure?.delay ?? 0;
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
    const isActive = firstDep <= serverNowSeconds + 90 && lastArr >= serverNowSeconds - 30;
    const vehicleId = isActive ? `veh_${tripId}` : null;

    for (let i = 0; i < stops.length - 1; i++) {
      const st = stops[i];
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
    const primaryShapes = store.shapesByRouteDir.get(`${route.id}:${directionId}`);
    const altShapes = store.shapesByRouteDir.get(`${route.id}:${directionId === 0 ? 1 : 0}`);
    const fromPt: LatLngPoint = { lat: prevStop.lat, lng: prevStop.lng };
    const toPt: LatLngPoint = { lat: nextStop.lat, lng: nextStop.lng };

    const segmentPath = sliceSegmentCached(
      route.id,
      directionId,
      prevStop.stopId,
      nextStop.stopId,
      primaryShapes,
      altShapes,
      route.shapes,
      fromPt,
      toPt
    );

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

  for (const list of arrivalsByStation.values()) {
    list.sort((a, b) => a.arrivalTime - b.arrivalTime);
  }

  recordBrowserObservations(vehicles, serverNowSeconds);

  const fetchedAtMs = Date.now();
  const nextCache: BrowserLiveCache = {
    response: {
      feedTimestamp,
      fetchedAt: fetchedAtMs,
      serverNowSeconds,
      feedStatus,
      totalRtTrips,
      activeVehicleCount: vehicles.length,
      activeCountByRoute,
      vehicles,
    },
    arrivalsByStation,
    fetchedAtMs,
  };
    browserLiveCache = nextCache;
    return nextCache;
  })().finally(() => {
    if (browserLivePromise === run) {
      browserLivePromise = null;
    }
  });

  browserLivePromise = run;
  return run;
}

export async function fetchTransitNetwork(): Promise<NetworkSnapshot> {
  if (IS_STATIC_MODE) {
    const cache = await ensureBrowserStaticCache();
    return cache.snapshot;
  }
  const res = await fetch(`${API_BASE_URL}/api/transit/network`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as NetworkSnapshot;
}

export async function fetchLiveTransitTraffic(force = false): Promise<LiveTrafficResponse> {
  if (IS_STATIC_MODE) {
    const live = await fetchDirectGtfsRtLive(force);
    return live.response;
  }
  const res = await fetch(`${API_BASE_URL}/api/transit/live${force ? '?force=1' : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as LiveTrafficResponse;
}

export async function fetchStationArrivalsData(
  stationId: string,
  signal?: AbortSignal
): Promise<StationArrivalsResponse> {
  if (IS_STATIC_MODE) {
    const [store, live] = await Promise.all([
      ensureBrowserStaticCache(),
      fetchDirectGtfsRtLive(false),
    ]);
    const station = store.stationsById.get(stationId);
    if (!station) throw new Error(`Unknown station: ${stationId}`);
    return {
      station,
      feedTimestamp: live.response.feedTimestamp,
      serverNowSeconds: Math.floor(Date.now() / 1000),
      arrivals: (live.arrivalsByStation.get(stationId) || []).slice(0, 30),
    };
  }
  const res = await fetch(
    `${API_BASE_URL}/api/transit/station/${encodeURIComponent(stationId)}`,
    { signal }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as StationArrivalsResponse;
}

export async function fetchRoutePunctualityData(
  routeId: string,
  period: PunctualityPeriod,
  signal?: AbortSignal
): Promise<RoutePunctualityResponse> {
  if (IS_STATIC_MODE) {
    const [store, live] = await Promise.all([
      ensureBrowserStaticCache(),
      fetchDirectGtfsRtLive(false),
    ]);
    const route = store.routesById.get(routeId);
    if (!route) throw new Error(`Unknown route: ${routeId}`);
    const nowEpochSec = Math.floor(Date.now() / 1000);
    return buildPunctualityHistory({
      routeId: route.id,
      routeShortName: route.shortName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      routeType: route.routeType,
      period,
      nowEpochSec,
      observations: browserObservationsByRoute.get(routeId) || [],
    });
  }
  const res = await fetch(
    `${API_BASE_URL}/api/transit/punctuality/${encodeURIComponent(routeId)}?period=${period}`,
    { signal }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as RoutePunctualityResponse;
}

export async function fetchServiceAlertsData(force = false): Promise<ServiceAlertsResponse> {
  if (IS_STATIC_MODE) {
    const res = await fetch(resolveStaticDataUrl('alerts.json'), {
      cache: force ? 'no-cache' : 'default',
    });
    if (!res.ok) throw new Error(`Static alerts HTTP ${res.status}`);
    return (await res.json()) as ServiceAlertsResponse;
  }
  const res = await fetch(`${API_BASE_URL}/api/transit/alerts${force ? '?force=1' : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ServiceAlertsResponse;
}
