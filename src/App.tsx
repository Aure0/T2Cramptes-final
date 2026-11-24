import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronUp,
  Download,
  Menu,
  RefreshCw,
  Search,
  Smartphone,
  Star,
  X,
} from 'lucide-react';
import { ClermontClock } from './components/ClermontClock';
import { ControlSidebar, type SidebarTab } from './components/ControlSidebar';
import { DetailInspector } from './components/DetailInspector';
import { NetworkStatusIndicator } from './components/NetworkStatusIndicator';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton, PWAInstallGuideModal } from './components/PWAInstallButton';
import { RouteBadge } from './components/RouteBadge';
import { usePWAInstall } from './hooks/usePWAInstall';
import type {
  LiveTrafficResponse,
  LiveVehicle,
  NetworkSnapshot,
  ServiceAlertsResponse,
  StationArrivalsResponse,
  TransitRoute,
  TransitStation,
} from './types/transit';
import {
  fetchLiveTransitTraffic,
  fetchServiceAlertsData,
  fetchStationArrivalsData,
  fetchTransitNetwork,
} from './services/transitClient';
import { I18nProvider } from './contexts/I18nContext';
import { filterAlertsByActiveRoutes } from './utils/alertsMath';
import { resolveAndroidBackAction } from './utils/androidBackNav';
import { ANDROID_APK_ASSET_NAME } from './utils/apkReleaseUrl';
import { evaluateFeedHealth } from './utils/feedHealth';
import {
  detectBestLocale,
  getBrowserLanguages,
  translate,
  type AppLocale,
  type TranslationKey,
} from './utils/i18n';
import { formatShortStationLabel, normalizeSearchText } from './utils/transitMath';
import {
  buildUrlSearchString,
  loadUserPreferences,
  parseUrlSearchParams,
  resolveRouteTokensToIds,
  saveUserPreferences,
  toggleFavoriteId,
  type BasemapStyle,
} from './utils/userPreferences';

const TransitMap = lazy(() =>
  import('./components/TransitMap').then((m) => ({
    default: m.TransitMap,
  }))
);

const ServiceAlertsDrawer = lazy(() =>
  import('./components/ServiceAlertsDrawer').then((m) => ({
    default: m.ServiceAlertsDrawer,
  }))
);

const DEFAULT_ENABLED_ROUTES = ['A', 'B', 'C'];
const DEFAULT_ENABLED_ROUTE_SET = new Set(DEFAULT_ENABLED_ROUTES);
const LIVE_POLL_INTERVAL_MS = 12_000;
const ALERTS_POLL_INTERVAL_MS = 30_000;
const HEALTH_CLOCK_TICK_MS = 5_000;

const EMPTY_ROUTES: TransitRoute[] = [];
const EMPTY_STATIONS: TransitStation[] = [];
const EMPTY_VEHICLES: LiveVehicle[] = [];
const EMPTY_COUNTS: Record<string, number> = {};

