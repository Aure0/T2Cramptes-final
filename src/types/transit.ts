export interface LatLngPoint {
  lat: number;
  lng: number;
}

export type RouteTier = 'core' | 'essential' | 'secondary' | 'local' | 'other';

export interface TransitRoute {
  id: string;
  shortName: string;
  longName: string;
  description: string;
  routeType: number; // 0 = Tram, 3 = Bus / BHNS
  color: string; // Hex with leading #
  textColor: string; // Hex with leading #
  sortOrder: number;
  tier: RouteTier;
  headsigns: string[];
  shapes: LatLngPoint[][]; // Up to 2 canonical directional polylines
  stationIds: string[]; // Parent station IDs served by this route
}

export interface TransitStation {
  id: string; // Parent station ID (or platform ID if standalone)
  name: string;
  lat: number;
  lng: number;
  wheelchairAccessible: boolean;
  routeIds: string[];
  platformIds: string[];
  isMajorHub: boolean;
}

export interface NetworkSnapshot {
  agencyName: string;
  loadedAt: number;
  sourceUrl: string;
  routes: TransitRoute[];
  stations: TransitStation[];
}

export interface UpcomingStopInfo {
  stopId: string;
  stationId: string;
  stationName: string;
  arrivalTime: number; // Unix epoch seconds
  departureTime: number; // Unix epoch seconds
  delaySeconds: number;
}

export interface LiveVehicle {
  id: string;
  tripId: string;
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  routeType: number;
  directionId: number;
  headsign: string;
  vehicleLabel: string | null;
  prevStopId: string;
  prevStopName: string;
  nextStopId: string;
  nextStopName: string;
  nextStationId: string;
  prevDepTime: number; // Unix epoch seconds
  nextArrTime: number; // Unix epoch seconds
  delaySeconds: number;
  segmentPath: LatLngPoint[]; // Ordered polyline points from prevStop to nextStop
  stopsRemaining: number;
  upcomingStops: UpcomingStopInfo[];
}

export interface LiveTrafficResponse {
  feedTimestamp: number; // Unix epoch seconds from GTFS-RT FeedHeader
  fetchedAt: number; // Unix epoch ms on server
  serverNowSeconds: number; // Server clock epoch seconds for offset calibration
  feedStatus: 'live' | 'stale' | 'degraded';
  totalRtTrips: number;
  activeVehicleCount: number;
  activeCountByRoute: Record<string, number>;
  vehicles: LiveVehicle[];
}

export interface StationArrival {
  tripId: string;
  vehicleId: string | null;
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  routeType: number;
  directionId: number;
  headsign: string;
  stopId: string;
  arrivalTime: number; // Unix epoch seconds (live GTFS-RT)
  departureTime: number; // Unix epoch seconds
  delaySeconds: number;
  isActiveVehicle: boolean;
}

export interface StationArrivalsResponse {
  station: TransitStation;
  feedTimestamp: number;
  serverNowSeconds: number;
  arrivals: StationArrival[];
}

export type PunctualityPeriod = '6h' | '24h' | '7d' | '30d' | 'all';

export interface PunctualityBucket {
  label: string;
  timestamp: number; // Unix epoch seconds
  earlyPct: number; // 0-100
  onTimePct: number; // 0-100
  latePct: number; // 0-100
  avgDelaySec: number;
  sampleCount: number;
  source: 'live' | 'baseline';
}

export interface RoutePunctualityResponse {
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  period: PunctualityPeriod;
  generatedAt: number;
  thresholdSeconds: number; // ±90s on-time window
  summary: {
    earlyPct: number;
    onTimePct: number;
    latePct: number;
    avgDelaySec: number;
    totalSamples: number;
    liveSampleCount: number;
    peakLateLabel: string;
    peakLatePct: number;
    bestOnTimeLabel: string;
    bestOnTimePct: number;
  };
  buckets: PunctualityBucket[];
}

export type AlertSeverity = 'severe' | 'moderate' | 'info';

export type AlertStatus = 'active' | 'scheduled' | 'resolved';

export type AlertCause =
  | 'CONSTRUCTION'
  | 'MAINTENANCE'
  | 'TECHNICAL_PROBLEM'
  | 'STRIKE'
  | 'DEMONSTRATION'
  | 'ACCIDENT'
  | 'WEATHER'
  | 'POLICE_ACTIVITY'
  | 'MEDICAL_EMERGENCY'
  | 'HOLIDAY'
  | 'OTHER_CAUSE'
  | 'UNKNOWN_CAUSE';

export type AlertEffect =
  | 'NO_SERVICE'
  | 'REDUCED_SERVICE'
  | 'SIGNIFICANT_DELAYS'
  | 'DETOUR'
  | 'ADDITIONAL_SERVICE'
  | 'MODIFIED_SERVICE'
  | 'STOP_MOVED'
  | 'OTHER_EFFECT'
  | 'UNKNOWN_EFFECT';

export interface AlertActivePeriod {
  start: number | null; // Unix epoch seconds
  end: number | null; // Unix epoch seconds (null = ongoing / until further notice)
}

export interface AlertRevisionEvent {
  timestamp: number; // Unix epoch seconds
  kind: 'published' | 'effective' | 'updated' | 'observed' | 'resolved';
  summary: string;
}

export interface AlertExternalLink {
  label: string;
  url: string;
}

export interface ServiceAlert {
  id: string;
  source: 'gtfs-rt' | 't2c-siv' | 'gtfs-rt-delay';
  sourceLabel: string;
  status: AlertStatus;
  severity: AlertSeverity;
  priority: number;
  cause: AlertCause;
  effect: AlertEffect;
  headerText: string;
  descriptionPlain: string;
  paragraphs: string[];
  bulletPoints: string[];
  affectedRouteIds: string[];
  affectedStopNames: string[];
  accessibilityNote: string | null;
  links: AlertExternalLink[];
  activePeriods: AlertActivePeriod[];
  startTime: number | null; // Unix epoch seconds
  endTime: number | null; // Unix epoch seconds (null if open-ended)
  createdAt: number | null; // Unix epoch seconds
  updatedAt: number | null; // Unix epoch seconds
  firstSeenAt: number; // Unix epoch seconds
  lastSeenAt: number; // Unix epoch seconds
  resolvedAt: number | null; // Unix epoch seconds
  revisionHistory: AlertRevisionEvent[];
}

export interface ServiceAlertsResponse {
  fetchedAt: number; // Unix epoch ms
  feedTimestamp: number; // Unix epoch seconds
  feedSource: string;
  gtfsRtEntityCount: number;
  activeAlerts: ServiceAlert[];
  history: ServiceAlert[];
  activeAlertCountByRoute: Record<string, number>;
}

