import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BellRing,
  Check,
  ChevronRight,
  Clock,
  Crosshair,
  Link2,
  List,
  Navigation,
  RefreshCw,
  Split,
  Star,
  X,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import type {
  LiveVehicle,
  StationArrival,
  StationArrivalsResponse,
  TransitRoute,
  TransitStation,
} from '../types/transit';
import { groupStationArrivalsByDirection } from '../utils/stationGrouping';
import {
  computeSegmentProgress,
  formatDelayStatus,
  formatEtaCountdown,
  formatParisClock,
  formatShortStationLabel,
} from '../utils/transitMath';
import { RouteBadge } from './RouteBadge';

const RoutePunctualityChart = lazy(() => import('./RoutePunctualityChart'));

interface DetailInspectorProps {
  selectedStation: TransitStation | null;
  stationArrivals: StationArrivalsResponse | null;
  isLoadingStation: boolean;
  stationError: string | null;
  onRefreshStation: () => void;
  selectedVehicle: LiveVehicle | null;
  followVehicle: boolean;
  onToggleFollowVehicle: () => void;
  routesById: Record<string, TransitRoute>;
  stationsById: Record<string, TransitStation>;
  vehiclesById: Record<string, LiveVehicle>;
  onSelectStation: (station: TransitStation) => void;
  onSelectVehicle: (vehicle: LiveVehicle) => void;
  onClose: () => void;
  nowEpochSec: number;
  activeAlertCountByRoute?: Record<string, number>;
  onOpenRouteAlerts?: (routeId: string | null) => void;
  isStationFavorite?: boolean;
  onToggleFavoriteStation?: (stationId: string) => void;
  isReminderArmed?: (tripId: string, stopId: string) => boolean;
  onToggleReminder?: (arrival: StationArrival, station: TransitStation) => void;
}