export default function App() {
  // Hydrate initial preferences from localStorage + URL query params (URL takes precedence)
  const initialBootstrapRef = useRef<{
    prefs: ReturnType<typeof loadUserPreferences>;
    url: ReturnType<typeof parseUrlSearchParams>;
  } | null>(null);
  if (!initialBootstrapRef.current) {
    const prefs = loadUserPreferences();
    const url = parseUrlSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    initialBootstrapRef.current = { prefs, url };
  }
  const hasHydratedNetworkRef = useRef(false);

  // Language state: auto-detects from ?lang=, saved user preference, or browser languages
  const [savedLocale, setSavedLocale] = useState<AppLocale | null>(
    () => initialBootstrapRef.current!.prefs.locale ?? null
  );
  const [explicitUrlLocale, setExplicitUrlLocale] = useState<AppLocale | null>(
    () =>
      initialBootstrapRef.current!.url.lang ??
      initialBootstrapRef.current!.prefs.locale ??
      null
  );
  const [locale, setLocale] = useState<AppLocale>(() =>
    detectBestLocale({
      urlLocale: initialBootstrapRef.current!.url.lang,
      savedLocale: initialBootstrapRef.current!.prefs.locale ?? null,
      browserLanguages: getBrowserLanguages(),
    })
  );

  const handleChangeLocale = useCallback((next: AppLocale) => {
    setLocale(next);
    setSavedLocale(next);
    setExplicitUrlLocale(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale]
  );

  // Static network & live traffic state
  const [network, setNetwork] = useState<NetworkSnapshot | null>(null);
  const [liveTraffic, setLiveTraffic] = useState<LiveTrafficResponse | null>(null);
  const [isLoadingNetwork, setIsLoadingNetwork] = useState(true);
  const [isRefreshingLive, setIsRefreshingLive] = useState(false);
  const [networkErrorKey, setNetworkErrorKey] = useState<TranslationKey | null>(null);

  // Live feed connectivity & freshness telemetry
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastLiveSuccessAtMs, setLastLiveSuccessAtMs] = useState<number | null>(null);
  const [consecutiveLiveFailures, setConsecutiveLiveFailures] = useState(0);
  const [lastLiveError, setLastLiveError] = useState<string | null>(null);
  const [healthClockMs, setHealthClockMs] = useState<number>(() => Date.now());

  // Persistent user preferences & map view toggles
  const [favoriteStationList, setFavoriteStationList] = useState<string[]>(
    () => initialBootstrapRef.current!.prefs.favoriteStationIds
  );
  const [basemap, setBasemap] = useState<BasemapStyle>(
    () =>
      initialBootstrapRef.current!.url.basemap ??
      initialBootstrapRef.current!.prefs.basemap
  );
  const [showStops, setShowStops] = useState<boolean>(
    () => initialBootstrapRef.current!.prefs.showStops
  );
  const [showStationLabels, setShowStationLabels] = useState<boolean>(
    () => initialBootstrapRef.current!.prefs.showStationLabels
  );
  const [showDensity, setShowDensity] = useState<boolean>(
    () =>
      initialBootstrapRef.current!.url.showDensity ??
      initialBootstrapRef.current!.prefs.showDensity
  );

  // Interactive selections & filters
  const [enabledRouteIds, setEnabledRouteIds] = useState<Set<string>>(() => {
    const boot = initialBootstrapRef.current!;
    if (boot.url.lines !== null) {
      return new Set(boot.url.lines);
    }
    if (boot.prefs.enabledRouteIds !== null) {
      return new Set(boot.prefs.enabledRouteIds);
    }
    return new Set(DEFAULT_ENABLED_ROUTES);
  });
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('lines');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHighlightIdx, setSearchHighlightIdx] = useState(0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);

  // Station arrival inspector state
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [stationArrivals, setStationArrivals] = useState<StationArrivalsResponse | null>(null);
  const [isLoadingStation, setIsLoadingStation] = useState(false);
  const [stationErrorKey, setStationErrorKey] = useState<TranslationKey | null>(null);

  // Vehicle tracking state
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [followVehicle, setFollowVehicle] = useState(false);

  // GTFS-RT / T2C Service Alerts & Disruption History state
  const [serviceAlerts, setServiceAlerts] = useState<ServiceAlertsResponse | null>(null);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const [alertsErrorKey, setAlertsErrorKey] = useState<TranslationKey | null>(null);
  const [alertsDrawerOpen, setAlertsDrawerOpen] = useState(false);
  const [alertsDrawerRouteFilter, setAlertsDrawerRouteFilter] = useState<string | null>(null);

  // Android / PWA installation state
  const pwaInstall = usePWAInstall();
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [mobileInstallBannerDismissed, setMobileInstallBannerDismissed] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const stationAbortRef = useRef<AbortController | null>(null);

  // Unified 1Hz wall clock + stable server clock offset for smooth 30fps map interpolation
  const [isMotionPaused, setIsMotionPaused] = useState(false);
  const [serverClockOffsetSec, setServerClockOffsetSec] = useState<number>(0);
  const nowEpochSec = healthClockMs / 1000 + serverClockOffsetSec;

  // Load static T2C GTFS network topology once on mount
  const fetchNetwork = useCallback(async () => {
    setIsLoadingNetwork(true);
    setNetworkErrorKey(null);
    try {
      const data = await fetchTransitNetwork();
      setNetwork(data);
    } catch {
      setNetworkErrorKey('error.loadNetwork');
    } finally {
      setIsLoadingNetwork(false);
    }
  }, []);

  // Poll live GTFS-RT traffic (Express proxy locally, or direct GTFS-RT in static GitHub Pages mode)
  const fetchLiveTraffic = useCallback(async (force = false) => {
    setIsRefreshingLive(true);
    try {
      const data = await fetchLiveTransitTraffic(force);
      const now = Date.now();
      const nextOffset = data.serverNowSeconds - now / 1000;
      setServerClockOffsetSec(nextOffset);
      setLiveTraffic(data);
      setLastLiveSuccessAtMs(now);
      setHealthClockMs(now);
      setConsecutiveLiveFailures(0);
      setLastLiveError(null);
    } catch (err) {
      // Keep last known live positions while surfacing stale/unreachable status
      setConsecutiveLiveFailures((n) => n + 1);
      setLastLiveError(err instanceof Error ? err.message : null);
      setHealthClockMs(Date.now());
    } finally {
      setIsRefreshingLive(false);
    }
  }, []);

  // Fetch live station arrivals for the currently selected station (cancels stale requests)
  const fetchStationArrivals = useCallback(async (stationId: string) => {
    stationAbortRef.current?.abort();
    const controller = new AbortController();
    stationAbortRef.current = controller;

    setIsLoadingStation(true);
    setStationErrorKey(null);
    try {
      const data = await fetchStationArrivalsData(stationId, controller.signal);
      if (!controller.signal.aborted) {
        setStationArrivals(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        setStationErrorKey('error.loadStation');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingStation(false);
      }
    }
  }, []);

  // Fetch Service Alerts & Disruption History (Express proxy locally, or static snapshot on GitHub Pages)
  const fetchServiceAlerts = useCallback(async (force = false) => {
    setIsLoadingAlerts(true);
    setAlertsErrorKey(null);
    try {
      const data = await fetchServiceAlertsData(force);
      setServiceAlerts(data);
    } catch {
      setAlertsErrorKey('error.loadAlerts');
    } finally {
      setIsLoadingAlerts(false);
    }
  }, []);

  useEffect(() => {
    fetchNetwork();
    fetchLiveTraffic(false);
    fetchServiceAlerts(false);
  }, [fetchNetwork, fetchLiveTraffic, fetchServiceAlerts]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.hidden) return;
      fetchLiveTraffic(false);
      if (selectedStationId) {
        fetchStationArrivals(selectedStationId);
      }
    }, LIVE_POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [fetchLiveTraffic, fetchStationArrivals, selectedStationId]);

  useEffect(() => {
    const pollAlerts = setInterval(() => {
      if (document.hidden) return;
      fetchServiceAlerts(false);
    }, ALERTS_POLL_INTERVAL_MS);
    return () => clearInterval(pollAlerts);
  }, [fetchServiceAlerts]);

  // Immediately resync feeds when user switches back to this browser tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      setHealthClockMs(Date.now());
      fetchLiveTraffic(false);
      fetchServiceAlerts(false);
      if (selectedStationId) {
        fetchStationArrivals(selectedStationId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchLiveTraffic, fetchServiceAlerts, fetchStationArrivals, selectedStationId]);

  // 5s ticker for ETA minute countdowns and feed freshness aging (header clock ticks independently at 1Hz)
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) {
        setHealthClockMs(Date.now());
      }
    }, HEALTH_CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Abort any in-flight station request on unmount
  useEffect(() => {
    return () => stationAbortRef.current?.abort();
  }, []);

  // Track browser online / offline connectivity transitions
  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true);
      setHealthClockMs(Date.now());
      fetchLiveTraffic(true);
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
      setHealthClockMs(Date.now());
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchLiveTraffic]);

  // Lookup dictionaries (avoiding Map shadowing)
  const routesById = useMemo(() => {
    const rec: Record<string, TransitRoute> = {};
    for (const r of network?.routes || []) rec[r.id] = r;
    return rec;
  }, [network]);

  const stationsById = useMemo(() => {
    const rec: Record<string, TransitStation> = {};
    for (const s of network?.stations || []) rec[s.id] = s;
    return rec;
  }, [network]);

  const vehiclesById = useMemo(() => {
    const rec: Record<string, LiveVehicle> = {};
    for (const v of liveTraffic?.vehicles || []) rec[v.id] = v;
    return rec;
  }, [liveTraffic]);

  const selectedStation = selectedStationId ? stationsById[selectedStationId] ?? null : null;
  const selectedVehicle = selectedVehicleId ? vehiclesById[selectedVehicleId] ?? null : null;

  const favoriteStationIds = useMemo(
    () => new Set(favoriteStationList),
    [favoriteStationList]
  );

  // Hydrate URL query parameters (?lines=..., ?station=...) against loaded GTFS topology once
  useEffect(() => {
    if (!network || hasHydratedNetworkRef.current) return;
    hasHydratedNetworkRef.current = true;
    const boot = initialBootstrapRef.current;
    if (!boot) return;

    if (boot.url.lines !== null) {
      const resolved = resolveRouteTokensToIds(boot.url.lines, network.routes);
      setEnabledRouteIds(new Set(resolved));
    } else if (boot.prefs.enabledRouteIds !== null) {
      const resolved = resolveRouteTokensToIds(boot.prefs.enabledRouteIds, network.routes);
      if (resolved.length > 0 || boot.prefs.enabledRouteIds.length === 0) {
        setEnabledRouteIds(new Set(resolved));
      }
    }

    if (boot.url.stationId) {
      const targetStation = network.stations.find((s) => s.id === boot.url.stationId);
      if (targetStation) {
        setSelectedStationId(targetStation.id);
        fetchStationArrivals(targetStation.id);
      }
    }
  }, [network, fetchStationArrivals]);

  // Persist user preferences to localStorage (persist locale immediately even before network finishes loading)
  useEffect(() => {
    if (!hasHydratedNetworkRef.current) {
      if (savedLocale !== null) {
        const currentPrefs = loadUserPreferences();
        saveUserPreferences({ ...currentPrefs, locale: savedLocale });
      }
      return;
    }
    saveUserPreferences({
      favoriteStationIds: favoriteStationList,
      enabledRouteIds: Array.from(enabledRouteIds),
      basemap,
      showStops,
      showStationLabels,
      showDensity,
      locale: savedLocale,
    });
  }, [
    network,
    favoriteStationList,
    enabledRouteIds,
    basemap,
    showStops,
    showStationLabels,
    showDensity,
    savedLocale,
  ]);

  // Sync shareable view state into URL query parameters cleanly via replaceState
  useEffect(() => {
    if (!network || !hasHydratedNetworkRef.current) return;
    const nextSearch = buildUrlSearchString({
      enabledRouteIds,
      defaultRouteIds: DEFAULT_ENABLED_ROUTE_SET,
      routes: network.routes,
      selectedStationId,
      basemap,
      showDensity,
      lang: explicitUrlLocale,
    });
    const currentSearch = window.location.search || '';
    if (nextSearch !== currentSearch) {
      const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [network, enabledRouteIds, selectedStationId, basemap, showDensity, explicitUrlLocale]);

  // Pre-normalized search strings for accent-insensitive French transit search
  const normalizedRoutesIndex = useMemo(
    () =>
      (network?.routes || EMPTY_ROUTES).map((r) => ({
        route: r,
        text: normalizeSearchText(`${r.shortName} ${r.description} ${r.headsigns.join(' ')}`),
        shortNorm: normalizeSearchText(r.shortName),
      })),
    [network]
  );

  const normalizedStationsIndex = useMemo(
    () =>
      (network?.stations || EMPTY_STATIONS).map((s) => ({
        station: s,
        text: normalizeSearchText(s.name),
      })),
    [network]
  );

  // Quick search suggestions (stations, routes, or pinned favorites when query is empty)
  const searchResults = useMemo(() => {
    const q = normalizeSearchText(searchQuery);
    if (!network) {
      return {
        stations: EMPTY_STATIONS,
        routes: EMPTY_ROUTES,
        pinnedOnly: false,
      };
    }

    if (!q) {
      const pinned = favoriteStationList
        .map((id) => stationsById[id])
        .filter((s): s is TransitStation => Boolean(s))
        .slice(0, 6);
      return {
        stations: pinned,
        routes: EMPTY_ROUTES,
        pinnedOnly: true,
      };
    }

    const matchedRoutes = normalizedRoutesIndex
      .filter((entry) => entry.text.includes(q))
      .sort((a, b) => {
        const aExact = a.shortNorm === q ? 1 : 0;
        const bExact = b.shortNorm === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return a.route.sortOrder - b.route.sortOrder;
      })
      .slice(0, 4)
      .map((entry) => entry.route);

    const matchedStations = normalizedStationsIndex
      .filter((entry) => entry.text.includes(q))
      .map((entry) => entry.station)
      .sort((a, b) => {
        const aFav = favoriteStationIds.has(a.id);
        const bFav = favoriteStationIds.has(b.id);
        if (aFav !== bFav) return aFav ? -1 : 1;
        if (a.isMajorHub !== b.isMajorHub) return a.isMajorHub ? -1 : 1;
        return a.name.localeCompare(b.name, 'fr');
      })
      .slice(0, 6);

    return { stations: matchedStations, routes: matchedRoutes, pinnedOnly: false };
  }, [
    searchQuery,
    network,
    normalizedRoutesIndex,
    normalizedStationsIndex,
    favoriteStationList,
    favoriteStationIds,
    stationsById,
  ]);

  const flatSearchItems = useMemo(() => {
    const items: Array<
      { kind: 'route'; id: string; route: TransitRoute } |
      { kind: 'station'; id: string; station: TransitStation }
    > = [];
    for (const route of searchResults.routes) {
      items.push({ kind: 'route', id: `route-${route.id}`, route });
    }
    for (const station of searchResults.stations) {
      items.push({ kind: 'station', id: `station-${station.id}`, station });
    }
    return items;
  }, [searchResults]);

  // Reset active highlight when query or result list size changes
  useEffect(() => {
    setSearchHighlightIdx(0);
  }, [searchQuery, flatSearchItems.length]);

  const handleToggleRoute = useCallback((routeId: string) => {
    setEnabledRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else {
        next.add(routeId);
      }
      return next;
    });
  }, []);

  const handleSetPreset = useCallback(
    (preset: 'core' | 'all-active' | 'clear') => {
      if (preset === 'core') {
        setEnabledRouteIds(new Set(DEFAULT_ENABLED_ROUTES));
      } else if (preset === 'clear') {
        setEnabledRouteIds(new Set());
      } else if (preset === 'all-active') {
        const allIds = (network?.routes || [])
          .filter(
            (r) =>
              r.tier === 'core' ||
              r.tier === 'essential' ||
              r.tier === 'secondary' ||
              (liveTraffic?.activeCountByRoute[r.id] || 0) > 0
          )
          .map((r) => r.id);
        setEnabledRouteIds(new Set(allIds));
      }
    },
    [network, liveTraffic]
  );

  const handleSelectStation = useCallback(
    (station: TransitStation) => {
      setSelectedVehicleId(null);
      setFollowVehicle(false);
      setSelectedStationId(station.id);
      setStationArrivals(null);
      setSearchFocused(false);
      setMobileSearchOpen(false);
      setMobileSheetExpanded(false);
      setSearchQuery('');
      fetchStationArrivals(station.id);
    },
    [fetchStationArrivals]
  );

  const handleSelectVehicle = useCallback((vehicle: LiveVehicle) => {
    setSelectedStationId(null);
    setSelectedVehicleId(vehicle.id);
    setFollowVehicle(true);
    setMobileSearchOpen(false);
    setMobileSheetExpanded(false);
    setEnabledRouteIds((prev) => {
      if (prev.has(vehicle.routeId)) return prev;
      const next = new Set(prev);
      next.add(vehicle.routeId);
      return next;
    });
  }, []);

  const handleCloseInspector = useCallback(() => {
    setSelectedStationId(null);
    setSelectedVehicleId(null);
    setFollowVehicle(false);
    setMobileSheetExpanded(false);
  }, []);

  const handleOpenAlerts = useCallback((routeId: string | null = null) => {
    setAlertsDrawerRouteFilter(routeId);
    setAlertsDrawerOpen(true);
  }, []);

  const handleCloseAlerts = useCallback(() => {
    setAlertsDrawerOpen(false);
  }, []);

  const handleFocusRoutesFromAlert = useCallback((routeIds: string[]) => {
    setEnabledRouteIds((prev) => {
      const next = new Set(prev);
      for (const rid of routeIds) next.add(rid);
      return next;
    });
    setSidebarTab('lines');
  }, []);

  const handleRetryLiveFeed = useCallback(() => {
    fetchLiveTraffic(true);
  }, [fetchLiveTraffic]);

  const handleRefreshAlerts = useCallback(() => {
    fetchServiceAlerts(true);
  }, [fetchServiceAlerts]);

  const handleRefreshStation = useCallback(() => {
    if (selectedStationId) fetchStationArrivals(selectedStationId);
  }, [selectedStationId, fetchStationArrivals]);

  const handleToggleFollowVehicle = useCallback(() => {
    setFollowVehicle((f) => !f);
  }, []);

  const handleToggleMotionPaused = useCallback(() => {
    setIsMotionPaused((p) => !p);
  }, []);

  const handleToggleBasemap = useCallback(() => {
    setBasemap((b) => (b === 'dark' ? 'liberty' : 'dark'));
  }, []);

  const handleToggleStops = useCallback(() => {
    setShowStops((s) => !s);
  }, []);

  const handleToggleStationLabels = useCallback(() => {
    setShowStationLabels((prev) => {
      const next = !prev;
      if (next) setShowStops(true);
      return next;
    });
  }, []);

  const handleToggleDensity = useCallback(() => {
    setShowDensity((d) => !d);
  }, []);

  const handleToggleFavoriteStation = useCallback((stationId: string) => {
    setFavoriteStationList((prev) => toggleFavoriteId(prev, stationId));
  }, []);

  const handleCloseMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

  const handleOpenInstallGuide = useCallback(() => {
    setInstallGuideOpen(true);
  }, []);

  const handleCloseInstallGuide = useCallback(() => {
    setInstallGuideOpen(false);
  }, []);

  const handleManualRefresh = useCallback(() => {
    fetchLiveTraffic(true);
    fetchServiceAlerts(true);
    if (selectedStationId) fetchStationArrivals(selectedStationId);
  }, [fetchLiveTraffic, fetchServiceAlerts, fetchStationArrivals, selectedStationId]);

  const handleActivateSearchItem = useCallback(
    (
      item:
        | { kind: 'route'; id: string; route: TransitRoute }
        | { kind: 'station'; id: string; station: TransitStation }
    ) => {
      if (item.kind === 'route') {
        if (!enabledRouteIds.has(item.route.id)) {
          handleToggleRoute(item.route.id);
        }
        setSidebarTab('lines');
        setSearchFocused(false);
        setMobileSearchOpen(false);
        setSearchQuery('');
      } else {
        handleSelectStation(item.station);
      }
    },
    [enabledRouteIds, handleToggleRoute, handleSelectStation]
  );

  const handleSearchInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (flatSearchItems.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSearchHighlightIdx((idx) => (idx + 1) % flatSearchItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSearchHighlightIdx((idx) =>
          (idx - 1 + flatSearchItems.length) % flatSearchItems.length
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = flatSearchItems[searchHighlightIdx] ?? flatSearchItems[0];
        if (chosen) {
          handleActivateSearchItem(chosen);
          searchInputRef.current?.blur();
          mobileSearchInputRef.current?.blur();
        }
      }
    },
    [flatSearchItems, searchHighlightIdx, handleActivateSearchItem]
  );

  // Global keyboard shortcuts:
  // '/' search · 'Escape' dismiss · 'D' density · 'M' basemap · 'Space' pause/resume · '1/2/3' sidebar tabs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (e.key === 'Escape') {
        if (installGuideOpen) {
          setInstallGuideOpen(false);
        } else if (mobileSearchOpen) {
          setMobileSearchOpen(false);
          setSearchFocused(false);
        } else if (searchFocused) {
          setSearchFocused(false);
          searchInputRef.current?.blur();
        } else if (mobileDrawerOpen) {
          setMobileDrawerOpen(false);
        } else if (alertsDrawerOpen) {
          setAlertsDrawerOpen(false);
        } else if (selectedStationId || selectedVehicleId) {
          handleCloseInspector();
        }
        return;
      }

      if (isEditingField || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      const lower = e.key.toLowerCase();
      if (lower === 'd') {
        e.preventDefault();
        setShowDensity((d) => !d);
      } else if (lower === 'm') {
        e.preventDefault();
        setBasemap((b) => (b === 'dark' ? 'liberty' : 'dark'));
      } else if (lower === 'l') {
        e.preventDefault();
        setShowStationLabels((prev) => {
          const next = !prev;
          if (next) setShowStops(true);
          return next;
        });
      } else if (e.key === ' ' && !(target instanceof HTMLButtonElement) && !(target instanceof HTMLAnchorElement)) {
        e.preventDefault();
        setIsMotionPaused((p) => !p);
      } else if (e.key === '1') {
        setSidebarTab('lines');
      } else if (e.key === '2') {
        setSidebarTab('stations');
      } else if (e.key === '3') {
        setSidebarTab('vehicles');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    installGuideOpen,
    mobileSearchOpen,
    searchFocused,
    mobileDrawerOpen,
    alertsDrawerOpen,
    selectedStationId,
    selectedVehicleId,
    handleCloseInspector,
  ]);

  // Native Android hardware/gesture Back button integration (Capacitor)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let active = true;

    CapacitorApp.addListener('backButton', () => {
      const action = resolveAndroidBackAction({
        installGuideOpen,
        mobileSearchOpen,
        mobileDrawerOpen,
        alertsDrawerOpen,
        inspectorOpen: Boolean(selectedStationId || selectedVehicleId),
      });

      switch (action) {
        case 'close-install-guide':
          setInstallGuideOpen(false);
          break;
        case 'close-mobile-search':
          setMobileSearchOpen(false);
          setSearchFocused(false);
          break;
        case 'close-mobile-drawer':
          setMobileDrawerOpen(false);
          break;
        case 'close-alerts-drawer':
          setAlertsDrawerOpen(false);
          break;
        case 'close-inspector':
          handleCloseInspector();
          break;
        case 'exit-app':
          CapacitorApp.exitApp();
          break;
      }
    }).then((handle) => {
      if (active) {
        listenerHandle = handle;
      } else {
        handle.remove();
      }
    });

    return () => {
      active = false;
      listenerHandle?.remove();
    };
  }, [
    installGuideOpen,
    mobileSearchOpen,
    mobileDrawerOpen,
    alertsDrawerOpen,
    selectedStationId,
    selectedVehicleId,
    handleCloseInspector,
  ]);

  useEffect(() => {
    if (mobileSearchOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  const activeSetAlerts = useMemo(
    () => filterAlertsByActiveRoutes(serviceAlerts?.activeAlerts || [], enabledRouteIds),
    [serviceAlerts, enabledRouteIds]
  );
  const hasActiveSetDisruption = activeSetAlerts.length > 0;
  const hasSevereActiveDisruption = activeSetAlerts.some((a) => a.severity === 'severe');

  const feedHealth = useMemo(
    () =>
      evaluateFeedHealth(
        {
          isOnline: isBrowserOnline,
          hasData: Boolean(liveTraffic),
          serverFeedStatus: liveTraffic?.feedStatus ?? null,
          feedTimestampSec: liveTraffic?.feedTimestamp ?? null,
          lastSuccessAtMs: lastLiveSuccessAtMs,
          nowMs: healthClockMs,
          nowEpochSec,
          consecutiveFailures: consecutiveLiveFailures,
          lastError: lastLiveError ?? (consecutiveLiveFailures > 0 ? t('error.reachLiveFeed') : null),
        },
        locale
      ),
    [
      isBrowserOnline,
      liveTraffic,
      lastLiveSuccessAtMs,
      healthClockMs,
      nowEpochSec,
      consecutiveLiveFailures,
      lastLiveError,
      locale,
      t,
    ]
  );

  const inspectorOpen = Boolean(selectedStation || selectedVehicle);
  const networkError = networkErrorKey ? t(networkErrorKey) : null;
  const stationError = stationErrorKey ? t(stationErrorKey) : null;
  const alertsError = alertsErrorKey ? t(alertsErrorKey) : null;

  return (
    <I18nProvider locale={locale} onChangeLocale={handleChangeLocale}>
      <div
        data-locale={locale}
        className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#0B0F17] text-slate-100"
      >
        {/* Official T2C Clermont-Ferrand 2px brand accent ribbon (Tram A Crimson → BHNS B Cobalt) */}
        <div
          aria-hidden="true"
          className="h-[2px] w-full shrink-0 bg-gradient-to-r from-[#AB161B] via-[#C81D25] to-[#0069B4]"
        />

        {/* Top Control Header — clean 3-zone desktop layout + spacious mobile bar */}
        <header className="relative min-h-14 pt-[env(safe-area-inset-top)] shrink-0 px-2.5 sm:px-4 lg:px-5 bg-[#0F1522] border-b border-slate-800/80 flex items-center justify-between gap-1.5 sm:gap-4 z-30">
          {/* Zone 1: Brand Emblem, Title & Subtle Live Feed Health Indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label={t('app.openMenu')}
              className="lg:hidden w-8 h-8 sm:w-9 sm:h-9 -ml-0.5 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <img
                src="./icon.svg"
                alt=""
                aria-hidden="true"
                width={26}
                height={26}
                className="w-6 h-6 sm:w-[26px] sm:h-[26px] rounded-[7px] shadow-sm ring-1 ring-white/15 shrink-0"
              />
              <h1 className="font-display text-[15px] sm:text-[17px] font-bold tracking-tight text-white whitespace-nowrap shrink-0">
                {t('app.brand')}
              </h1>
            </div>
            <NetworkStatusIndicator
              health={feedHealth}
              feedTimestampSec={liveTraffic?.feedTimestamp ?? null}
              isRefreshing={isRefreshingLive}
              onRetry={handleRetryLiveFeed}
            />
          </div>

          {/* Zone 2: Desktop/Tablet Inline Station & Line Search */}
          <div className="relative hidden md:block flex-1 max-w-md">
            <div className="relative flex items-center">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="text"
                role="combobox"
                aria-expanded={
                  searchFocused &&
                  (searchQuery.trim().length > 0 || searchResults.stations.length > 0)
                }
                aria-controls="desktop-search-listbox"
                aria-activedescendant={
                  searchFocused && flatSearchItems[searchHighlightIdx]
                    ? `desktop-opt-${flatSearchItems[searchHighlightIdx].id}`
                    : undefined
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchInputKeyDown}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                placeholder={t('search.placeholderDesktop')}
                title={t('search.titleDesktop')}
                aria-label={t('search.aria')}
                className="w-full h-9 pl-9 pr-9 rounded-lg bg-[#090D16] border border-slate-800 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/70 focus:ring-2 focus:ring-sky-500/15 transition-all"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('search.clearAria')}
                  className="absolute right-2 p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                !searchFocused && (
                  <kbd
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/80 text-[10px] font-mono-tabular text-slate-400 leading-none"
                  >
                    /
                  </kbd>
                )
              )}
            </div>

            {/* Instant Search Jump Dropdown (supports ↑/↓ + Enter & Pinned Stops quick-jump) */}
            {searchFocused &&
              (searchQuery.trim().length > 0 || searchResults.stations.length > 0) && (
                <div
                  id="desktop-search-listbox"
                  role="listbox"
                  aria-label={t('search.suggestionsAria')}
                  className="absolute left-0 right-0 top-full mt-1.5 rounded-lg bg-[#111827] border border-slate-700/90 shadow-2xl overflow-hidden z-50 divide-y divide-slate-800/80"
                >
                  {searchQuery.trim().length > 0 &&
                    searchResults.stations.length === 0 &&
                    searchResults.routes.length === 0 && (
                      <div className="px-3.5 py-3 text-xs text-slate-400">
                        {t('search.noMatches', { query: searchQuery.trim() })}
                      </div>
                    )}
                  {searchResults.routes.length > 0 && (
                    <div className="p-1.5">
                      <div className="px-2.5 py-1 text-[11px] font-medium text-slate-400">
                        {t('search.sectionLines')}
                      </div>
                      {searchResults.routes.map((route, rIdx) => {
                        const active = enabledRouteIds.has(route.id);
                        const isHighlighted = searchHighlightIdx === rIdx;
                        return (
                          <button
                            key={route.id}
                            id={`desktop-opt-route-${route.id}`}
                            role="option"
                            aria-selected={isHighlighted}
                            type="button"
                            onMouseEnter={() => setSearchHighlightIdx(rIdx)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() =>
                              handleActivateSearchItem({
                                kind: 'route',
                                id: `route-${route.id}`,
                                route,
                              })
                            }
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                              isHighlighted ? 'bg-sky-500/20 text-white' : 'hover:bg-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <RouteBadge
                                shortName={route.shortName}
                                color={route.color}
                                textColor={route.textColor}
                                size="xs"
                              />
                              <span className="text-slate-100 truncate">
                                {route.headsigns.slice(0, 2).join(' ↔ ') || route.description}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {active ? t('search.lineShown') : t('search.lineShow')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchResults.stations.length > 0 && (
                    <div className="p-1.5">
                      <div className="px-2.5 py-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
                        <span>
                          {searchResults.pinnedOnly
                            ? t('search.pinnedStops')
                            : t('search.stationsHintDesktop')}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono-tabular">
                          ↑↓ · ↵
                        </span>
                      </div>
                      {searchResults.stations.map((st, sIdx) => {
                        const flatIdx = searchResults.routes.length + sIdx;
                        const isHighlighted = searchHighlightIdx === flatIdx;
                        const isFav = favoriteStationIds.has(st.id);
                        return (
                          <button
                            key={st.id}
                            id={`desktop-opt-station-${st.id}`}
                            role="option"
                            aria-selected={isHighlighted}
                            type="button"
                            onMouseEnter={() => setSearchHighlightIdx(flatIdx)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectStation(st)}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                              isHighlighted ? 'bg-sky-500/20 text-white' : 'hover:bg-slate-800'
                            }`}
                          >
                            <span className="inline-flex items-center gap-1.5 min-w-0 text-slate-100 font-medium">
                              {isFav && (
                                <Star
                                  className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="truncate">{formatShortStationLabel(st.name)}</span>
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {st.routeIds.slice(0, 4).map((rid) => {
                                const r = routesById[rid];
                                if (!r) return null;
                                return (
                                  <RouteBadge
                                    key={rid}
                                    shortName={r.shortName}
                                    color={r.color}
                                    textColor={r.textColor}
                                    size="xs"
                                  />
                                );
                              })}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
          </div>

          {/* Zone 3: Mobile Search Trigger, Service Alerts, FR/EN Language Switch, Local Time & Refresh */}
          <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMobileSearchOpen(true);
                setSearchFocused(true);
              }}
              data-testid="mobile-search-btn"
              aria-label={t('search.aria')}
              className="md:hidden w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg bg-[#090D16] hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors shrink-0"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleOpenAlerts(null)}
              data-testid="header-service-alerts-btn"
              data-has-disruption={hasActiveSetDisruption ? 'true' : 'false'}
              aria-label={
                hasActiveSetDisruption
                  ? activeSetAlerts.length === 1
                    ? t('header.alertsAriaActiveOne')
                    : t('header.alertsAriaActiveMany', { count: activeSetAlerts.length })
                  : t('header.alertsAriaNone')
              }
              className={`inline-flex items-center justify-center gap-1 sm:gap-1.5 h-8 sm:h-auto px-2 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                hasSevereActiveDisruption
                  ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-500/50'
                  : hasActiveSetDisruption
                    ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/50'
                    : 'bg-[#090D16] hover:bg-slate-800 text-slate-300 border-slate-800'
              }`}
            >
              {hasActiveSetDisruption ? (
                <AlertTriangle
                  className={`w-3.5 h-3.5 shrink-0 ${
                    hasSevereActiveDisruption ? 'text-rose-400' : 'text-amber-400'
                  }`}
                  aria-hidden="true"
                  data-testid="header-disruption-icon"
                />
              ) : (
                <Bell className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              )}
              <span className="hidden md:inline">{t('header.alertsLabel')}</span>
              {hasActiveSetDisruption && (
                <span
                  className={`font-mono-tabular font-bold ${
                    hasSevereActiveDisruption ? 'text-rose-300' : 'text-amber-300'
                  }`}
                >
                  {activeSetAlerts.length}
                </span>
              )}
            </button>

            <PWAInstallButton
              installState={pwaInstall}
              onOpenGuide={handleOpenInstallGuide}
              variant="header"
            />

            {/* Responsive Language Switcher (Segmented FR | EN on sm+, compact 1-tap toggle on mobile) */}
            <div
              role="group"
              aria-label={t('lang.groupAria')}
              data-testid="language-switcher"
              className="hidden sm:inline-flex items-center p-0.5 rounded-lg bg-[#090D16] border border-slate-800 shrink-0"
            >
              <button
                type="button"
                onClick={() => handleChangeLocale('fr')}
                aria-pressed={locale === 'fr'}
                aria-label={t('lang.switchToFr')}
                title={t('lang.switchToFr')}
                data-testid="lang-btn-fr"
                className={`px-2 py-1 rounded-md text-[11px] font-semibold tracking-wide transition-all ${
                  locale === 'fr'
                    ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                FR
              </button>
              <button
                type="button"
                onClick={() => handleChangeLocale('en')}
                aria-pressed={locale === 'en'}
                aria-label={t('lang.switchToEn')}
                title={t('lang.switchToEn')}
                data-testid="lang-btn-en"
                className={`px-2 py-1 rounded-md text-[11px] font-semibold tracking-wide transition-all ${
                  locale === 'en'
                    ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleChangeLocale(locale === 'fr' ? 'en' : 'fr')}
              data-testid="mobile-language-toggle"
              aria-label={locale === 'fr' ? t('lang.toggleAriaFr') : t('lang.toggleAriaEn')}
              className="sm:hidden h-8 min-w-[32px] px-1.5 inline-flex items-center justify-center rounded-lg bg-[#090D16] hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 text-[11px] font-semibold tracking-wide transition-colors shrink-0"
            >
              {locale.toUpperCase()}
            </button>

            <ClermontClock
              serverClockOffsetSec={serverClockOffsetSec}
              cityLabel={t('app.city')}
            />
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshingLive}
              aria-label={t('app.refreshTrafficAria')}
              className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-xs font-medium text-slate-100 border border-slate-700/80 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshingLive ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">{t('app.refresh')}</span>
            </button>
          </div>

          {/* Dedicated Full-Width Mobile Search Bar Overlay (< md) */}
          {mobileSearchOpen && (
            <div className="md:hidden absolute inset-0 z-40 px-3 bg-[#0F1522] flex items-center gap-2 border-b border-slate-800">
              <div className="relative flex-1 flex items-center">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={searchQuery.trim().length > 0 || searchResults.stations.length > 0}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchInputKeyDown}
                  onFocus={() => setSearchFocused(true)}
                  placeholder={t('search.placeholderMobile')}
                  aria-label={t('search.aria')}
                  className="w-full h-10 pl-9 pr-8 rounded-lg bg-[#090D16] border border-sky-500/60 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label={t('search.clearAria')}
                    className="absolute right-2.5 p-1 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSearchFocused(false);
                }}
                className="px-2.5 h-10 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {t('app.cancel')}
              </button>

              {/* Mobile Full-Width Search Suggestions Dropdown */}
              {(searchQuery.trim().length > 0 || searchResults.stations.length > 0) && (
                <div
                  role="listbox"
                  aria-label={t('search.mobileSuggestionsAria')}
                  className="fixed inset-x-3 top-[60px] max-h-[65dvh] overflow-y-auto transit-scroll rounded-xl bg-[#111827] border border-slate-700/90 shadow-2xl z-50 divide-y divide-slate-800/80"
                >
                  {searchQuery.trim().length > 0 &&
                    searchResults.stations.length === 0 &&
                    searchResults.routes.length === 0 && (
                      <div className="px-4 py-3.5 text-xs text-slate-400">
                        {t('search.noMatches', { query: searchQuery.trim() })}
                      </div>
                    )}
                  {searchResults.routes.length > 0 && (
                    <div className="p-2">
                      <div className="px-2.5 py-1 text-[11px] font-medium text-slate-400">
                        {t('search.sectionLines')}
                      </div>
                      {searchResults.routes.map((route, rIdx) => {
                        const active = enabledRouteIds.has(route.id);
                        const isHighlighted = searchHighlightIdx === rIdx;
                        return (
                          <button
                            key={route.id}
                            role="option"
                            aria-selected={isHighlighted}
                            type="button"
                            onClick={() =>
                              handleActivateSearchItem({
                                kind: 'route',
                                id: `route-${route.id}`,
                                route,
                              })
                            }
                            className={`w-full min-h-[44px] flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                              isHighlighted ? 'bg-sky-500/20 text-white' : 'hover:bg-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <RouteBadge
                                shortName={route.shortName}
                                color={route.color}
                                textColor={route.textColor}
                                size="xs"
                              />
                              <span className="text-slate-100 truncate">
                                {route.headsigns.slice(0, 2).join(' ↔ ') || route.description}
                              </span>
                            </div>
                            <span className="text-[11px] text-sky-400 shrink-0">
                              {active ? t('search.lineShown') : t('search.lineShow')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchResults.stations.length > 0 && (
                    <div className="p-2">
                      <div className="px-2.5 py-1 text-[11px] font-medium text-slate-400">
                        {searchResults.pinnedOnly
                          ? t('search.pinnedStops')
                          : t('search.stationsHintMobile')}
                      </div>
                      {searchResults.stations.map((st, sIdx) => {
                        const flatIdx = searchResults.routes.length + sIdx;
                        const isHighlighted = searchHighlightIdx === flatIdx;
                        const isFav = favoriteStationIds.has(st.id);
                        return (
                          <button
                            key={st.id}
                            role="option"
                            aria-selected={isHighlighted}
                            type="button"
                            onClick={() => handleSelectStation(st)}
                            className={`w-full min-h-[44px] flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                              isHighlighted ? 'bg-sky-500/20 text-white' : 'hover:bg-slate-800'
                            }`}
                          >
                            <span className="inline-flex items-center gap-1.5 min-w-0 text-slate-100 font-medium">
                              {isFav && (
                                <Star
                                  className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="truncate">{formatShortStationLabel(st.name)}</span>
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {st.routeIds.slice(0, 3).map((rid) => {
                                const r = routesById[rid];
                                if (!r) return null;
                                return (
                                  <RouteBadge
                                    key={rid}
                                    shortName={r.shortName}
                                    color={r.color}
                                    textColor={r.textColor}
                                    size="xs"
                                  />
                                );
                              })}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </header>

        {/* Compact Android / Mobile Install Bar (< sm, auto-hidden when installed as standalone/APK) */}
        {pwaInstall.mode !== 'hidden' && !mobileInstallBannerDismissed && (
          <div
            data-testid="mobile-install-banner"
            className="sm:hidden shrink-0 px-3 py-2 bg-[#0B1222] border-b border-sky-500/25 flex items-center justify-between gap-2 z-20"
          >
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="./icon.svg"
                alt=""
                aria-hidden="true"
                width={24}
                height={24}
                className="w-6 h-6 rounded-md ring-1 ring-white/15 shrink-0"
              />
              <span className="text-xs font-medium text-slate-200 truncate">
                {pwaInstall.isIOS ? t('pwa.modalIosTitle') : t('pwa.modalAndroidTitle')}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {pwaInstall.mode === 'apk-download' && pwaInstall.apkDownloadUrl ? (
                <a
                  href={pwaInstall.apkDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={ANDROID_APK_ASSET_NAME}
                  data-testid="mobile-install-cta"
                  data-install-mode="apk-download"
                  aria-label={t('pwa.downloadApkAria')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 text-[11px] font-semibold transition-colors"
                >
                  <Download className="w-3 h-3" aria-hidden="true" />
                  <span>{t('pwa.downloadApk')}</span>
                </a>
              ) : (
                <button
                  type="button"
                  data-testid="mobile-install-cta"
                  data-install-mode={pwaInstall.mode}
                  onClick={async () => {
                    if (pwaInstall.mode === 'native-prompt') {
                      await pwaInstall.install();
                    } else {
                      setInstallGuideOpen(true);
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 text-[11px] font-semibold transition-colors"
                >
                  {pwaInstall.mode === 'native-prompt' ? (
                    <Download className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <Smartphone className="w-3 h-3" aria-hidden="true" />
                  )}
                  <span>{t('pwa.installApp')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileInstallBannerDismissed(true)}
                aria-label={t('app.close')}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Network error banner if static GTFS load failed */}
        {networkError && (
          <div className="px-4 py-2 bg-rose-950/80 border-b border-rose-800/70 flex items-center justify-between gap-3 text-xs text-rose-200 z-20">
            <span>{networkError}</span>
            <button
              type="button"
              onClick={fetchNetwork}
              className="px-2.5 py-1 rounded bg-rose-900 hover:bg-rose-800 text-white font-medium whitespace-nowrap"
            >
              {t('app.retry')}
            </button>
          </div>
        )}

      {/* Main Control Workspace */}
      <main className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Desktop Left Sidebar */}
        <div className="hidden lg:block w-80 shrink-0 h-full">
          <ControlSidebar
            activeTab={sidebarTab}
            onTabChange={setSidebarTab}
            routes={network?.routes || EMPTY_ROUTES}
            stations={network?.stations || EMPTY_STATIONS}
            vehicles={liveTraffic?.vehicles || EMPTY_VEHICLES}
            activeCountByRoute={liveTraffic?.activeCountByRoute || EMPTY_COUNTS}
            activeAlertCountByRoute={serviceAlerts?.activeAlertCountByRoute}
            enabledRouteIds={enabledRouteIds}
            onToggleRoute={handleToggleRoute}
            onSetPreset={handleSetPreset}
            onOpenRouteAlerts={handleOpenAlerts}
            favoriteStationIds={favoriteStationIds}
            onToggleFavoriteStation={handleToggleFavoriteStation}
            searchQuery={searchQuery}
            selectedStationId={selectedStationId}
            selectedVehicleId={selectedVehicleId}
            onSelectStation={handleSelectStation}
            onSelectVehicle={handleSelectVehicle}
            nowEpochSec={sidebarTab === 'vehicles' ? nowEpochSec : 0}
            isLoadingNetwork={isLoadingNetwork}
          />
        </div>

        {/* Mobile Slide-Over Left Drawer */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
              onClick={handleCloseMobileDrawer}
              aria-hidden="true"
            />
            <div className="relative w-[86vw] max-w-xs h-full z-10 shadow-2xl">
              <ControlSidebar
                activeTab={sidebarTab}
                onTabChange={setSidebarTab}
                routes={network?.routes || EMPTY_ROUTES}
                stations={network?.stations || EMPTY_STATIONS}
                vehicles={liveTraffic?.vehicles || EMPTY_VEHICLES}
                activeCountByRoute={liveTraffic?.activeCountByRoute || EMPTY_COUNTS}
                activeAlertCountByRoute={serviceAlerts?.activeAlertCountByRoute}
                enabledRouteIds={enabledRouteIds}
                onToggleRoute={handleToggleRoute}
                onSetPreset={handleSetPreset}
                onOpenRouteAlerts={handleOpenAlerts}
                favoriteStationIds={favoriteStationIds}
                onToggleFavoriteStation={handleToggleFavoriteStation}
                searchQuery={searchQuery}
                selectedStationId={selectedStationId}
                selectedVehicleId={selectedVehicleId}
                onSelectStation={handleSelectStation}
                onSelectVehicle={handleSelectVehicle}
                nowEpochSec={sidebarTab === 'vehicles' ? nowEpochSec : 0}
                isLoadingNetwork={isLoadingNetwork}
                onCloseMobile={handleCloseMobileDrawer}
                mobileFooter={
                  pwaInstall.mode !== 'hidden' ? (
                    <PWAInstallButton
                      installState={pwaInstall}
                      onOpenGuide={() => {
                        setMobileDrawerOpen(false);
                        setInstallGuideOpen(true);
                      }}
                      variant="drawer"
                    />
                  ) : null
                }
              />
            </div>
          </div>
        )}

        {/* Central Interactive Open-Source Dark Map */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          <Suspense fallback={<div className="flex-1 h-full min-h-0 bg-[#0B0F17]" />}>
            <TransitMap
              routes={network?.routes || EMPTY_ROUTES}
              stations={network?.stations || EMPTY_STATIONS}
              vehicles={liveTraffic?.vehicles || EMPTY_VEHICLES}
              enabledRouteIds={enabledRouteIds}
              activeCountByRoute={liveTraffic?.activeCountByRoute || EMPTY_COUNTS}
              activeAlertCountByRoute={serviceAlerts?.activeAlertCountByRoute}
              selectedStation={selectedStation}
              selectedVehicle={selectedVehicle}
              followVehicle={followVehicle}
              onSelectStation={handleSelectStation}
              onSelectVehicle={handleSelectVehicle}
              serverClockOffsetSec={serverClockOffsetSec}
              isMotionPaused={isMotionPaused}
              onToggleMotionPaused={handleToggleMotionPaused}
              basemap={basemap}
              onToggleBasemap={handleToggleBasemap}
              showStops={showStops}
              onToggleStops={handleToggleStops}
              showStationLabels={showStationLabels}
              onToggleStationLabels={handleToggleStationLabels}
              showDensity={showDensity}
              onToggleDensity={handleToggleDensity}
              feedHealth={feedHealth}
            />
          </Suspense>
        </div>

        {/* Single Unified Responsive Inspector Panel (Desktop Right Rail / Mobile Expandable Bottom Sheet) */}
        {inspectorOpen && (
          <div
            data-testid="inspector-container"
            className={`fixed inset-x-0 bottom-0 z-30 flex flex-col bg-[#0F1522] rounded-t-2xl overflow-hidden border-t border-slate-700/80 shadow-2xl transition-[height] duration-200 pb-[env(safe-area-inset-bottom)] md:static md:inset-auto md:h-full md:w-96 md:shrink-0 md:rounded-none md:border-t-0 md:pb-0 md:z-20 ${
              mobileSheetExpanded ? 'h-[85dvh]' : 'h-[58dvh]'
            }`}
          >
            {/* Mobile Bottom Sheet Expand / Collapse Handle */}
            <button
              type="button"
              onClick={() => setMobileSheetExpanded((e) => !e)}
              data-testid="mobile-sheet-toggle"
              aria-label={mobileSheetExpanded ? t('sheet.collapseAria') : t('sheet.expandAria')}
              className="md:hidden w-full py-2 flex items-center justify-center gap-1.5 bg-[#0F1522] border-b border-slate-800/70 text-[11px] text-slate-400 hover:text-slate-200 shrink-0"
            >
              <span className="w-9 h-1 rounded-full bg-slate-600/80" aria-hidden="true" />
              {mobileSheetExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              )}
            </button>

            <div className="flex-1 min-h-0 flex flex-col">
              <DetailInspector
                selectedStation={selectedStation}
                stationArrivals={stationArrivals}
                isLoadingStation={isLoadingStation}
                stationError={stationError}
                onRefreshStation={handleRefreshStation}
                selectedVehicle={selectedVehicle}
                followVehicle={followVehicle}
                onToggleFollowVehicle={handleToggleFollowVehicle}
                routesById={routesById}
                stationsById={stationsById}
                vehiclesById={vehiclesById}
                onSelectStation={handleSelectStation}
                onSelectVehicle={handleSelectVehicle}
                onClose={handleCloseInspector}
                nowEpochSec={nowEpochSec}
                activeAlertCountByRoute={serviceAlerts?.activeAlertCountByRoute}
                onOpenRouteAlerts={handleOpenAlerts}
                isStationFavorite={
                  selectedStation ? favoriteStationIds.has(selectedStation.id) : false
                }
                onToggleFavoriteStation={handleToggleFavoriteStation}
              />
            </div>
          </div>
        )}
      </main>

      {/* GTFS-RT / T2C Service Alerts & Disruption History Drawer (code-split) */}
      {alertsDrawerOpen && (
        <Suspense fallback={null}>
          <ServiceAlertsDrawer
            isOpen={alertsDrawerOpen}
            onClose={handleCloseAlerts}
            alertsData={serviceAlerts}
            isLoading={isLoadingAlerts}
            error={alertsError}
            onRefresh={handleRefreshAlerts}
            enabledRouteIds={enabledRouteIds}
            routesById={routesById}
            onFocusRoutes={handleFocusRoutesFromAlert}
            nowEpochSec={Math.floor(nowEpochSec)}
            initialRouteFilter={alertsDrawerRouteFilter}
          />
        </Suspense>
      )}

      {/* Android / iOS App Install Guide Modal */}
      <PWAInstallGuideModal
        isOpen={installGuideOpen}
        isIOS={pwaInstall.isIOS}
        apkDownloadUrl={pwaInstall.apkDownloadUrl}
        onClose={handleCloseInstallGuide}
      />

      {/* Offline Cached Mode Indicator */}
      <OfflineIndicator isOnline={isBrowserOnline} />
      </div>
    </I18nProvider>
  );
}
