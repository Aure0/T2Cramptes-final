import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AlertTriangle,
  Crosshair,
  Eye,
  EyeOff,
  Flame,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  Type,
  WifiOff,
} from 'lucide-react';
import type {
  LatLngPoint,
  LiveVehicle,
  TransitRoute,
  TransitStation,
} from '../types/transit';
import {
  computeDensityHotspots,
  computeVehicleCongestionWeight,
  type DensityMetricMode,
  type DensityScope,
  type WeightedDensityPoint,
} from '../utils/densityMath';
import {
  computeDeadZoneFollowShift,
  computeStationCameraPlan,
  easeOutCubic,
} from '../utils/cameraMath';
import type { FeedHealthAssessment } from '../utils/feedHealth';
import {
  buildStackedCorridorFeatures,
} from '../utils/routeCorridorMath';
import {
  computeSegmentProgress,
  formatShortStationLabel,
  interpolateAlongPath,
  preparePolylinePath,
  samplePreparedPathInto,
  type PreparedPolylinePath,
} from '../utils/transitMath';
import { useI18n } from '../contexts/I18nContext';
import type { BasemapStyle } from '../utils/userPreferences';
import { RouteBadge } from './RouteBadge';

if (import.meta.env.PROD && typeof window !== 'undefined') {
  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const workerUrl = new URL(
    `${normalizedBase}assets/maplibre-gl-worker.js`,
    window.location.href
  ).href;
  maplibregl.setWorkerUrl(workerUrl);
}

export const CLERMONT_CENTER: LatLngPoint = { lat: 45.7772, lng: 3.087 };
const DEFAULT_ZOOM = 12.2;

const VECTOR_STYLES: Record<BasemapStyle, { url: string; label: string }> = {
  dark: {
    url: 'https://tiles.openfreemap.org/styles/dark',
    label: 'OpenFreeMap Dark (Vector)',
  },
  liberty: {
    url: 'https://tiles.openfreemap.org/styles/liberty',
    label: 'OpenFreeMap Street (Vector)',
  },
};

const ROUTES_SOURCE_ID = 't2c-routes-source';
const ROUTES_CASING_LAYER_ID = 't2c-routes-casing';
const ROUTES_CORE_LAYER_ID = 't2c-routes-core';
const ROUTES_HOVER_LAYER_ID = 't2c-routes-hover';
const ROUTES_HIT_LAYER_ID = 't2c-routes-hit';

const STATIONS_SOURCE_ID = 't2c-stations-source';
const STATIONS_HALO_LAYER_ID = 't2c-stations-halo';
const STATIONS_DOTS_LAYER_ID = 't2c-stations-dots';
const STATIONS_HIT_LAYER_ID = 't2c-stations-hit';
const STATIONS_LABELS_LAYER_ID = 't2c-stations-labels';
const STATIONS_ACTIVE_LABEL_LAYER_ID = 't2c-stations-active-label';

const DENSITY_SOURCE_ID = 't2c-density-source';
const DENSITY_HEATMAP_LAYER_ID = 't2c-density-heatmap';

interface HoveredRouteTooltipState {
  routeId: string;
  x: number;
  y: number;
}

/**
 * Inspects the active MapLibre basemap style to reuse a verified glyph font stack,
 * avoiding 404 glyph requests across OpenFreeMap Dark and Liberty vector styles.
 */
function resolveBasemapTextFont(map: maplibregl.Map): string[] {
  const layers = map.getStyle()?.layers || [];
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    const tf = layout?.['text-font'];
    if (Array.isArray(tf) && tf.length > 0 && typeof tf[0] === 'string' && tf[0] !== 'literal') {
      return tf as string[];
    }
    if (
      Array.isArray(tf) &&
      tf[0] === 'literal' &&
      Array.isArray(tf[1]) &&
      typeof tf[1][0] === 'string'
    ) {
      return tf[1] as string[];
    }
  }
  return ['Noto Sans Regular'];
}

interface TransitMapProps {
  routes: TransitRoute[];
  stations: TransitStation[];
  vehicles: LiveVehicle[];
  enabledRouteIds: Set<string>;
  activeCountByRoute: Record<string, number>;
  activeAlertCountByRoute?: Record<string, number>;
  selectedStation: TransitStation | null;
  selectedVehicle: LiveVehicle | null;
  followVehicle: boolean;
  onSelectStation: (station: TransitStation) => void;
  onSelectVehicle: (vehicle: LiveVehicle) => void;
  serverClockOffsetSec: number;
  isMotionPaused: boolean;
  onToggleMotionPaused: () => void;
  basemap: BasemapStyle;
  onToggleBasemap: () => void;
  showStops: boolean;
  onToggleStops: () => void;
  showStationLabels: boolean;
  onToggleStationLabels: () => void;
  showDensity: boolean;
  onToggleDensity: () => void;
  feedHealth: FeedHealthAssessment;
}

interface MapViewportState {
  zoom: number;
  center: LatLngPoint;
  isAnimating: boolean;
}

function createVehicleElement(
  shortName: string,
  routeColor: string,
  routeTextColor: string,
  bearing: number,
  isSelected: boolean,
  title: string
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 't2c-vehicle-wrap';
  wrap.title = title;
  wrap.style.cssText =
    'display:flex;align-items:center;justify-content:center;width:36px;height:36px;cursor:pointer;';

  const inner = document.createElement('div');
  inner.className = 't2c-vehicle-inner';
  inner.style.cssText = `position:relative;display:flex;align-items:center;justify-content:center;width:24px;height:24px;transform:${isSelected ? 'scale(1.22)' : 'scale(1)'};transition:transform 180ms ease;`;

  const heading = document.createElement('div');
  heading.className = 't2c-vehicle-heading';
  heading.style.cssText = `position:absolute;inset:-8px;pointer-events:none;transform:rotate(${Math.round(bearing)}deg);`;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'width:100%;height:100%;overflow:visible;';

  const poly = document.createElementNS(svgNS, 'polygon');
  poly.setAttribute('points', '18,0 22.5,7 13.5,7');
  poly.setAttribute('fill', isSelected ? '#38BDF8' : '#F8FAFC');
  poly.setAttribute('stroke', '#050810');
  poly.setAttribute('stroke-width', '1');
  svg.appendChild(poly);
  heading.appendChild(svg);

  const body = document.createElement('div');
  body.className = 't2c-vehicle-body font-display';
  body.textContent = shortName;
  const ringStyle = isSelected
    ? '0 0 0 2px #0B0F17, 0 0 0 4px #38BDF8, 0 6px 14px rgba(0,0,0,0.6)'
    : '0 0 0 2px #0B0F17, 0 4px 10px rgba(0,0,0,0.55)';
  body.style.cssText = `position:relative;display:flex;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 4px;border-radius:9999px;font-size:11px;font-weight:700;line-height:1;background:${routeColor};color:${routeTextColor};box-shadow:${ringStyle};`;

  inner.appendChild(heading);
  inner.appendChild(body);
  wrap.appendChild(inner);
  return wrap;
}

function updateVehicleElement(
  wrap: HTMLDivElement,
  shortName: string,
  routeColor: string,
  routeTextColor: string,
  bearing: number,
  isSelected: boolean,
  title: string
): void {
  if (wrap.title !== title) wrap.title = title;
  const inner = wrap.querySelector('.t2c-vehicle-inner') as HTMLElement | null;
  const heading = wrap.querySelector('.t2c-vehicle-heading') as HTMLElement | null;
  const poly = wrap.querySelector('polygon');
  const body = wrap.querySelector('.t2c-vehicle-body') as HTMLElement | null;

  if (heading) heading.style.transform = `rotate(${Math.round(bearing)}deg)`;
  if (inner) inner.style.transform = isSelected ? 'scale(1.22)' : 'scale(1)';
  if (poly) poly.setAttribute('fill', isSelected ? '#38BDF8' : '#F8FAFC');
  if (body) {
    if (body.textContent !== shortName) body.textContent = shortName;
    body.style.background = routeColor;
    body.style.color = routeTextColor;
    body.style.boxShadow = isSelected
      ? '0 0 0 2px #0B0F17, 0 0 0 4px #38BDF8, 0 6px 14px rgba(0,0,0,0.6)'
      : '0 0 0 2px #0B0F17, 0 4px 10px rgba(0,0,0,0.55)';
  }
}