export const DetailInspector: React.FC<DetailInspectorProps> = React.memo(({
  selectedStation,
  stationArrivals,
  isLoadingStation,
  stationError,
  onRefreshStation,
  selectedVehicle,
  followVehicle,
  onToggleFollowVehicle,
  routesById,
  stationsById,
  vehiclesById,
  onSelectStation,
  onSelectVehicle,
  onClose,
  nowEpochSec,
  activeAlertCountByRoute,
  onOpenRouteAlerts,
  isStationFavorite = false,
  onToggleFavoriteStation,
  isReminderArmed,
  onToggleReminder,
}) => {
  const { locale, t } = useI18n();
  const [routeFilter, setRouteFilter] = useState<string>('all');
  const [groupByDirection, setGroupByDirection] = useState<boolean>(true);
  const [vehicleTab, setVehicleTab] = useState<'trip' | 'punctuality'>('trip');
  const [copiedLink, setCopiedLink] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyShareLink = useCallback(() => {
    const url = window.location.href;
    const fallbackCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        // Ignore restricted clipboard environments
      }
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(url).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }

    setCopiedLink(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedLink(false), 1800);
  }, []);

  // Reset route filter if selected station doesn't have the chosen route
  const effectiveRouteFilter = useMemo(() => {
    if (!selectedStation || routeFilter === 'all') return 'all';
    return selectedStation.routeIds.includes(routeFilter) ? routeFilter : 'all';
  }, [selectedStation, routeFilter]);

  const filteredArrivals = useMemo(() => {
    if (!stationArrivals) return [];
    return stationArrivals.arrivals
      .filter((a) => a.arrivalTime >= nowEpochSec - 30)
      .filter((a) => effectiveRouteFilter === 'all' || a.routeId === effectiveRouteFilter);
  }, [stationArrivals, nowEpochSec, effectiveRouteFilter]);

  const groupedDirections = useMemo(
    () => groupStationArrivalsByDirection(filteredArrivals),
    [filteredArrivals]
  );

  if (!selectedStation && !selectedVehicle) {
    return null;
  }

  // Vehicle Inspector Mode
  if (selectedVehicle && !selectedStation) {
    const delay = formatDelayStatus(selectedVehicle.delaySeconds, locale);
    const progressPct = Math.round(
      computeSegmentProgress(
        nowEpochSec,
        selectedVehicle.prevDepTime,
        selectedVehicle.nextArrTime
      ) * 100
    );

    const routeAlertCount = activeAlertCountByRoute?.[selectedVehicle.routeId] || 0;

    return (
      <section
        aria-label={t('inspector.vehicleAria', {
          line: selectedVehicle.routeShortName,
          headsign: selectedVehicle.headsign,
        })}
        className="flex flex-col h-full w-full bg-[#0F1522] md:border-l border-slate-800/80 text-slate-100"
      >
        <div className="px-4 py-3.5 border-b border-slate-800/80 flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <RouteBadge
              shortName={selectedVehicle.routeShortName}
              color={selectedVehicle.routeColor}
              textColor={selectedVehicle.routeTextColor}
              size="md"
              className="mt-0.5"
            />
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-white truncate">
                {formatShortStationLabel(selectedVehicle.headsign)}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>
                  {selectedVehicle.routeType === 0
                    ? t('inspector.tramLine', { line: selectedVehicle.routeShortName })
                    : t('inspector.busLine', { line: selectedVehicle.routeShortName })}
                </span>
                {selectedVehicle.vehicleLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {t('inspector.unitLabel', { label: selectedVehicle.vehicleLabel })}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('inspector.closeVehicleAria')}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Connected Route Advisory Notice */}
        {routeAlertCount > 0 && onOpenRouteAlerts && (
          <button
            type="button"
            onClick={() => onOpenRouteAlerts(selectedVehicle.routeId)}
            data-testid="inspector-route-alert-banner"
            className="w-full px-4 py-2 border-b border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/15 flex items-center justify-between gap-2 text-left transition-colors"
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium text-amber-200 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {routeAlertCount === 1
                  ? t('inspector.routeAdvisoryOne', { line: selectedVehicle.routeShortName })
                  : t('inspector.routeAdvisoryMany', {
                      count: routeAlertCount,
                      line: selectedVehicle.routeShortName,
                    })}
              </span>
            </span>
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-300 shrink-0 whitespace-nowrap">
              {t('app.view')}
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          </button>
        )}

        {/* Vehicle View Switcher: Live Trip vs Route Punctuality History */}
        <div className="px-4 py-2.5 border-b border-slate-800/80">
          <div
            role="tablist"
            aria-label={t('inspector.vehicleTabsAria')}
            className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#090D16] border border-slate-800/80"
          >
            <button
              type="button"
              role="tab"
              aria-selected={vehicleTab === 'trip'}
              onClick={() => setVehicleTab('trip')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                vehicleTab === 'trip'
                  ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('inspector.tabLiveTrip')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={vehicleTab === 'punctuality'}
              onClick={() => setVehicleTab('punctuality')}
              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                vehicleTab === 'punctuality'
                  ? 'bg-slate-800/95 text-white ring-1 ring-white/10 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('inspector.tabPunctuality')}
            </button>
          </div>
        </div>

        {vehicleTab === 'punctuality' ? (
          <Suspense
            fallback={
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-12 rounded bg-slate-800/40 animate-pulse" />
                  <div className="h-12 rounded bg-slate-800/40 animate-pulse" />
                  <div className="h-12 rounded bg-slate-800/40 animate-pulse" />
                </div>
                <div className="h-[215px] rounded-lg bg-slate-800/40 animate-pulse" />
              </div>
            }
          >
            <RoutePunctualityChart
              routeId={selectedVehicle.routeId}
              routeShortName={selectedVehicle.routeShortName}
            />
          </Suspense>
        ) : (
          <>
            {/* Live segment & follow action */}
            <div className="px-4 py-3.5 border-b border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-medium font-mono-tabular ${
                    delay.tone === 'delayed'
                      ? 'text-amber-400'
                      : delay.tone === 'early'
                        ? 'text-sky-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {delay.label}
                </span>
                <button
                  type="button"
                  onClick={onToggleFollowVehicle}
                  aria-pressed={followVehicle}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    followVehicle
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/80'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                  {followVehicle ? t('inspector.following') : t('inspector.followVehicle')}
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 truncate max-w-[44%]">
                    {formatShortStationLabel(selectedVehicle.prevStopName)}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span className="text-slate-100 font-medium truncate max-w-[44%] text-right">
                    {formatShortStationLabel(selectedVehicle.nextStopName)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${progressPct}%`,
                      backgroundColor: selectedVehicle.routeColor,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono-tabular">
                  <span>
                    {t('inspector.depPrefix', {
                      time: formatParisClock(selectedVehicle.prevDepTime),
                    })}
                  </span>
                  <span>
                    {(() => {
                      const eta = formatEtaCountdown(
                        selectedVehicle.nextArrTime,
                        nowEpochSec,
                        locale
                      );
                      const isDueNow =
                        Math.round(selectedVehicle.nextArrTime - nowEpochSec) <= 45;
                      return isDueNow
                        ? t('inspector.arrivingNow')
                        : t('inspector.nextIn', { eta });
                    })()}{' '}
                    ·{' '}
                    {selectedVehicle.stopsRemaining === 1
                      ? t('inspector.stopsLeftOne')
                      : t('inspector.stopsLeftMany', {
                          count: selectedVehicle.stopsRemaining,
                        })}
                  </span>
                </div>
              </div>
            </div>

            {/* Upcoming stops timeline */}
            <div className="px-4 py-2.5 border-b border-slate-800/70 text-xs font-medium text-slate-400">
              {t('inspector.upcomingStopsTitle')}
            </div>
            <div className="flex-1 overflow-y-auto transit-scroll divide-y divide-slate-800/60">
              {selectedVehicle.upcomingStops.map((stop, index) => {
                const stationObj = stationsById[stop.stationId];
                const etaText = formatEtaCountdown(stop.arrivalTime, nowEpochSec, locale);
                return (
                  <button
                    key={`${stop.stopId}-${index}`}
                    type="button"
                    onClick={() => {
                      if (stationObj) onSelectStation(stationObj);
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-800/45 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 border-2"
                        style={{
                          borderColor: selectedVehicle.routeColor,
                          backgroundColor: index === 0 ? selectedVehicle.routeColor : '#0F1522',
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-100 truncate">
                          {formatShortStationLabel(stop.stationName)}
                        </div>
                        {index === 0 && (
                          <div className="text-[11px] text-sky-400">
                            {t('inspector.nextStopTag')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono-tabular text-xs font-semibold text-white">
                        {etaText}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-slate-400">
                        {formatParisClock(stop.arrivalTime)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    );
  }

  // Station Arrivals Inspector Mode
  const station = selectedStation!;
  const relevantRouteIds =
    effectiveRouteFilter !== 'all' ? [effectiveRouteFilter] : station.routeIds;
  const disruptedStationRouteIds = relevantRouteIds.filter(
    (rid) => (activeAlertCountByRoute?.[rid] || 0) > 0
  );
  const disruptedStationLineNames = disruptedStationRouteIds
    .map((rid) => routesById[rid]?.shortName || rid)
    .slice(0, 4);

  return (
    <section
      aria-label={t('inspector.stationAria', { station: station.name })}
      data-testid="station-arrivals-panel"
      className="flex flex-col h-full w-full bg-[#0F1522] md:border-l border-slate-800/80 text-slate-100"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-800/80 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white leading-snug">
            {formatShortStationLabel(station.name)}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-400 mt-1">
            <span className="whitespace-nowrap">{t('inspector.stationSubtitle')}</span>
            {station.wheelchairAccessible && (
              <span className="inline-flex items-center gap-1 text-slate-300 whitespace-nowrap">
                <Accessibility className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                {t('inspector.stepFree')}
              </span>
            )}
            {stationArrivals && (
              <span className="font-mono-tabular whitespace-nowrap text-slate-400">
                {t('inspector.updatedAt', {
                  time: formatParisClock(stationArrivals.feedTimestamp),
                })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {onToggleFavoriteStation && (
            <button
              type="button"
              onClick={() => onToggleFavoriteStation(station.id)}
              data-testid="station-favorite-btn"
              aria-pressed={isStationFavorite}
              aria-label={
                isStationFavorite
                  ? t('sidebar.unpinAria', { station: station.name })
                  : t('sidebar.pinAria', { station: station.name })
              }
              title={
                isStationFavorite ? t('inspector.removePinTitle') : t('sidebar.pinTitle')
              }
              className={`p-1.5 rounded-md transition-colors ${
                isStationFavorite
                  ? 'text-amber-400 hover:bg-amber-500/15'
                  : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
              }`}
            >
              <Star
                className={`w-4 h-4 ${isStationFavorite ? 'fill-amber-400' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyShareLink}
            data-testid="station-share-btn"
            aria-label={
              copiedLink ? t('inspector.linkCopiedAria') : t('inspector.copyLinkAria')
            }
            title={
              copiedLink ? t('inspector.linkCopiedTitle') : t('inspector.copyLinkTitle')
            }
            className={`p-1.5 rounded-md transition-colors ${
              copiedLink
                ? 'text-emerald-400 bg-emerald-500/15'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {copiedLink ? (
              <Check className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Link2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={onRefreshStation}
            aria-label={t('inspector.refreshStationAria')}
            title={t('inspector.refreshStationTitle')}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoadingStation ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('inspector.closeStationAria')}
            title={t('app.closeEsc')}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Connected Station Serving-Line Advisory Notice */}
      {disruptedStationRouteIds.length > 0 && onOpenRouteAlerts && (
        <button
          type="button"
          onClick={() =>
            onOpenRouteAlerts(
              disruptedStationRouteIds.length === 1 ? disruptedStationRouteIds[0] : null
            )
          }
          data-testid="inspector-station-alert-banner"
          className="w-full px-4 py-2 border-b border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/15 flex items-center justify-between gap-2 text-left transition-colors"
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium text-amber-200 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {disruptedStationRouteIds.length === 1
                ? t('inspector.stationAdvisoriesOne', {
                    lines: disruptedStationLineNames.join(', '),
                  })
                : t('inspector.stationAdvisoriesMany', {
                    lines:
                      disruptedStationLineNames.join(', ') +
                      (disruptedStationRouteIds.length > 4
                        ? ` +${disruptedStationRouteIds.length - 4}`
                        : ''),
                  })}
            </span>
          </span>
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-300 shrink-0 whitespace-nowrap">
            {t('app.view')}
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
        </button>
      )}

      {/* Serving Lines Filter Bar */}
      {station.routeIds.length > 0 && (
        <div className="px-4 py-2.5 border-b border-slate-800/70 flex items-center gap-1.5 overflow-x-auto transit-scroll">
          <button
            type="button"
            onClick={() => setRouteFilter('all')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              effectiveRouteFilter === 'all'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            {t('inspector.allLines')}
          </button>
          {station.routeIds.map((rid) => {
            const route = routesById[rid];
            if (!route) return null;
            const active = effectiveRouteFilter === rid;
            return (
              <button
                key={rid}
                type="button"
                onClick={() => setRouteFilter(active ? 'all' : rid)}
                aria-pressed={active}
                className={`p-0.5 rounded-md transition-all shrink-0 ${
                  active
                    ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-[#0F1522]'
                    : 'opacity-75 hover:opacity-100'
                }`}
                title={t('inspector.filterByLineTitle', { line: route.shortName })}
              >
                <RouteBadge
                  shortName={route.shortName}
                  color={route.color}
                  textColor={route.textColor}
                  size="xs"
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Direction Grouping Toggle & Column Header Bar */}
      <div className="px-4 py-2 border-b border-slate-800/70 flex items-center justify-between gap-2 text-[11px] font-medium text-slate-400">
        <div
          role="group"
          aria-label={t('inspector.viewByDirection')}
          className="inline-flex items-center p-0.5 rounded-md bg-[#090D16] border border-slate-800/80"
        >
          <button
            type="button"
            onClick={() => setGroupByDirection(true)}
            aria-pressed={groupByDirection}
            data-testid="station-view-grouped-btn"
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
              groupByDirection
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Split className="w-3 h-3" aria-hidden="true" />
            {t('inspector.viewByDirection')}
          </button>
          <button
            type="button"
            onClick={() => setGroupByDirection(false)}
            aria-pressed={!groupByDirection}
            data-testid="station-view-chrono-btn"
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
              !groupByDirection
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <List className="w-3 h-3" aria-hidden="true" />
            {t('inspector.viewChrono')}
          </button>
        </div>
        <span className="text-right shrink-0">{t('inspector.colArrival')}</span>
      </div>

      {/* Live Arrivals List (Grouped by Direction or Chronological) */}
      <div className="flex-1 overflow-y-auto transit-scroll divide-y divide-slate-800/60">
        {isLoadingStation && !stationArrivals ? (
          <div className="p-4 space-y-2.5">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-14 rounded-lg bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : stationError ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-xs text-rose-300">{stationError}</p>
            <button
              type="button"
              onClick={onRefreshStation}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
            >
              {t('app.retry')}
            </button>
          </div>
        ) : filteredArrivals.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <Clock className="w-5 h-5 text-slate-500 mx-auto" aria-hidden="true" />
            <p className="text-xs font-medium text-slate-300">
              {t('inspector.noDeparturesTitle')}
            </p>
            <p className="text-[11px] text-slate-400">
              {t('inspector.noDeparturesBody')}
            </p>
          </div>
        ) : groupByDirection ? (
          groupedDirections.map((group) => (
            <div key={group.key} data-testid="station-direction-group" className="bg-[#0F1522]">
              <div className="px-4 py-2 bg-[#0B101C]/85 border-b border-slate-800/60 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RouteBadge
                    shortName={group.routeShortName}
                    color={group.routeColor}
                    textColor={group.routeTextColor}
                    size="xs"
                  />
                  <span className="text-xs font-semibold text-white truncate">
                    → {group.displayHeadsign}
                  </span>
                </div>
                <span className="text-[10px] font-mono-tabular text-slate-400 shrink-0">
                  {t('inspector.nextDeparturesCount', { count: group.arrivals.length })}
                </span>
              </div>
              <div className="divide-y divide-slate-800/50">
                {group.arrivals.slice(0, 4).map((arrival, idx) => {
                  const countdown = formatEtaCountdown(arrival.arrivalTime, nowEpochSec, locale);
                  const clockTime = formatParisClock(arrival.arrivalTime);
                  const delay = formatDelayStatus(arrival.delaySeconds, locale);
                  const liveVeh = arrival.vehicleId ? vehiclesById[arrival.vehicleId] : undefined;
                  const isDue = Math.round(arrival.arrivalTime - nowEpochSec) <= 45;
                  const armed = isReminderArmed?.(arrival.tripId, arrival.stopId) ?? false;

                  return (
                    <div
                      key={`${arrival.tripId}-${arrival.stopId}-${idx}`}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/35 transition-colors"
                    >
                      <div className="min-w-0 flex items-center gap-2 text-[11px]">
                        <span
                          className={`font-mono-tabular ${
                            delay.tone === 'delayed'
                              ? 'text-amber-400'
                              : delay.tone === 'early'
                                ? 'text-sky-400'
                                : 'text-emerald-400'
                          }`}
                        >
                          {delay.label}
                        </span>
                        {liveVeh && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <button
                              type="button"
                              onClick={() => onSelectVehicle(liveVeh)}
                              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-medium transition-colors"
                            >
                              <Navigation className="w-2.5 h-2.5" aria-hidden="true" />
                              {t('inspector.trackLive')}
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        {onToggleReminder && !isDue && (
                          <button
                            type="button"
                            onClick={() => onToggleReminder(arrival, station)}
                            data-testid="arrival-reminder-btn"
                            aria-pressed={armed}
                            aria-label={
                              armed
                                ? t('reminder.removeAria', {
                                    line: arrival.routeShortName,
                                    headsign: group.displayHeadsign,
                                  })
                                : t('reminder.setAria', {
                                    line: arrival.routeShortName,
                                    headsign: group.displayHeadsign,
                                  })
                            }
                            title={armed ? t('reminder.armedTitle') : t('reminder.setTitle')}
                            className={`p-1.5 rounded-md transition-colors ${
                              armed
                                ? 'text-amber-300 bg-amber-500/15 hover:bg-amber-500/25'
                                : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {armed ? (
                              <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                          </button>
                        )}
                        <div className="text-right min-w-[54px]">
                          <div
                            className={`font-mono-tabular text-sm font-semibold ${
                              isDue ? 'text-emerald-400' : 'text-white'
                            }`}
                          >
                            {countdown}
                          </div>
                          <div className="font-mono-tabular text-[11px] text-slate-400">
                            {clockTime}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          filteredArrivals.map((arrival, idx) => {
            const countdown = formatEtaCountdown(arrival.arrivalTime, nowEpochSec, locale);
            const clockTime = formatParisClock(arrival.arrivalTime);
            const delay = formatDelayStatus(arrival.delaySeconds, locale);
            const liveVeh = arrival.vehicleId ? vehiclesById[arrival.vehicleId] : undefined;
            const isDue = Math.round(arrival.arrivalTime - nowEpochSec) <= 45;
            const armed = isReminderArmed?.(arrival.tripId, arrival.stopId) ?? false;
            const shortHeadsign = formatShortStationLabel(arrival.headsign);

            return (
              <div
                key={`${arrival.tripId}-${arrival.stopId}-${idx}`}
                className="px-4 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-3 hover:bg-slate-800/35 transition-colors"
              >
                <RouteBadge
                  shortName={arrival.routeShortName}
                  color={arrival.routeColor}
                  textColor={arrival.routeTextColor}
                  size="sm"
                />

                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-100 truncate">
                    {shortHeadsign}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px]">
                    <span
                      className={`font-mono-tabular ${
                        delay.tone === 'delayed'
                          ? 'text-amber-400'
                          : delay.tone === 'early'
                            ? 'text-sky-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {delay.label}
                    </span>
                    {liveVeh && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectVehicle(liveVeh)}
                          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-medium transition-colors"
                        >
                          <Navigation className="w-2.5 h-2.5" aria-hidden="true" />
                          {t('inspector.trackLive')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {onToggleReminder && !isDue && (
                    <button
                      type="button"
                      onClick={() => onToggleReminder(arrival, station)}
                      data-testid="arrival-reminder-btn"
                      aria-pressed={armed}
                      aria-label={
                        armed
                          ? t('reminder.removeAria', {
                              line: arrival.routeShortName,
                              headsign: shortHeadsign,
                            })
                          : t('reminder.setAria', {
                              line: arrival.routeShortName,
                              headsign: shortHeadsign,
                            })
                      }
                      title={armed ? t('reminder.armedTitle') : t('reminder.setTitle')}
                      className={`p-1.5 rounded-md transition-colors ${
                        armed
                          ? 'text-amber-300 bg-amber-500/15 hover:bg-amber-500/25'
                          : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {armed ? (
                        <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                  )}
                  <div className="text-right min-w-[54px]">
                    <div
                      className={`font-mono-tabular text-sm font-semibold ${
                        isDue ? 'text-emerald-400' : 'text-white'
                      }`}
                    >
                      {countdown}
                    </div>
                    <div className="font-mono-tabular text-[11px] text-slate-400">
                      {clockTime}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
});

DetailInspector.displayName = 'DetailInspector';
