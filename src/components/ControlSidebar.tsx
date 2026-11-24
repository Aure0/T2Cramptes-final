import React, { useDeferredValue, useMemo, useState } from 'react';
import { AlertTriangle, Bus, MapPin, Navigation, Star, TramFront, X } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import type {
  LiveVehicle,
  RouteTier,
  TransitRoute,
  TransitStation,
} from '../types/transit';
import {
  formatDelayStatus,
  formatEtaCountdown,
  formatShortStationLabel,
  normalizeSearchText,
} from '../utils/transitMath';
import { RouteBadge } from './RouteBadge';

export type SidebarTab = 'lines' | 'stations' | 'vehicles';

interface ControlSidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  routes: TransitRoute[];
  stations: TransitStation[];
  vehicles: LiveVehicle[];
  activeCountByRoute: Record<string, number>;
  activeAlertCountByRoute?: Record<string, number>;
  enabledRouteIds: Set<string>;
  onToggleRoute: (routeId: string) => void;
  onSetPreset: (preset: 'core' | 'all-active' | 'clear') => void;
  onOpenRouteAlerts?: (routeId: string) => void;
  favoriteStationIds: Set<string>;
  onToggleFavoriteStation: (stationId: string) => void;
  searchQuery: string;
  selectedStationId: string | null;
  selectedVehicleId: string | null;
  onSelectStation: (station: TransitStation) => void;
  onSelectVehicle: (vehicle: LiveVehicle) => void;
  nowEpochSec: number;
  isLoadingNetwork: boolean;
  onCloseMobile?: () => void;
  mobileFooter?: React.ReactNode;
}

const TIER_IDS: Array<'all' | RouteTier> = ['all', 'core', 'essential', 'secondary', 'local'];