export const TransitMap: React.FC<TransitMapProps> = React.memo(({
  routes,
  stations,
  vehicles,
  enabledRouteIds,
  activeCountByRoute,
  activeAlertCountByRoute,
  selectedStation,
  selectedVehicle,
  followVehicle,
  onSelectStation,
  onSelectVehicle,
  serverClockOffsetSec,
  isMotionPaused,
  onToggleMotionPaused,
  basemap,
  onToggleBasemap,
  showStops,
  onToggleStops,
  showStationLabels,
  onToggleStationLabels,
  showDensity,
  onToggleDensity,
  feedHealth,
}) => {
  const { locale, t } = useI18n();
  const [densityMetric, setDensityMetric] = useState<DensityMetricMode>('congestion');
  const [densityScope, setDensityScope] = useState<DensityScope>('network');
  const [densityTick, setDensityTick] = useState(0);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [styleRevision, setStyleRevision] = useState(0);
  const [hoveredRoute, setHoveredRoute] = useState<HoveredRouteTooltipState | null>(null);
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<MapViewportState>({
    zoom: DEFAULT_ZOOM,
    center: CLERMONT_CENTER,
    isAnimating: false,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialBasemapRef = useRef<BasemapStyle>(basemap);
  const lastFocusedStationIdRef = useRef<string | null>(null);
  const serverClockOffsetRef = useRef<number>(serverClockOffsetSec);
  serverClockOffsetRef.current = serverClockOffsetSec;
  const isMotionPausedRef = useRef<boolean>(isMotionPaused);
  isMotionPausedRef.current = isMotionPaused;
  const pausedClockSecRef = useRef<number | null>(null);
  const isUserInteractingRef = useRef<boolean>(false);
  const hoveringStationRef = useRef<boolean>(false);

  const routesById = useMemo(() => {
    const rec: Record<string, TransitRoute> = {};
    for (const r of routes) rec[r.id] = r;
    return rec;
  }, [routes]);

  const stationsById = useMemo(() => {
    const rec: Record<string, TransitStation> = {};
    for (const s of stations) rec[s.id] = s;
    return rec;
  }, [stations]);

  const stationsByIdRef = useRef(stationsById);
  stationsByIdRef.current = stationsById;

  const vehicleMarkersRef = useRef<
    Record<
      string,
      {
        marker: maplibregl.Marker;
        el: HTMLDivElement;
        headingEl: HTMLElement | null;
        lastHeadingDeg: number;
        lastLat: number;
        lastLng: number;
        displayProgress: number;
        segmentKey: string;
        signature: string;
        vehicle: LiveVehicle;
        preparedPath: PreparedPolylinePath;
      }
    >
  >({});

  const onSelectStationRef = useRef(onSelectStation);
  const onSelectVehicleRef = useRef(onSelectVehicle);
  const followVehicleRef = useRef(followVehicle);
  const selectedVehicleIdRef = useRef<string | null>(selectedVehicle?.id ?? null);
  onSelectStationRef.current = onSelectStation;
  onSelectVehicleRef.current = onSelectVehicle;
  followVehicleRef.current = followVehicle;
  selectedVehicleIdRef.current = selectedVehicle?.id ?? null;

  // Snapshot clock when motion is paused so markers freeze smoothly at exact coordinates
  useEffect(() => {
    if (isMotionPaused) {
      pausedClockSecRef.current = Date.now() / 1000 + serverClockOffsetRef.current;
    } else {
      pausedClockSecRef.current = null;
    }
  }, [isMotionPaused]);

  const getAnimationClockSec = () =>
    pausedClockSecRef.current ?? Date.now() / 1000 + serverClockOffsetRef.current;

  // Mount high-DPI vector MapLibre GL map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const map = new maplibregl.Map({
      container: el,
      style: VECTOR_STYLES[initialBasemapRef.current].url,
      center: [CLERMONT_CENTER.lng, CLERMONT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      minZoom: 9.5,
      maxZoom: 18.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });

    map.touchZoomRotate.disableRotation();

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      'bottom-left'
    );

    const syncViewport = () => {
      const c = map.getCenter();
      setViewport({
        zoom: map.getZoom(),
        center: { lat: c.lat, lng: c.lng },
        isAnimating: false,
      });
    };

    const handleMoveStart = () => {
      setViewport((prev) => (prev.isAnimating ? prev : { ...prev, isAnimating: true }));
    };

    const handleUserInteractStart = () => {
      isUserInteractingRef.current = true;
    };
    const handleUserInteractEnd = () => {
      isUserInteractingRef.current = false;
    };

    const handleStyleLoad = () => {
      setStyleRevision((r) => r + 1);
      syncViewport();
    };

    const handleMissingStyleImage = (e: { id: string }) => {
      if (!e.id || map.hasImage(e.id)) return;
      map.addImage(e.id, {
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 0]),
      });
    };

    map.on('style.load', handleStyleLoad);
    map.on('load', handleStyleLoad);
    map.on('styleimagemissing', handleMissingStyleImage);
    map.on('movestart', handleMoveStart);
    map.on('moveend', syncViewport);
    map.on('zoomend', syncViewport);
    map.on('dragstart', handleUserInteractStart);
    map.on('dragend', handleUserInteractEnd);
    map.on('zoomstart', handleUserInteractStart);
    map.on('zoomend', handleUserInteractEnd);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(el);

    setMapInstance(map);

    return () => {
      resizeObserver.disconnect();
      map.off('style.load', handleStyleLoad);
      map.off('load', handleStyleLoad);
      map.off('styleimagemissing', handleMissingStyleImage);
      map.off('movestart', handleMoveStart);
      map.off('moveend', syncViewport);
      map.off('zoomend', syncViewport);
      map.off('dragstart', handleUserInteractStart);
      map.off('dragend', handleUserInteractEnd);
      map.off('zoomstart', handleUserInteractStart);
      map.off('zoomend', handleUserInteractEnd);
      for (const id of Object.keys(vehicleMarkersRef.current)) {
        vehicleMarkersRef.current[id].marker.remove();
      }
      vehicleMarkersRef.current = {};
      map.remove();
      setMapInstance(null);
    };
  }, []);

  // Switch between OpenFreeMap Dark and OpenFreeMap Liberty vector styles
  const appliedBasemapRef = useRef<BasemapStyle>(basemap);
  useEffect(() => {
    if (!mapInstance || appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    setStyleRevision(0);
    mapInstance.setStyle(VECTOR_STYLES[basemap].url);
  }, [mapInstance, basemap]);

  // Active vehicles on enabled lines (stable reference across animation frames)
  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => enabledRouteIds.has(v.routeId)),
    [vehicles, enabledRouteIds]
  );

  // Refresh density heatmap/hotspots gently every 2s ONLY while the Density layer is enabled
  useEffect(() => {
    if (!showDensity || isMotionPaused) return;
    const id = window.setInterval(() => {
      if (!document.hidden) {
        setDensityTick((t) => t + 1);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [showDensity, isMotionPaused]);

  const densityPoints = useMemo<WeightedDensityPoint[]>(() => {
    if (!showDensity) return [];
    void densityTick;
    const nowSec = getAnimationClockSec();
    const sourceList = densityScope === 'network' ? vehicles : visibleVehicles;
    return sourceList.map((vehicle) => {
      const progress = computeSegmentProgress(nowSec, vehicle.prevDepTime, vehicle.nextArrTime);
      const { position } = interpolateAlongPath(vehicle.segmentPath, progress);
      return {
        vehicleId: vehicle.id,
        routeId: vehicle.routeId,
        routeShortName: vehicle.routeShortName,
        position,
        delaySeconds: vehicle.delaySeconds,
        weight: computeVehicleCongestionWeight(vehicle, densityMetric),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDensity, densityScope, densityMetric, densityTick, vehicles, visibleVehicles]);

  const hotspotTick = Math.floor(densityTick / 3);
  const densitySummary = useMemo(() => {
    if (!showDensity) return null;
    void hotspotTick;
    return computeDensityHotspots(densityPoints, stations, 680, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDensity, densityScope, densityMetric, hotspotTick, vehicles, stations, enabledRouteIds]);

  // All stations belonging to enabled lines (plus the selected station) rendered on GPU WebGL layers:
  // zero DOM markers, zero viewport-churn on pan, and 0px drift relative to route lines!
  const activeStations = useMemo(() => {
    if (!showStops) {
      return selectedStation ? [selectedStation] : [];
    }
    const list: TransitStation[] = [];
    for (const st of stations) {
      if (
        (selectedStation && st.id === selectedStation.id) ||
        st.routeIds.some((rid) => enabledRouteIds.has(rid))
      ) {
        list.push(st);
      }
    }
    return list;
  }, [showStops, stations, enabledRouteIds, selectedStation]);

  const stationsGeoJson = useMemo<FeatureCollection<Point>>(() => {
    const regularFeatures: Feature<Point>[] = [];
    const hubFeatures: Feature<Point>[] = [];
    let selectedFeature: Feature<Point> | null = null;

    for (const station of activeStations) {
      const isSelected = selectedStation?.id === station.id;
      const primaryRouteId =
        station.routeIds.find((rid) => enabledRouteIds.has(rid)) || station.routeIds[0];
      const ringColor = routesById[primaryRouteId]?.color || '#94A3B8';
      const shortLabel = formatShortStationLabel(station.name);

      const feature: Feature<Point> = {
        type: 'Feature',
        properties: {
          id: station.id,
          shortLabel,
          ringColor,
          isMajorHub: station.isMajorHub ? 1 : 0,
          isSelected: isSelected ? 1 : 0,
        },
        geometry: {
          type: 'Point',
          coordinates: [station.lng, station.lat],
        },
      };

      if (isSelected) {
        selectedFeature = feature;
      } else if (station.isMajorHub) {
        hubFeatures.push(feature);
      } else {
        regularFeatures.push(feature);
      }
    }

    // Draw regular stops first, major hubs above, and the selected station on top
    const features = [...regularFeatures, ...hubFeatures];
    if (selectedFeature) features.push(selectedFeature);
    return { type: 'FeatureCollection', features };
  }, [activeStations, selectedStation, enabledRouteIds, routesById]);

  const focusedRouteId = selectedVehicle ? selectedVehicle.routeId : null;

  // Build parallel-stacked GeoJSON FeatureCollection for visible T2C routes:
  // two-way streets of a single route are deduplicated to 1 clean line, while shared corridors
  // with multiple enabled routes fan out side-by-side via GPU line-offset so every line stays visible!
  const routesGeoJson = useMemo<FeatureCollection<LineString>>(() => {
    const visibleRoutes = routes.filter((r) => enabledRouteIds.has(r.id));
    return buildStackedCorridorFeatures(visibleRoutes, {
      focusedRouteId,
      showDensity,
    });
  }, [routes, enabledRouteIds, focusedRouteId, showDensity]);

  // Synchronize crisp vector stacked route polylines and hover hit layer into MapLibre GL
  useEffect(() => {
    if (!mapInstance || styleRevision === 0 || !mapInstance.getStyle()) return;

    const existingSource = mapInstance.getSource(ROUTES_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (existingSource) {
      existingSource.setData(routesGeoJson);
      return;
    }

    mapInstance.addSource(ROUTES_SOURCE_ID, {
      type: 'geojson',
      data: routesGeoJson,
    });

    // Place transit lines underneath symbol/label layers when possible so street names remain crisp
    const styleLayers = mapInstance.getStyle()?.layers || [];
    const firstLabelLayer = styleLayers.find(
      (l) => l.type === 'symbol' && l.id.toLowerCase().includes('label')
    )?.id;

    // Responsive zoom-scaled lane offset (top-level interpolate expression for MapLibre compliance)
    const lineOffsetExpr: maplibregl.ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['*', ['get', 'offsetSlot'], 2.2],
      12,
      ['*', ['get', 'offsetSlot'], 3.1],
      14,
      ['*', ['get', 'offsetSlot'], 4.0],
      16,
      ['*', ['get', 'offsetSlot'], 4.8],
    ];

    const coreWidthExpr: maplibregl.ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['*', ['get', 'weight'], 0.56],
      12,
      ['*', ['get', 'weight'], 0.78],
      14,
      ['*', ['get', 'weight'], 0.96],
      16,
      ['*', ['get', 'weight'], 1.12],
    ];

    const casingWidthExpr: maplibregl.ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['+', ['*', ['get', 'weight'], 0.56], 1.4],
      12,
      ['+', ['*', ['get', 'weight'], 0.78], 1.8],
      14,
      ['+', ['*', ['get', 'weight'], 0.96], 2.1],
      16,
      ['+', ['*', ['get', 'weight'], 1.12], 2.4],
    ];

    const hoverWidthExpr: maplibregl.ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['+', ['*', ['get', 'weight'], 0.56], 2.0],
      12,
      ['+', ['*', ['get', 'weight'], 0.78], 2.2],
      14,
      ['+', ['*', ['get', 'weight'], 0.96], 2.4],
      16,
      ['+', ['*', ['get', 'weight'], 1.12], 2.6],
    ];

    mapInstance.addLayer(
      {
        id: ROUTES_CASING_LAYER_ID,
        type: 'line',
        source: ROUTES_SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#050810',
          'line-width': casingWidthExpr,
          'line-offset': lineOffsetExpr,
          'line-opacity': ['get', 'casingOpacity'],
        },
      },
      firstLabelLayer
    );

    mapInstance.addLayer(
      {
        id: ROUTES_CORE_LAYER_ID,
        type: 'line',
        source: ROUTES_SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': coreWidthExpr,
          'line-offset': lineOffsetExpr,
          'line-opacity': ['get', 'coreOpacity'],
        },
      },
      firstLabelLayer
    );

    // Zero-rebuild highlight layer filtered to the currently hovered route
    mapInstance.addLayer(
      {
        id: ROUTES_HOVER_LAYER_ID,
        type: 'line',
        source: ROUTES_SOURCE_ID,
        filter: ['==', ['get', 'routeId'], ''],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': hoverWidthExpr,
          'line-offset': lineOffsetExpr,
          'line-opacity': 1,
        },
      },
      firstLabelLayer
    );

    // Wide invisible hit-target layer aligned to each stacked lane so hovering picks that exact route
    mapInstance.addLayer(
      {
        id: ROUTES_HIT_LAYER_ID,
        type: 'line',
        source: ROUTES_SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 11,
          'line-offset': lineOffsetExpr,
          'line-opacity': 0,
        },
      },
      firstLabelLayer
    );
  }, [mapInstance, styleRevision, routesGeoJson]);

  // Synchronize native GPU WebGL station dots, halos, hit targets, and stop-name labels
  useEffect(() => {
    if (!mapInstance || styleRevision === 0 || !mapInstance.getStyle()) return;

    const existingSource = mapInstance.getSource(STATIONS_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (existingSource) {
      existingSource.setData(stationsGeoJson);
    } else {
      const textFont = resolveBasemapTextFont(mapInstance);
      const isDark = basemap === 'dark';

      mapInstance.addSource(STATIONS_SOURCE_ID, {
        type: 'geojson',
        data: stationsGeoJson,
      });

      // Soft cyan halo behind selected or hovered station
      mapInstance.addLayer({
        id: STATIONS_HALO_LAYER_ID,
        type: 'circle',
        source: STATIONS_SOURCE_ID,
        filter: ['==', ['get', 'isSelected'], 1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14, 17, 17],
          'circle-color': 'rgba(56, 189, 248, 0.28)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(56, 189, 248, 0.85)',
        },
      });

      // Crisp GPU-locked station dots (0px jitter during pan/zoom/follow!)
      mapInstance.addLayer({
        id: STATIONS_DOTS_LAYER_ID,
        type: 'circle',
        source: STATIONS_SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            [
              'case',
              ['==', ['get', 'isSelected'], 1],
              7.5,
              ['==', ['get', 'isMajorHub'], 1],
              4.0,
              2.4,
            ],
            13,
            [
              'case',
              ['==', ['get', 'isSelected'], 1],
              7.8,
              ['==', ['get', 'isMajorHub'], 1],
              5.4,
              3.8,
            ],
            16,
            [
              'case',
              ['==', ['get', 'isSelected'], 1],
              8.2,
              ['==', ['get', 'isMajorHub'], 1],
              6.4,
              5.0,
            ],
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            '#FFFFFF',
            isDark ? '#0B0F17' : '#FFFFFF',
          ],
          'circle-stroke-width': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            2.6,
            2,
          ],
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            '#38BDF8',
            ['get', 'ringColor'],
          ],
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10.6,
            ['case', ['any', ['==', ['get', 'isSelected'], 1], ['==', ['get', 'isMajorHub'], 1]], 1, 0],
            11.4,
            1,
          ],
          'circle-stroke-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10.6,
            ['case', ['any', ['==', ['get', 'isSelected'], 1], ['==', ['get', 'isMajorHub'], 1]], 1, 0],
            11.4,
            1,
          ],
        },
      });

      // Generous invisible touch/click target for every station dot
      mapInstance.addLayer({
        id: STATIONS_HIT_LAYER_ID,
        type: 'circle',
        source: STATIONS_SOURCE_ID,
        paint: {
          'circle-radius': 14,
          'circle-color': '#ffffff',
          'circle-opacity': 0,
        },
      });

      // GPU-rendered stop name labels with automatic collision avoidance (toggled via bottom-left button)
      mapInstance.addLayer({
        id: STATIONS_LABELS_LAYER_ID,
        type: 'symbol',
        source: STATIONS_SOURCE_ID,
        layout: {
          visibility: showStationLabels ? 'visible' : 'none',
          'text-field': ['get', 'shortLabel'],
          'text-font': textFont,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 14, 11.5, 16, 12.5],
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.85,
          'text-max-width': 12,
          'text-padding': 4,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-sort-key': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            0,
            ['==', ['get', 'isMajorHub'], 1],
            1,
            2,
          ],
        },
        paint: {
          'text-color': isDark ? '#F1F5F9' : '#0F172A',
          'text-halo-color': isDark ? 'rgba(9, 13, 22, 0.94)' : 'rgba(255, 255, 255, 0.95)',
          'text-halo-width': 1.8,
          'text-halo-blur': 0.4,
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11.2,
            ['case', ['any', ['==', ['get', 'isSelected'], 1], ['==', ['get', 'isMajorHub'], 1]], 1, 0],
            12.0,
            1,
          ],
        },
      });

      // Always-visible highlighted label for the currently selected or hovered station
      mapInstance.addLayer({
        id: STATIONS_ACTIVE_LABEL_LAYER_ID,
        type: 'symbol',
        source: STATIONS_SOURCE_ID,
        filter: ['==', ['get', 'id'], ''],
        layout: {
          'text-field': ['get', 'shortLabel'],
          'text-font': textFont,
          'text-size': 12.5,
          'text-anchor': 'bottom',
          'text-offset': [0, -1.0],
          'text-max-width': 16,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': [
            'case',
            ['==', ['get', 'isSelected'], 1],
            '#38BDF8',
            isDark ? '#FFFFFF' : '#0F172A',
          ],
          'text-halo-color': isDark ? 'rgba(5, 8, 16, 0.96)' : 'rgba(255, 255, 255, 0.96)',
          'text-halo-width': 2.2,
          'text-halo-blur': 0.3,
        },
      });
    }

    if (mapInstance.getLayer(STATIONS_LABELS_LAYER_ID)) {
      mapInstance.setLayoutProperty(
        STATIONS_LABELS_LAYER_ID,
        'visibility',
        showStationLabels ? 'visible' : 'none'
      );
    }
  }, [mapInstance, styleRevision, stationsGeoJson, showStationLabels, basemap]);

  // Keep selected/hovered station halo & active label synced without rebuilding GeoJSON
  useEffect(() => {
    if (!mapInstance || styleRevision === 0 || !mapInstance.getStyle()) return;
    const activeIds: string[] = [];
    if (selectedStation?.id) activeIds.push(selectedStation.id);
    if (hoveredStationId && hoveredStationId !== selectedStation?.id) {
      activeIds.push(hoveredStationId);
    }
    const filterExpr: maplibregl.FilterSpecification =
      activeIds.length > 0
        ? ['in', ['get', 'id'], ['literal', activeIds]]
        : ['==', ['get', 'id'], ''];

    if (mapInstance.getLayer(STATIONS_HALO_LAYER_ID)) {
      mapInstance.setFilter(STATIONS_HALO_LAYER_ID, filterExpr);
    }
    if (mapInstance.getLayer(STATIONS_ACTIVE_LABEL_LAYER_ID)) {
      mapInstance.setFilter(STATIONS_ACTIVE_LABEL_LAYER_ID, filterExpr);
    }
    if (mapInstance.getLayer(STATIONS_LABELS_LAYER_ID)) {
      const excludeActiveExpr: maplibregl.FilterSpecification =
        activeIds.length > 0
          ? ['!', ['in', ['get', 'id'], ['literal', activeIds]]]
          : ['!=', ['get', 'id'], ''];
      mapInstance.setFilter(STATIONS_LABELS_LAYER_ID, excludeActiveExpr);
    }
  }, [mapInstance, styleRevision, selectedStation?.id, hoveredStationId]);

  // Interactive click & hover handling on native WebGL station layer
  useEffect(() => {
    if (!mapInstance || styleRevision === 0) return;

    const handleStationClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const stationId = feature?.properties?.id as string | undefined;
      if (!stationId) return;
      const station = stationsByIdRef.current[stationId];
      if (station) {
        e.originalEvent.stopPropagation();
        onSelectStationRef.current(station);
      }
    };

    const handleStationMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const stationId = feature?.properties?.id as string | undefined;
      if (!stationId) return;
      hoveringStationRef.current = true;
      mapInstance.getCanvas().style.cursor = 'pointer';
      setHoveredRoute(null);
      setHoveredStationId((prev) => (prev === stationId ? prev : stationId));
    };

    const handleStationMouseLeave = () => {
      hoveringStationRef.current = false;
      mapInstance.getCanvas().style.cursor = '';
      setHoveredStationId(null);
    };

    mapInstance.on('click', STATIONS_HIT_LAYER_ID, handleStationClick);
    mapInstance.on('mousemove', STATIONS_HIT_LAYER_ID, handleStationMouseMove);
    mapInstance.on('mouseleave', STATIONS_HIT_LAYER_ID, handleStationMouseLeave);

    return () => {
      mapInstance.off('click', STATIONS_HIT_LAYER_ID, handleStationClick);
      mapInstance.off('mousemove', STATIONS_HIT_LAYER_ID, handleStationMouseMove);
      mapInstance.off('mouseleave', STATIONS_HIT_LAYER_ID, handleStationMouseLeave);
    };
  }, [mapInstance, styleRevision]);

  // Interactive desktop hover tooltip + highlight stroke on route polylines (rAF-throttled)
  useEffect(() => {
    if (!mapInstance || styleRevision === 0) return;

    let pendingHover: HoveredRouteTooltipState | null = null;
    let hoverRafId = 0;

    const flushHover = () => {
      hoverRafId = 0;
      const next = pendingHover;
      setHoveredRoute((prev) => {
        if (!next) return prev === null ? prev : null;
        if (
          prev &&
          prev.routeId === next.routeId &&
          Math.abs(prev.x - next.x) < 1.5 &&
          Math.abs(prev.y - next.y) < 1.5
        ) {
          return prev;
        }
        return next;
      });
    };

    const handleMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
      // Skip pointer hover tooltips on coarse touch screens or while hovering a station dot
      if (hoveringStationRef.current) return;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
      const feature = e.features?.[0];
      const routeId = feature?.properties?.routeId as string | undefined;
      if (!routeId) {
        pendingHover = null;
        if (!hoverRafId) hoverRafId = window.requestAnimationFrame(flushHover);
        return;
      }
      mapInstance.getCanvas().style.cursor = 'pointer';
      pendingHover = {
        routeId,
        x: e.point.x,
        y: e.point.y,
      };
      if (!hoverRafId) hoverRafId = window.requestAnimationFrame(flushHover);
    };

    const handleMouseLeave = () => {
      if (!hoveringStationRef.current) {
        mapInstance.getCanvas().style.cursor = '';
      }
      pendingHover = null;
      if (hoverRafId) {
        window.cancelAnimationFrame(hoverRafId);
        hoverRafId = 0;
      }
      setHoveredRoute(null);
    };

    const handleDragStart = () => {
      pendingHover = null;
      if (hoverRafId) {
        window.cancelAnimationFrame(hoverRafId);
        hoverRafId = 0;
      }
      setHoveredRoute(null);
    };

    mapInstance.on('mousemove', ROUTES_HIT_LAYER_ID, handleMouseMove);
    mapInstance.on('mouseleave', ROUTES_HIT_LAYER_ID, handleMouseLeave);
    mapInstance.on('dragstart', handleDragStart);

    return () => {
      if (hoverRafId) window.cancelAnimationFrame(hoverRafId);
      mapInstance.off('mousemove', ROUTES_HIT_LAYER_ID, handleMouseMove);
      mapInstance.off('mouseleave', ROUTES_HIT_LAYER_ID, handleMouseLeave);
      mapInstance.off('dragstart', handleDragStart);
    };
  }, [mapInstance, styleRevision]);

  // Keep hover highlight layer filter synced with hoveredRoute (and clear if route disabled)
  useEffect(() => {
    if (!mapInstance || !mapInstance.getStyle()) return;
    if (!mapInstance.getLayer(ROUTES_HOVER_LAYER_ID)) return;
    const activeHoverId =
      hoveredRoute && enabledRouteIds.has(hoveredRoute.routeId) ? hoveredRoute.routeId : '';
    mapInstance.setFilter(ROUTES_HOVER_LAYER_ID, ['==', ['get', 'routeId'], activeHoverId]);
  }, [mapInstance, styleRevision, hoveredRoute, enabledRouteIds]);

  // Build GeoJSON Point FeatureCollection for native GPU-accelerated Density Heatmap
  const densityGeoJson = useMemo<FeatureCollection<Point>>(() => {
    if (!showDensity || densityPoints.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    const densityScale =
      densityPoints.length <= 12
        ? 0.95
        : densityPoints.length <= 35
          ? 0.72
          : densityPoints.length <= 80
            ? 0.52
            : 0.38;

    return {
      type: 'FeatureCollection',
      features: densityPoints.map((pt) => ({
        type: 'Feature',
        properties: {
          weight: Math.min(1.6, Math.max(0.28, pt.weight * densityScale)),
        },
        geometry: {
          type: 'Point',
          coordinates: [pt.position.lng, pt.position.lat],
        },
      })),
    };
  }, [showDensity, densityPoints]);

  // Synchronize native GPU Density Heatmap layer into MapLibre GL
  useEffect(() => {
    if (!mapInstance || styleRevision === 0 || !mapInstance.getStyle()) return;

    const existingSource = mapInstance.getSource(DENSITY_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (existingSource) {
      existingSource.setData(densityGeoJson);
    } else {
      mapInstance.addSource(DENSITY_SOURCE_ID, {
        type: 'geojson',
        data: densityGeoJson,
      });

      const beforeStationLayer = mapInstance.getLayer(STATIONS_HALO_LAYER_ID)
        ? STATIONS_HALO_LAYER_ID
        : undefined;

      mapInstance.addLayer(
        {
          id: DENSITY_HEATMAP_LAYER_ID,
          type: 'heatmap',
          source: DENSITY_SOURCE_ID,
          layout: {
            visibility: showDensity ? 'visible' : 'none',
          },
          paint: {
            'heatmap-weight': ['get', 'weight'],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.95, 13, 1.35, 16, 1.8],
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10,
              22,
              12,
              34,
              14,
              50,
              16,
              68,
            ],
            'heatmap-opacity': basemap === 'dark' ? 0.85 : 0.72,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(14, 165, 233, 0)',
              0.14,
              'rgba(14, 165, 233, 0.38)',
              0.34,
              'rgba(20, 184, 166, 0.62)',
              0.58,
              'rgba(245, 158, 11, 0.80)',
              0.8,
              'rgba(249, 115, 22, 0.90)',
              1,
              'rgba(239, 68, 68, 0.96)',
            ],
          },
        },
        beforeStationLayer
      );
    }

    if (mapInstance.getLayer(DENSITY_HEATMAP_LAYER_ID)) {
      mapInstance.setLayoutProperty(
        DENSITY_HEATMAP_LAYER_ID,
        'visibility',
        showDensity ? 'visible' : 'none'
      );
      mapInstance.setPaintProperty(
        DENSITY_HEATMAP_LAYER_ID,
        'heatmap-opacity',
        basemap === 'dark' ? 0.85 : 0.72
      );
    }
  }, [mapInstance, styleRevision, densityGeoJson, showDensity, basemap]);

  // Synchronize vehicle marker lifecycle & precompute zero-allocation polyline tables
  useEffect(() => {
    if (!mapInstance) return;
    const store = vehicleMarkersRef.current;
    const activeIds = new Set<string>();
    const nowSec = getAnimationClockSec();
    const sampleOut = { lat: 0, lng: 0, bearing: 0 };

    for (const vehicle of visibleVehicles) {
      activeIds.add(vehicle.id);
      const existing = store[vehicle.id];
      const preparedPath =
        existing && existing.vehicle.segmentPath === vehicle.segmentPath
          ? existing.preparedPath
          : preparePolylinePath(vehicle.segmentPath);

      const progress = computeSegmentProgress(nowSec, vehicle.prevDepTime, vehicle.nextArrTime);
      samplePreparedPathInto(preparedPath, progress, sampleOut);
      const headingDeg = Math.round(sampleOut.bearing);
      const isSelected = selectedVehicle?.id === vehicle.id;
      const zIndex = isSelected ? '60' : vehicle.routeType === 0 ? '45' : '40';
      const shortHeadsign = formatShortStationLabel(vehicle.headsign);
      const shortNextStop = formatShortStationLabel(vehicle.nextStopName);
      const signature = `${locale}|${vehicle.routeShortName}|${vehicle.routeColor}|${vehicle.routeTextColor}|${isSelected}|${shortNextStop}`;
      const title = t('map.vehicleTooltip', {
        line: vehicle.routeShortName,
        headsign: shortHeadsign,
        stop: shortNextStop,
      });

      const segmentKey = `${vehicle.prevStopId}|${vehicle.nextStopId}`;

      if (existing) {
        const prevVehicle = existing.vehicle;
        const segmentChanged = existing.segmentKey !== segmentKey;
        existing.vehicle = vehicle;
        existing.preparedPath = preparedPath;
        existing.segmentKey = segmentKey;

        if (segmentChanged) {
          // Seamless handoff to the next consecutive segment keeps the vehicle locked ON the line
          const isConsecutiveNext = prevVehicle.nextStopId === vehicle.prevStopId;
          existing.displayProgress = isConsecutiveNext ? Math.min(progress, 0.04) : progress;
          samplePreparedPathInto(preparedPath, existing.displayProgress, sampleOut);
          existing.marker.setLngLat([sampleOut.lng, sampleOut.lat]);
          existing.lastLat = sampleOut.lat;
          existing.lastLng = sampleOut.lng;
          const nextHeading = Math.round(sampleOut.bearing);
          if (existing.headingEl && existing.lastHeadingDeg !== nextHeading) {
            existing.headingEl.style.transform = `rotate(${nextHeading}deg)`;
            existing.lastHeadingDeg = nextHeading;
          }
        } else if (
          isMotionPausedRef.current &&
          (Math.abs(existing.lastLat - sampleOut.lat) > 1e-7 ||
            Math.abs(existing.lastLng - sampleOut.lng) > 1e-7)
        ) {
          existing.displayProgress = progress;
          existing.marker.setLngLat([sampleOut.lng, sampleOut.lat]);
          existing.lastLat = sampleOut.lat;
          existing.lastLng = sampleOut.lng;
        }
        if (existing.signature !== signature) {
          existing.marker.getElement().style.zIndex = zIndex;
          updateVehicleElement(
            existing.el,
            vehicle.routeShortName,
            vehicle.routeColor,
            vehicle.routeTextColor,
            existing.lastHeadingDeg,
            isSelected,
            title
          );
          existing.signature = signature;
        }
      } else {
        const el = createVehicleElement(
          vehicle.routeShortName,
          vehicle.routeColor,
          vehicle.routeTextColor,
          headingDeg,
          isSelected,
          title
        );
        const vehId = vehicle.id;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const latest = vehicleMarkersRef.current[vehId]?.vehicle;
          if (latest) onSelectVehicleRef.current(latest);
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([sampleOut.lng, sampleOut.lat])
          .addTo(mapInstance);
        marker.getElement().style.zIndex = zIndex;

        store[vehicle.id] = {
          marker,
          el,
          headingEl: el.querySelector('.t2c-vehicle-heading') as HTMLElement | null,
          lastHeadingDeg: headingDeg,
          lastLat: sampleOut.lat,
          lastLng: sampleOut.lng,
          displayProgress: progress,
          segmentKey,
          signature,
          vehicle,
          preparedPath,
        };
      }
    }

    for (const id of Object.keys(store)) {
      if (!activeIds.has(id)) {
        store[id].marker.remove();
        delete store[id];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, visibleVehicles, selectedVehicle, locale, t]);

  // Smooth zero-allocation 30fps polyline-locked vehicle motion & per-axis dead-zone follow-camera loop
  useEffect(() => {
    if (!mapInstance || isMotionPaused || visibleVehicles.length === 0) return;

    let rafId = 0;
    let lastFrameMs = 0;
    let lastFollowMs = 0;
    const FRAME_INTERVAL_MS = 33; // ~30fps smooth glide with minimal CPU overhead
    const FOLLOW_INTERVAL_MS = 500;
    const MAX_SPEED_MPS = 28; // realistic speed cap along the polyline so polls never teleport
    const SMOOTH_K = 6; // exponential catch-up rate (1/s) along the track
    const MAX_TURN_DEG_S = 240;
    const sampleOut = { lat: 0, lng: 0, bearing: 0 };
    const coordPair: [number, number] = [0, 0];

    const step = (ts: number) => {
      rafId = window.requestAnimationFrame(step);
      if (document.hidden || ts - lastFrameMs < FRAME_INTERVAL_MS) return;
      const dtSec = Math.min(0.1, Math.max(0.016, (ts - lastFrameMs) / 1000));
      lastFrameMs = ts;

      const nowSec = Date.now() / 1000 + serverClockOffsetRef.current;
      const store = vehicleMarkersRef.current;
      const followedId = followVehicleRef.current ? selectedVehicleIdRef.current : null;
      const blend = 1 - Math.exp(-SMOOTH_K * dtSec);
      const maxTurnDeg = MAX_TURN_DEG_S * dtSec;

      for (const id in store) {
        const entry = store[id];
        const v = entry.vehicle;
        const targetProgress = computeSegmentProgress(nowSec, v.prevDepTime, v.nextArrTime);
        const totalLenM = Math.max(10, entry.preparedPath.totalLength);
        const deltaProg = targetProgress - entry.displayProgress;

        if (deltaProg > 1e-5) {
          const maxStepProg = (MAX_SPEED_MPS * dtSec) / totalLenM;
          const stepProg = Math.min(maxStepProg, Math.max(deltaProg * blend, 0));
          entry.displayProgress = Math.min(targetProgress, entry.displayProgress + stepProg);
        } else if (deltaProg < -1e-5) {
          // Real transit vehicles do not drive backwards on small delay updates: hold gently unless far off
          const backMeters = -deltaProg * totalLenM;
          if (backMeters > 120) {
            entry.displayProgress = targetProgress;
          }
        }

        // Always sample strictly ON the prepared route polyline -> 0m corner-cutting!
        samplePreparedPathInto(entry.preparedPath, entry.displayProgress, sampleOut);

        if (
          Math.abs(entry.lastLat - sampleOut.lat) > 1e-7 ||
          Math.abs(entry.lastLng - sampleOut.lng) > 1e-7
        ) {
          coordPair[0] = sampleOut.lng;
          coordPair[1] = sampleOut.lat;
          entry.marker.setLngLat(coordPair);
          entry.lastLat = sampleOut.lat;
          entry.lastLng = sampleOut.lng;
        }

        let dBear = (sampleOut.bearing - entry.lastHeadingDeg) % 360;
        if (dBear > 180) dBear -= 360;
        else if (dBear < -180) dBear += 360;
        let turn = dBear * blend;
        if (turn > maxTurnDeg) turn = maxTurnDeg;
        else if (turn < -maxTurnDeg) turn = -maxTurnDeg;
        const headingDeg = Math.round((entry.lastHeadingDeg + turn + 360) % 360);
        if (entry.headingEl && entry.lastHeadingDeg !== headingDeg) {
          entry.headingEl.style.transform = `rotate(${headingDeg}deg)`;
          entry.lastHeadingDeg = headingDeg;
        }

        if (
          followedId &&
          id === followedId &&
          !isUserInteractingRef.current &&
          ts - lastFollowMs >= FOLLOW_INTERVAL_MS
        ) {
          lastFollowMs = ts;
          const canvas = mapInstance.getCanvas();
          const width = canvas.clientWidth;
          const height = canvas.clientHeight;
          const pt = mapInstance.project([entry.lastLng, entry.lastLat]);
          const bottomInsetPx = window.innerWidth < 768 ? Math.round(height * 0.52) : 0;

          const shift = computeDeadZoneFollowShift({
            pointX: pt.x,
            pointY: pt.y,
            width,
            height,
            bottomInsetPx,
          });

          if (shift.shouldPan) {
            const nextCenter = mapInstance.unproject([shift.newCenterX, shift.newCenterY]);
            mapInstance.easeTo({
              center: [nextCenter.lng, nextCenter.lat],
              duration: 420,
              easing: easeOutCubic,
            });
          }
        }
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [mapInstance, isMotionPaused, visibleVehicles.length]);

  // Smooth camera transition animation when selecting a new station
  useEffect(() => {
    if (!mapInstance) return;

    const nextStationId = selectedStation?.id ?? null;
    if (nextStationId === lastFocusedStationIdRef.current) return;
    const hadPreviousSelection = lastFocusedStationIdRef.current !== null;
    lastFocusedStationIdRef.current = nextStationId;

    if (!selectedStation) {
      if (hadPreviousSelection) {
        mapInstance.easeTo({
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          duration: 320,
          easing: easeOutCubic,
        });
      }
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      mapInstance.resize();
      mapInstance.stop();

      const c = mapInstance.getCenter();
      const rect = containerRef.current?.getBoundingClientRect();
      const viewportWidthPx = window.innerWidth;
      const viewportHeightPx = rect?.height || window.innerHeight;
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const plan = computeStationCameraPlan({
        currentCenter: { lat: c.lat, lng: c.lng },
        currentZoom: mapInstance.getZoom(),
        target: { lat: selectedStation.lat, lng: selectedStation.lng },
        isMajorHub: selectedStation.isMajorHub,
        viewportWidthPx,
        viewportHeightPx,
        hasMobileBottomSheet: viewportWidthPx < 768,
        prefersReducedMotion,
      });

      if (plan.mode === 'jump') {
        mapInstance.jumpTo({
          center: plan.center,
          zoom: plan.zoom,
          padding: plan.padding,
        });
      } else if (plan.mode === 'ease') {
        mapInstance.easeTo({
          center: plan.center,
          zoom: plan.zoom,
          padding: plan.padding,
          duration: plan.durationMs,
          easing: easeOutCubic,
          essential: true,
        });
      } else {
        mapInstance.flyTo({
          center: plan.center,
          zoom: plan.zoom,
          padding: plan.padding,
          duration: plan.durationMs,
          curve: plan.curve,
          easing: easeOutCubic,
          essential: true,
        });
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [mapInstance, selectedStation]);

  // Snap camera smoothly when user selects a vehicle or toggles Follow ON (respecting mobile bottom sheet)
  useEffect(() => {
    if (!mapInstance || !followVehicle || !selectedVehicle) return;
    const rafId = window.requestAnimationFrame(() => {
      mapInstance.resize();
      const existing = vehicleMarkersRef.current[selectedVehicle.id];
      let lng: number;
      let lat: number;
      if (existing) {
        lng = existing.lastLng;
        lat = existing.lastLat;
      } else {
        const nowSec = getAnimationClockSec();
        const progress = computeSegmentProgress(
          nowSec,
          selectedVehicle.prevDepTime,
          selectedVehicle.nextArrTime
        );
        const { position } = interpolateAlongPath(selectedVehicle.segmentPath, progress);
        lng = position.lng;
        lat = position.lat;
      }

      const rect = containerRef.current?.getBoundingClientRect();
      const isMobile = window.innerWidth < 768;
      const padding = isMobile
        ? {
            top: 56,
            bottom: Math.round(Math.min((rect?.height || window.innerHeight) * 0.54, 460)),
            left: 20,
            right: 20,
          }
        : { top: 0, bottom: 0, left: 0, right: 0 };

      mapInstance.easeTo({
        center: [lng, lat],
        padding,
        duration: 500,
        easing: easeOutCubic,
      });
    });

    return () => window.cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, followVehicle, selectedVehicle?.id]);

  // Clear mobile bottom padding when vehicle inspector closes
  const hadSelectedVehicleRef = useRef(false);
  useEffect(() => {
    const hasVeh = Boolean(selectedVehicle);
    if (!hasVeh && hadSelectedVehicleRef.current && mapInstance && !selectedStation) {
      mapInstance.easeTo({
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: 300,
        easing: easeOutCubic,
      });
    }
    hadSelectedVehicleRef.current = hasVeh;
  }, [mapInstance, selectedVehicle, selectedStation]);

  const handleZoomIn = () => mapInstance?.zoomIn({ duration: 220 });
  const handleZoomOut = () => mapInstance?.zoomOut({ duration: 220 });
  const handleRecenter = () => {
    mapInstance?.easeTo({
      center: [CLERMONT_CENTER.lng, CLERMONT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 650,
      easing: easeOutCubic,
    });
  };
  const handlePanTo = (pos: LatLngPoint, minZoom = 14) => {
    if (!mapInstance) return;
    mapInstance.easeTo({
      center: [pos.lng, pos.lat],
      zoom: Math.max(mapInstance.getZoom(), minZoom),
      duration: 550,
      easing: easeOutCubic,
    });
  };

  return (
    <div
      data-testid="transit-map-viewport"
      data-active-vehicles={visibleVehicles.length}
      data-visible-stations={activeStations.length}
      data-basemap={basemap}
      data-density-active={showDensity ? 'true' : 'false'}
      data-station-labels={showStationLabels ? 'on' : 'off'}
      data-camera-zoom={viewport.zoom.toFixed(2)}
      data-camera-lat={viewport.center.lat.toFixed(5)}
      data-camera-lng={viewport.center.lng.toFixed(5)}
      data-camera-animating={viewport.isAnimating ? 'true' : 'false'}
      className="relative flex-1 h-full min-h-0 bg-[#0B0F17]"
    >
      {/* High-DPI Open-Source MapLibre GL Vector Map Surface */}
      <div
        ref={containerRef}
        className="w-full h-full z-0"
        aria-label={t('map.aria')}
      />

      {/* Top-left live telemetry summary (compact on mobile so it never collides with Density toggle) */}
      <div
        data-testid="map-telemetry-strip"
        data-feed-state={feedHealth.state}
        className={`pointer-events-none absolute top-3 left-3 sm:top-3.5 sm:left-3.5 z-20 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#0F1522]/92 border backdrop-blur-md text-[11px] sm:text-xs text-slate-300 shadow-xl ring-1 ring-white/[0.04] max-w-[calc(100vw-8.5rem)] transition-colors ${
          feedHealth.state === 'unreachable'
            ? 'border-rose-500/45'
            : feedHealth.state === 'stale'
              ? 'border-amber-500/45'
              : 'border-slate-700/75'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            feedHealth.state === 'unreachable'
              ? 'bg-rose-400'
              : feedHealth.state === 'stale'
                ? 'bg-amber-400'
                : feedHealth.state === 'connecting'
                  ? 'bg-slate-400 animate-pulse'
                  : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
          }`}
          aria-hidden="true"
        />
        <span className="font-mono-tabular font-medium text-white whitespace-nowrap">
          {visibleVehicles.length}
          <span className="hidden sm:inline">
            {' '}
            {visibleVehicles.length === 1
              ? t('map.vehicleMovingSingular')
              : t('map.vehiclesMoving')}
          </span>
          <span className="sm:hidden"> {t('map.vehiclesLiveShort')}</span>
        </span>
        <span className="text-slate-600" aria-hidden="true">
          ·
        </span>
        <span className="font-mono-tabular text-slate-400 whitespace-nowrap">
          {enabledRouteIds.size}{' '}
          {enabledRouteIds.size === 1 ? t('map.lineSingular') : t('map.linePlural')}
        </span>
        <span className="text-slate-600" aria-hidden="true">
          ·
        </span>
        <span
          className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${
            feedHealth.state === 'unreachable'
              ? 'text-rose-400'
              : feedHealth.state === 'stale'
                ? 'text-amber-400'
                : feedHealth.state === 'connecting'
                  ? 'text-slate-400'
                  : 'text-emerald-400'
          }`}
        >
          {feedHealth.state === 'unreachable' && (
            <WifiOff className="w-3 h-3 shrink-0" aria-hidden="true" />
          )}
          {feedHealth.state === 'stale' && (
            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{feedHealth.compactLabel}</span>
          <span className="sm:hidden">{feedHealth.shortLabel}</span>
        </span>
      </div>

      {/* Top-right Density Heatmap Layer Toggle & Legend Panel */}
      <div className="absolute top-3 right-3 sm:top-3.5 sm:right-3.5 z-20 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={onToggleDensity}
          aria-pressed={showDensity}
          aria-label={showDensity ? t('map.densityHideAria') : t('map.densityShowAria')}
          title={showDensity ? t('map.densityHideTitle') : t('map.densityShowTitle')}
          data-testid="density-layer-toggle"
          className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-medium border shadow-xl ring-1 ring-white/[0.04] backdrop-blur-md transition-colors whitespace-nowrap ${
            showDensity
              ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-100 border-orange-500/60'
              : 'bg-[#0F1522]/92 hover:bg-slate-800/95 text-slate-200 border-slate-700/75'
          }`}
        >
          <Flame
            className={`w-3.5 h-3.5 shrink-0 ${
              showDensity ? 'text-orange-400' : 'text-slate-400'
            }`}
            aria-hidden="true"
          />
          <span>{t('map.densityLabel')}</span>
        </button>

        {showDensity && densitySummary && (
          <div
            data-testid="density-legend-panel"
            className="w-[min(16.5rem,calc(100vw-1.5rem))] rounded-lg bg-[#0F1522]/95 border border-slate-800/90 backdrop-blur-sm shadow-2xl p-3 text-xs text-slate-200 space-y-2.5"
          >
            {/* Header & Metric Mode Switch */}
            <div className="flex items-center justify-between gap-2">
              <span className="font-display font-semibold text-white text-[12px] truncate">
                {t('map.densityTitle')}
              </span>
              <div className="inline-flex p-0.5 rounded bg-[#090D16] border border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => setDensityMetric('congestion')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                    densityMetric === 'congestion'
                      ? 'bg-slate-800 text-orange-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('map.densityCongestion')}
                </button>
                <button
                  type="button"
                  onClick={() => setDensityMetric('volume')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                    densityMetric === 'volume'
                      ? 'bg-slate-800 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('map.densityVolume')}
                </button>
              </div>
            </div>

            {/* Scope Switch: Full Network vs Active Lines */}
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-400 font-mono-tabular whitespace-nowrap truncate">
                {densitySummary.totalVehicles}{' '}
                {densitySummary.totalVehicles === 1
                  ? t('map.unitSingular')
                  : t('map.unitPlural')}
                {densitySummary.delayedVehicles > 0
                  ? ` · ${t('map.delayedCount', { count: densitySummary.delayedVehicles })}`
                  : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDensityScope((s) => (s === 'network' ? 'active-lines' : 'network'))
                }
                className="text-[11px] font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0"
              >
                {densityScope === 'network'
                  ? t('map.scopeFullNetwork')
                  : t('map.scopeActiveLines')}
              </button>
            </div>

            {/* Thermal Gradient Legend Bar */}
            <div className="space-y-1">
              <div
                className="h-2 w-full rounded-sm"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(14,165,233,0.45) 0%, #0EA5E9 20%, #14B8A6 42%, #F59E0B 64%, #F97316 82%, #EF4444 100%)',
                }}
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>{t('map.scaleLow')}</span>
                <span>{t('map.scaleModerate')}</span>
                <span>
                  {densityMetric === 'congestion'
                    ? t('map.scaleCongested')
                    : t('map.scalePeak')}
                </span>
              </div>
            </div>

            {/* Live Clermont-Ferrand Hotspots */}
            {densitySummary.hotspots.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1">
                <div className="text-[11px] font-medium text-slate-400">
                  {t('map.peakSectors')}
                </div>
                {densitySummary.hotspots.map((hs) => {
                  const delayMin = Math.round(hs.avgDelaySec / 60);
                  const sectorMatch = /^Sector (\d+)$/.exec(hs.zoneName);
                  const localizedZoneName = sectorMatch
                    ? t('map.sectorFallback', { num: sectorMatch[1] })
                    : formatShortStationLabel(hs.zoneName);
                  return (
                    <button
                      key={hs.id}
                      type="button"
                      onClick={() => handlePanTo(hs.center, 14.2)}
                      className="w-full flex items-center justify-between gap-2 px-1.5 py-1.5 sm:py-1 rounded hover:bg-slate-800/80 text-left transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-slate-100 truncate">
                          {localizedZoneName}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {t('map.linesPrefix', { lines: hs.routeShortNames.join(', ') })}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono-tabular">
                        <div className="text-[11px] font-semibold text-orange-300">
                          {hs.vehicleCount}{' '}
                          {hs.vehicleCount === 1 ? t('map.unitSingular') : t('map.unitPlural')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {delayMin >= 2
                            ? t('map.avgDelayShort', { mins: delayMin })
                            : t('map.onTime')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom-left Stop Names Toggle Button (cleanly positioned above compact MapLibre attribution) */}
      <div className="absolute bottom-11 left-2.5 sm:bottom-11 sm:left-3.5 z-20">
        <button
          type="button"
          onClick={onToggleStationLabels}
          aria-pressed={showStationLabels}
          aria-label={showStationLabels ? t('map.hideLabelsAria') : t('map.showLabelsAria')}
          title={t('map.labelsTitle')}
          data-testid="station-labels-toggle-btn"
          className={`inline-flex items-center gap-1.5 h-9 sm:h-9 px-2.5 sm:px-3 rounded-xl text-[11px] sm:text-xs font-medium border shadow-xl ring-1 ring-white/[0.04] backdrop-blur-md transition-colors whitespace-nowrap ${
            showStationLabels
              ? 'bg-sky-500/22 hover:bg-sky-500/30 text-sky-100 border-sky-400/60'
              : 'bg-[#0F1522]/94 hover:bg-slate-800/95 text-slate-200 border-slate-700/75'
          }`}
        >
          <Type
            className={`w-3.5 h-3.5 shrink-0 ${
              showStationLabels ? 'text-sky-300' : 'text-slate-400'
            }`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{t('map.labelsShort')}</span>
          <span className="sm:hidden">{t('map.labelsCompact')}</span>
        </button>
      </div>

      {/* Bottom-right Map Controls (40px touch targets on mobile, 36px on desktop) */}
      <div className="absolute bottom-6 right-3 sm:bottom-7 sm:right-3.5 z-20 flex flex-col gap-2">
        <div className="flex flex-col rounded-xl overflow-hidden bg-[#0F1522]/94 border border-slate-700/75 shadow-xl ring-1 ring-white/[0.04] backdrop-blur-md divide-y divide-slate-800/80">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label={t('map.zoomInAria')}
            title={t('map.zoomInAria')}
            className="w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label={t('map.zoomOutAria')}
            title={t('map.zoomOutAria')}
            className="w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRecenter}
            aria-label={t('map.recenterAria')}
            title={t('map.recenterAria')}
            className="w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col rounded-xl overflow-hidden bg-[#0F1522]/94 border border-slate-700/75 shadow-xl ring-1 ring-white/[0.04] backdrop-blur-md divide-y divide-slate-800/80">
          <button
            type="button"
            onClick={onToggleBasemap}
            aria-label={
              basemap === 'dark' ? t('map.switchToStreetAria') : t('map.switchToDarkAria')
            }
            aria-pressed={basemap === 'liberty'}
            data-testid="basemap-toggle-btn"
            title={t('map.basemapTitle', {
              label:
                basemap === 'dark'
                  ? t('map.basemapDarkLabel')
                  : t('map.basemapStreetLabel'),
            })}
            className={`w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center transition-colors ${
              basemap === 'liberty'
                ? 'text-sky-400 hover:bg-slate-800'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleStops}
            aria-label={showStops ? t('map.hideStopsAria') : t('map.showStopsAria')}
            aria-pressed={showStops}
            title={showStops ? t('map.hideStopsAria') : t('map.showStopsAria')}
            className={`w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center transition-colors ${
              showStops
                ? 'text-sky-400 hover:bg-slate-800'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {showStops ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleMotionPaused}
            aria-label={isMotionPaused ? t('map.resumeMotionAria') : t('map.pauseMotionAria')}
            aria-pressed={isMotionPaused}
            title={isMotionPaused ? t('map.resumeMotionTitle') : t('map.pauseMotionTitle')}
            className={`w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center transition-colors ${
              isMotionPaused
                ? 'text-amber-400 hover:bg-slate-800'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            {isMotionPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Desktop Floating Route Hover Tooltip */}
      {(() => {
        if (!hoveredRoute || !enabledRouteIds.has(hoveredRoute.routeId)) return null;
        const route = routesById[hoveredRoute.routeId];
        if (!route) return null;
        const liveCount = activeCountByRoute[route.id] || 0;
        const alertCount = activeAlertCountByRoute?.[route.id] || 0;
        const containerW = containerRef.current?.clientWidth || 800;
        const containerH = containerRef.current?.clientHeight || 600;
        const left = Math.min(Math.max(12, hoveredRoute.x + 14), Math.max(12, containerW - 252));
        const top = Math.min(Math.max(56, hoveredRoute.y - 12), Math.max(56, containerH - 92));
        const routeTypeLabel =
          route.routeType === 0 ? 'Tramway' : route.tier === 'core' ? 'BHNS' : 'Bus';
        const endpoints = route.headsigns.slice(0, 2).join(' ↔ ') || route.description;

        return (
          <div
            data-testid="route-hover-tooltip"
            style={{ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }}
            className="hidden md:block pointer-events-none absolute z-30 w-60 rounded-lg bg-[#0F1522]/96 border border-slate-700/90 backdrop-blur-md shadow-2xl px-3 py-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <RouteBadge
                  shortName={route.shortName}
                  color={route.color}
                  textColor={route.textColor}
                  size="xs"
                />
                <span className="font-display font-semibold text-white truncate">
                  {routeTypeLabel} {route.shortName}
                </span>
              </div>
              <span
                className={`font-mono-tabular text-[11px] font-medium whitespace-nowrap ${
                  liveCount > 0 ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {t('map.hoverLiveCount', { count: liveCount })}
              </span>
            </div>
            {endpoints && (
              <div className="text-[11px] text-slate-300 mt-1 truncate">{endpoints}</div>
            )}
            {alertCount > 0 && (
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-300">
                <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>
                  {alertCount === 1
                    ? t('map.hoverAdvisoryOne')
                    : t('map.hoverAdvisoryMany', { count: alertCount })}
                </span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
});

TransitMap.displayName = 'TransitMap';