export const ControlSidebar: React.FC<ControlSidebarProps> = React.memo(({
  activeTab,
  onTabChange,
  routes,
  stations,
  vehicles,
  activeCountByRoute,
  activeAlertCountByRoute,
  enabledRouteIds,
  onToggleRoute,
  onSetPreset,
  onOpenRouteAlerts,
  favoriteStationIds,
  onToggleFavoriteStation,
  searchQuery,
  selectedStationId,
  selectedVehicleId,
  onSelectStation,
  onSelectVehicle,
  nowEpochSec,
  isLoadingNetwork,
  onCloseMobile,
  mobileFooter,
}) => {
  const { locale, t } = useI18n();
  const [tierFilter, setTierFilter] = useState<'all' | RouteTier>('all');

  const getTierLabel = (id: 'all' | RouteTier): string => {
    if (id === 'all') return t('sidebar.tierAll');
    if (id === 'core') return 'A · B · C';
    if (id === 'essential') return 'E1–E7';
    if (id === 'secondary') return 'S10–S15';
    return t('sidebar.tierLocal');
  };

  const routeById = useMemo(() => {
    const rec: Record<string, TransitRoute> = {};
    for (const r of routes) rec[r.id] = r;
    return rec;
  }, [routes]);

  const deferredQuery = useDeferredValue(searchQuery);
  const normalizedQuery = useMemo(
    () => normalizeSearchText(deferredQuery),
    [deferredQuery]
  );

  // Pre-normalized search strings so filtering 600+ stations stays instant on every keystroke
  const normalizedRouteSearch = useMemo(() => {
    const rec: Record<string, string> = {};
    for (const r of routes) {
      rec[r.id] = normalizeSearchText(`${r.shortName} ${r.description} ${r.headsigns.join(' ')}`);
    }
    return rec;
  }, [routes]);

  const normalizedStationSearch = useMemo(() => {
    const rec: Record<string, string> = {};
    for (const st of stations) {
      const routeNames = st.routeIds.map((rid) => routeById[rid]?.shortName || rid).join(' ');
      rec[st.id] = normalizeSearchText(`${st.name} ${routeNames}`);
    }
    return rec;
  }, [stations, routeById]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (tierFilter !== 'all' && r.tier !== tierFilter) return false;
      if (!normalizedQuery) return true;
      return (normalizedRouteSearch[r.id] || '').includes(normalizedQuery);
    });
  }, [routes, tierFilter, normalizedQuery, normalizedRouteSearch]);

  const pinnedStations = useMemo(() => {
    if (favoriteStationIds.size === 0) return [];
    const byId = new Map<string, TransitStation>();
    for (const st of stations) byId.set(st.id, st);
    const out: TransitStation[] = [];
    for (const id of favoriteStationIds) {
      const st = byId.get(id);
      if (!st) continue;
      if (normalizedQuery && !(normalizedStationSearch[st.id] || '').includes(normalizedQuery)) {
        continue;
      }
      out.push(st);
    }
    return out;
  }, [stations, favoriteStationIds, normalizedQuery, normalizedStationSearch]);

  const filteredStations = useMemo(() => {
    const matches = stations.filter((st) => {
      if (favoriteStationIds.has(st.id)) return false;
      if (normalizedQuery) {
        return (normalizedStationSearch[st.id] || '').includes(normalizedQuery);
      }
      // Without search query, show stations served by currently enabled lines
      if (enabledRouteIds.size === 0) return st.isMajorHub;
      return st.routeIds.some((rid) => enabledRouteIds.has(rid));
    });

    // Prioritize major hubs first, then alphabetical
    return matches
      .slice()
      .sort((a, b) => {
        if (a.isMajorHub !== b.isMajorHub) return a.isMajorHub ? -1 : 1;
        return a.name.localeCompare(b.name, 'fr');
      })
      .slice(0, 120);
  }, [stations, favoriteStationIds, normalizedQuery, enabledRouteIds, normalizedStationSearch]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (!enabledRouteIds.has(v.routeId)) return false;
      if (!normalizedQuery) return true;
      return normalizeSearchText(
        `${v.routeShortName} ${v.headsign} ${v.nextStopName} ${v.prevStopName}`
      ).includes(normalizedQuery);
    });
  }, [vehicles, enabledRouteIds, normalizedQuery]);

  const visibleVehicleCount = useMemo(
    () => vehicles.filter((v) => enabledRouteIds.has(v.routeId)).length,
    [vehicles, enabledRouteIds]
  );

  const activePreset = useMemo<'core' | 'all-active' | 'clear' | 'custom'>(() => {
    if (enabledRouteIds.size === 0) return 'clear';
    if (
      enabledRouteIds.size === 3 &&
      enabledRouteIds.has('A') &&
      enabledRouteIds.has('B') &&
      enabledRouteIds.has('C')
    ) {
      return 'core';
    }
    if (routes.length > 0) {
      const fullIds = routes
        .filter(
          (r) =>
            r.tier === 'core' ||
            r.tier === 'essential' ||
            r.tier === 'secondary' ||
            (activeCountByRoute[r.id] || 0) > 0
        )
        .map((r) => r.id);
      if (
        fullIds.length > 0 &&
        enabledRouteIds.size === fullIds.length &&
        fullIds.every((id) => enabledRouteIds.has(id))
      ) {
        return 'all-active';
      }
    }
    return 'custom';
  }, [enabledRouteIds, routes, activeCountByRoute]);

  return (
    <aside
      aria-label={t('sidebar.aria')}
      className="flex flex-col h-full w-full bg-[#0F1522] border-r border-slate-800/80 text-slate-100 select-none pb-[env(safe-area-inset-bottom)]"
    >
      {/* Mobile drawer header */}
      {onCloseMobile && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 lg:hidden">
          <span className="font-display text-sm font-semibold text-slate-100">
            {t('sidebar.drawerTitle')}
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label={t('sidebar.closeDrawerAria')}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="px-4 pt-3.5 pb-3 border-b border-slate-800/80">
        <div
          role="tablist"
          aria-label={t('sidebar.tablistAria')}
          className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#090D16] border border-slate-800/80"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'lines'}
            title={t('sidebar.tabLinesTitle')}
            onClick={() => onTabChange('lines')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'lines'
                ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('sidebar.tabLines', { count: enabledRouteIds.size })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'stations'}
            title={t('sidebar.tabStationsTitle')}
            onClick={() => onTabChange('stations')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'stations'
                ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('sidebar.tabStations')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'vehicles'}
            title={t('sidebar.tabLiveTitle')}
            onClick={() => onTabChange('vehicles')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === 'vehicles'
                ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('sidebar.tabLive', { count: visibleVehicleCount })}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'lines' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Quick Presets */}
          <div className="px-4 py-3 border-b border-slate-800/70 space-y-2.5">
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
                {t('sidebar.presetsLabel')}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  aria-pressed={activePreset === 'core'}
                  onClick={() => onSetPreset('core')}
                  className={`px-1.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md border transition-colors whitespace-nowrap text-center ${
                    activePreset === 'core'
                      ? 'bg-sky-500/20 text-sky-200 border-sky-500/45 shadow-sm'
                      : 'bg-slate-900/70 hover:bg-slate-800/80 text-slate-300 hover:text-white border-slate-800/90'
                  }`}
                >
                  {t('sidebar.presetCore')}
                </button>
                <button
                  type="button"
                  aria-pressed={activePreset === 'all-active'}
                  onClick={() => onSetPreset('all-active')}
                  className={`px-1.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md border transition-colors whitespace-nowrap text-center truncate ${
                    activePreset === 'all-active'
                      ? 'bg-sky-500/20 text-sky-200 border-sky-500/45 shadow-sm'
                      : 'bg-slate-900/70 hover:bg-slate-800/80 text-slate-300 hover:text-white border-slate-800/90'
                  }`}
                >
                  {t('sidebar.presetFull')}
                </button>
                <button
                  type="button"
                  aria-pressed={activePreset === 'clear'}
                  onClick={() => onSetPreset('clear')}
                  className={`px-1.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md border transition-colors whitespace-nowrap text-center ${
                    activePreset === 'clear'
                      ? 'bg-slate-800 text-white border-slate-600'
                      : 'bg-slate-900/70 hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 border-slate-800/90'
                  }`}
                >
                  {t('sidebar.presetClear')}
                </button>
              </div>
            </div>

            {/* Category filter strip */}
            <div className="flex items-center gap-1 overflow-x-auto transit-scroll pb-0.5">
              {TIER_IDS.map((tierId) => (
                <button
                  key={tierId}
                  type="button"
                  onClick={() => setTierFilter(tierId)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    tierFilter === tierId
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  {getTierLabel(tierId)}
                </button>
              ))}
            </div>
          </div>

          {/* Route list */}
          <div className="flex-1 overflow-y-auto transit-scroll divide-y divide-slate-800/60">
            {isLoadingNetwork ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 7 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-12 rounded-lg bg-slate-800/40 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredRoutes.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                {t('sidebar.noMatchingRoutes')}
              </div>
            ) : (
              filteredRoutes.map((route) => {
                const isEnabled = enabledRouteIds.has(route.id);
                const liveCount = activeCountByRoute[route.id] || 0;
                const alertCount = activeAlertCountByRoute?.[route.id] || 0;
                const endpointText =
                  route.headsigns.length >= 2
                    ? `${route.headsigns[0]} ↔ ${route.headsigns[1]}`
                    : route.headsigns[0] || route.description;

                return (
                  <div
                    key={route.id}
                    className={`relative flex items-center transition-colors ${
                      isEnabled
                        ? 'bg-slate-800/45 hover:bg-slate-800/70'
                        : 'bg-transparent hover:bg-slate-800/25 opacity-60 hover:opacity-95'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-opacity"
                      style={{
                        backgroundColor: route.color,
                        opacity: isEnabled ? 1 : 0,
                      }}
                    />
                    <button
                      type="button"
                      aria-pressed={isEnabled}
                      onClick={() => onToggleRoute(route.id)}
                      className={`flex-1 min-w-0 flex items-center gap-3 pl-4 py-3 sm:py-2.5 text-left ${
                        alertCount > 0 && onOpenRouteAlerts ? 'pr-2' : 'pr-4'
                      }`}
                    >
                      <RouteBadge
                        shortName={route.shortName}
                        color={route.color}
                        textColor={route.textColor}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-slate-100 truncate">
                            {route.routeType === 0
                              ? 'Tramway'
                              : route.tier === 'core'
                                ? 'BHNS'
                                : 'Bus'}{' '}
                            {route.shortName}
                          </span>
                          {route.routeType === 0 && (
                            <TramFront
                              className="w-3 h-3 text-slate-400 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {endpointText}
                        </p>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span
                          className={`font-mono-tabular text-xs font-medium ${
                            liveCount > 0 ? 'text-slate-100' : 'text-slate-500'
                          }`}
                        >
                          {liveCount}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {isEnabled ? t('sidebar.visible') : t('sidebar.hidden')}
                        </span>
                      </div>
                    </button>

                    {alertCount > 0 && onOpenRouteAlerts && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenRouteAlerts(route.id);
                          onCloseMobile?.();
                        }}
                        data-testid={`route-alert-trigger-${route.id}`}
                        title={
                          alertCount === 1
                            ? t('sidebar.routeAlertTitleOne', { line: route.shortName })
                            : t('sidebar.routeAlertTitleMany', {
                                count: alertCount,
                                line: route.shortName,
                              })
                        }
                        aria-label={
                          alertCount === 1
                            ? t('sidebar.routeAlertAriaOne', { line: route.shortName })
                            : t('sidebar.routeAlertAriaMany', {
                                count: alertCount,
                                line: route.shortName,
                              })
                        }
                        className="mr-2.5 p-1.5 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/15 transition-colors shrink-0"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'stations' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-800/70 flex items-center justify-between gap-2 text-xs text-slate-400">
            <span className="truncate">
              {normalizedQuery
                ? t('sidebar.matchingStations', {
                    count: pinnedStations.length + filteredStations.length,
                  })
                : t('sidebar.activeLineStops', {
                    count: pinnedStations.length + filteredStations.length,
                  })}
            </span>
            <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">
              {t('sidebar.clickForArrivals')}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto transit-scroll">
            {pinnedStations.length > 0 && (
              <div className="border-b border-slate-800/80 bg-[#0B101C]/70">
                <div className="px-4 py-1.5 flex items-center justify-between text-[11px] font-medium text-amber-300/90 border-b border-slate-800/60">
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {t('search.pinnedStops')}
                  </span>
                  <span className="font-mono-tabular text-slate-400">{pinnedStations.length}</span>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {pinnedStations.map((station) => {
                    const isSelected = station.id === selectedStationId;
                    return (
                      <div
                        key={`fav-${station.id}`}
                        className={`flex items-start transition-colors ${
                          isSelected ? 'bg-sky-500/15 text-white' : 'hover:bg-slate-800/45 text-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectStation(station);
                            onCloseMobile?.();
                          }}
                          className="flex-1 min-w-0 flex items-start gap-2.5 pl-4 pr-2 py-2.5 text-left"
                        >
                          <MapPin
                            className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                              isSelected ? 'text-sky-400' : 'text-amber-400/80'
                            }`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium truncate">
                                {formatShortStationLabel(station.name)}
                              </span>
                              {station.isMajorHub && (
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  {t('sidebar.hubBadge')}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              {station.routeIds.slice(0, 6).map((rid) => {
                                const r = routeById[rid];
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
                              {station.routeIds.length > 6 && (
                                <span className="text-[10px] text-slate-400 font-mono-tabular">
                                  +{station.routeIds.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteStation(station.id)}
                          aria-label={t('sidebar.unpinAria', { station: station.name })}
                          aria-pressed={true}
                          title={t('sidebar.unpinTitle')}
                          className="mt-2 mr-2.5 p-1.5 rounded-md text-amber-400 hover:bg-amber-500/15 transition-colors shrink-0"
                        >
                          <Star className="w-3.5 h-3.5 fill-amber-400" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="divide-y divide-slate-800/60">
              {pinnedStations.length === 0 && filteredStations.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  {t('sidebar.noStations')}
                </div>
              ) : (
                filteredStations.map((station) => {
                  const isSelected = station.id === selectedStationId;
                  return (
                    <div
                      key={station.id}
                      className={`group flex items-start transition-colors ${
                        isSelected
                          ? 'bg-sky-500/15 text-white'
                          : 'hover:bg-slate-800/45 text-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectStation(station);
                          onCloseMobile?.();
                        }}
                        className="flex-1 min-w-0 flex items-start gap-2.5 pl-4 pr-2 py-2.5 text-left"
                      >
                        <MapPin
                          className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                            isSelected ? 'text-sky-400' : 'text-slate-500'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium truncate">
                              {formatShortStationLabel(station.name)}
                            </span>
                            {station.isMajorHub && (
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {t('sidebar.hubBadge')}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {station.routeIds.slice(0, 6).map((rid) => {
                              const r = routeById[rid];
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
                            {station.routeIds.length > 6 && (
                              <span className="text-[10px] text-slate-400 font-mono-tabular">
                                +{station.routeIds.length - 6}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleFavoriteStation(station.id)}
                        aria-label={t('sidebar.pinAria', { station: station.name })}
                        aria-pressed={false}
                        title={t('sidebar.pinTitle')}
                        className="mt-2 mr-2.5 p-1.5 rounded-md text-slate-500 hover:text-amber-300 hover:bg-slate-800/80 transition-colors shrink-0"
                      >
                        <Star className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'vehicles' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
            <span>{t('sidebar.movingOnEnabled')}</span>
            <span className="font-mono-tabular text-slate-200">
              {filteredVehicles.length === 1
                ? t('sidebar.activeVehiclesCountOne')
                : t('sidebar.activeVehiclesCount', { count: filteredVehicles.length })}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto transit-scroll divide-y divide-slate-800/60">
            {filteredVehicles.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <Bus className="w-5 h-5 text-slate-500 mx-auto" aria-hidden="true" />
                <p className="text-xs text-slate-400">
                  {t('sidebar.noActiveVehicles')}
                </p>
              </div>
            ) : (
              filteredVehicles.map((veh) => {
                const isSelected = veh.id === selectedVehicleId;
                const delay = formatDelayStatus(veh.delaySeconds, locale);
                const nextEta = formatEtaCountdown(veh.nextArrTime, nowEpochSec, locale);

                return (
                  <button
                    key={veh.id}
                    type="button"
                    onClick={() => {
                      onSelectVehicle(veh);
                      onCloseMobile?.();
                    }}
                    className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'bg-sky-500/15 text-white'
                        : 'hover:bg-slate-800/45 text-slate-200'
                    }`}
                  >
                    <RouteBadge
                      shortName={veh.routeShortName}
                      color={veh.routeColor}
                      textColor={veh.routeTextColor}
                      size="sm"
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate">
                          → {formatShortStationLabel(veh.headsign)}
                        </span>
                        <span className="font-mono-tabular text-xs font-semibold text-sky-300 shrink-0">
                          {nextEta}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1 text-[11px]">
                        <span className="text-slate-400 truncate flex items-center gap-1">
                          <Navigation className="w-2.5 h-2.5 shrink-0 text-slate-500" aria-hidden="true" />
                          {t('sidebar.nextStopPrefix', {
                            stop: formatShortStationLabel(veh.nextStopName),
                          })}
                        </span>
                        <span
                          className={`shrink-0 font-mono-tabular ${
                            delay.tone === 'delayed'
                              ? 'text-amber-400'
                              : delay.tone === 'early'
                                ? 'text-sky-400'
                                : 'text-emerald-400'
                          }`}
                        >
                          {delay.label}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
      {mobileFooter && (
        <div className="px-4 py-3 border-t border-slate-800/80 bg-[#0B101C]/80 shrink-0">
          {mobileFooter}
        </div>
      )}
    </aside>
  );
});

ControlSidebar.displayName = 'ControlSidebar';
