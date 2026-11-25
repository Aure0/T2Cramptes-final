import React, { useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  History,
  Info,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type {
  AlertCause,
  AlertStatus,
  ServiceAlert,
  ServiceAlertsResponse,
  TransitRoute,
} from '../types/transit';
import {
  filterAlertsByActiveRoutes,
  formatAlertDuration,
  formatCauseLabel,
  formatEffectLabel,
  formatParisDateTime,
} from '../utils/alertsMath';
import { useI18n } from '../contexts/I18nContext';
import {
  localizeAlertFeedSource,
  localizeAlertLinkLabel,
  localizeRevisionSummary,
  localizeServiceAlertText,
  type TranslationKey,
} from '../utils/i18n';
import { normalizeSearchText } from '../utils/transitMath';
import { RouteBadge } from './RouteBadge';

export type AlertsDrawerTab = 'active' | 'history';

interface ServiceAlertsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  alertsData: ServiceAlertsResponse | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  enabledRouteIds: Set<string>;
  routesById: Record<string, TransitRoute>;
  onFocusRoutes: (routeIds: string[]) => void;
  nowEpochSec: number;
  initialRouteFilter?: string | null;
}

function severityMeta(
  alert: ServiceAlert,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): {
  label: string;
  textClass: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  if (alert.status === 'resolved') {
    return {
      label: t('alerts.sevResolved'),
      textClass: 'text-emerald-400',
      Icon: CheckCircle2,
    };
  }
  if (alert.severity === 'severe') {
    return {
      label: t('alerts.sevSevere'),
      textClass: 'text-rose-400',
      Icon: AlertOctagon,
    };
  }
  if (alert.severity === 'moderate') {
    return {
      label: t('alerts.sevModerate'),
      textClass: 'text-amber-400',
      Icon: AlertTriangle,
    };
  }
  return {
    label: t('alerts.sevAdvisory'),
    textClass: 'text-sky-400',
    Icon: Info,
  };
}

export const ServiceAlertsDrawer: React.FC<ServiceAlertsDrawerProps> = React.memo(({
  isOpen,
  onClose,
  alertsData,
  isLoading,
  error,
  onRefresh,
  enabledRouteIds,
  routesById,
  onFocusRoutes,
  nowEpochSec,
  initialRouteFilter = null,
}) => {
  const { locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<AlertsDrawerTab>('active');
  const [scope, setScope] = useState<'active-lines' | 'all-network'>('active-lines');
  const [routeFilter, setRouteFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | AlertStatus>('all');
  const [causeFilter, setCauseFilter] = useState<'ALL' | AlertCause>('ALL');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allActiveAlerts = alertsData?.activeAlerts || [];
  const allHistory = alertsData?.history || [];

  const activeSetAlerts = useMemo(
    () => filterAlertsByActiveRoutes(allActiveAlerts, enabledRouteIds),
    [allActiveAlerts, enabledRouteIds]
  );

  // Sync initial scope, route filter, and first expanded item when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    if (initialRouteFilter) {
      setActiveTab('active');
      setScope('all-network');
      setRouteFilter(initialRouteFilter);
      const firstMatch = allActiveAlerts.find((a) =>
        a.affectedRouteIds.includes(initialRouteFilter)
      );
      setExpandedId(firstMatch ? firstMatch.id : null);
      return;
    }
    setRouteFilter('ALL');
    if (activeSetAlerts.length > 0) {
      setScope('active-lines');
      setExpandedId(activeSetAlerts[0].id);
    } else if (allActiveAlerts.length > 0) {
      setScope('all-network');
      setExpandedId(allActiveAlerts[0].id);
    } else {
      setExpandedId(null);
    }
  }, [isOpen, initialRouteFilter, activeSetAlerts.length, allActiveAlerts.length]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const impactedRouteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of allHistory) {
      for (const rid of a.affectedRouteIds) ids.add(rid);
    }
    return Array.from(ids).sort(
      (a, b) => (routesById[a]?.sortOrder ?? 999) - (routesById[b]?.sortOrder ?? 999)
    );
  }, [allHistory, routesById]);

  const availableCauses = useMemo(() => {
    const set = new Set<AlertCause>();
    for (const a of allHistory) set.add(a.cause);
    return Array.from(set);
  }, [allHistory]);

  const filteredList = useMemo(() => {
    const base = activeTab === 'active' ? allActiveAlerts : allHistory;
    const q = normalizeSearchText(query);

    return base.filter((alert) => {
      if (scope === 'active-lines') {
        const hitsActive = alert.affectedRouteIds.some((rid) => enabledRouteIds.has(rid));
        if (!hitsActive) return false;
      }
      if (routeFilter !== 'ALL' && !alert.affectedRouteIds.includes(routeFilter)) {
        return false;
      }
      if (activeTab === 'history' && statusFilter !== 'all' && alert.status !== statusFilter) {
        return false;
      }
      if (causeFilter !== 'ALL' && alert.cause !== causeFilter) {
        return false;
      }
      if (q) {
        const routeNames = alert.affectedRouteIds
          .map((rid) => routesById[rid]?.shortName || rid)
          .join(' ');
        const haystack = normalizeSearchText(
          `${alert.headerText} ${alert.descriptionPlain} ${alert.affectedStopNames.join(' ')} ${routeNames} ${alert.id}`
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    activeTab,
    allActiveAlerts,
    allHistory,
    scope,
    enabledRouteIds,
    routeFilter,
    statusFilter,
    causeFilter,
    query,
    routesById,
  ]);

  const impactedActiveRouteCount = useMemo(() => {
    const set = new Set<string>();
    for (const a of allActiveAlerts) {
      for (const rid of a.affectedRouteIds) set.add(rid);
    }
    return set.size;
  }, [allActiveAlerts]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('alerts.drawerAria')}
      data-testid="service-alerts-drawer"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div className="relative z-10 w-full max-w-2xl h-[100dvh] bg-[#0F1522] border-l border-slate-800/90 shadow-2xl flex flex-col text-slate-100 pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-800/80 flex items-center justify-between gap-2.5 sm:gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  activeSetAlerts.length > 0 ? 'text-amber-400' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <h2 className="font-display text-sm sm:text-base font-bold text-white truncate">
                {t('alerts.title')}
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {alertsData
                ? t('alerts.subtitleUpdated', {
                    source: localizeAlertFeedSource(alertsData.feedSource, locale),
                    time: formatParisDateTime(alertsData.feedTimestamp, locale),
                  })
                : t('alerts.connecting')}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label={t('alerts.refreshAria')}
              className="inline-flex items-center justify-center gap-1.5 h-9 sm:h-auto px-2.5 sm:py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-xs font-medium text-slate-200 border border-slate-700/80 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">{t('app.refresh')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('alerts.closeAria')}
              className="w-9 h-9 sm:w-auto sm:h-auto sm:p-1.5 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Flat Responsive Operational KPI Strip (2x2 on mobile, 4-col on sm+) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-800/80 bg-[#0B101B] shrink-0">
          <div className="px-4 py-2.5 border-r border-b sm:border-b-0 border-slate-800/80">
            <div className="text-[11px] text-slate-400 whitespace-nowrap">
              {t('alerts.kpiYourLines')}
            </div>
            <div
              className={`font-mono-tabular text-base sm:text-lg font-bold leading-tight mt-0.5 ${
                activeSetAlerts.length > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {activeSetAlerts.length}
            </div>
          </div>
          <div className="px-4 py-2.5 sm:border-r border-b sm:border-b-0 border-slate-800/80">
            <div className="text-[11px] text-slate-400 whitespace-nowrap">
              {t('alerts.kpiNetworkActive')}
            </div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-slate-100 leading-tight mt-0.5">
              {allActiveAlerts.length}
            </div>
          </div>
          <div className="px-4 py-2.5 border-r border-slate-800/80">
            <div className="text-[11px] text-slate-400 whitespace-nowrap">
              {t('alerts.kpiHistoryLog')}
            </div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-sky-400 leading-tight mt-0.5">
              {allHistory.length}
            </div>
          </div>
          <div className="px-4 py-2.5">
            <div className="text-[11px] text-slate-400 whitespace-nowrap">
              {t('alerts.kpiLinesImpacted')}
            </div>
            <div className="font-mono-tabular text-base sm:text-lg font-bold text-slate-200 leading-tight mt-0.5">
              {impactedActiveRouteCount}
            </div>
          </div>
        </div>

        {/* Tab Bar & Scope Controls */}
        <div className="px-4 sm:px-5 pt-3 pb-3 border-b border-slate-800/80 space-y-2.5 shrink-0 bg-[#0E1421]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Primary Tabs: Active Alerts vs Disruption History */}
            <div
              role="tablist"
              aria-label={t('alerts.tablistAria')}
              className="inline-flex p-0.5 rounded-lg bg-[#090D16] border border-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'active'}
                onClick={() => setActiveTab('active')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'active'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('alerts.tabActive')}</span>
                <span className="font-mono-tabular text-[11px] text-slate-400">
                  ({allActiveAlerts.length})
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'history'}
                onClick={() => {
                  setActiveTab('history');
                  setExpandedId(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'history'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('alerts.tabHistory')}</span>
                <span className="font-mono-tabular text-[11px] text-slate-400">
                  ({allHistory.length})
                </span>
              </button>
            </div>

            {/* Scope Filter: Your Active Lines vs Full Network */}
            <div className="inline-flex p-0.5 rounded-lg bg-[#090D16] border border-slate-800">
              <button
                type="button"
                onClick={() => setScope('active-lines')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  scope === 'active-lines'
                    ? 'bg-[#1D3557] text-sky-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('alerts.scopeActiveLines', { count: activeSetAlerts.length })}
              </button>
              <button
                type="button"
                onClick={() => setScope('all-network')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  scope === 'all-network'
                    ? 'bg-[#1D3557] text-sky-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('alerts.scopeAllNetwork')}
              </button>
            </div>
          </div>

          {/* Search & Granular Filters */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
            <div className="relative flex-1 min-w-0 sm:min-w-[180px]">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('alerts.filterPlaceholder')}
                aria-label={t('alerts.filterAria')}
                className="w-full h-8 pl-8 pr-7 rounded-md bg-[#090D16] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/70"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('alerts.clearFilterAria')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label={t('alerts.filterLineAria')}
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
                className="flex-1 sm:flex-none min-w-0 h-8 px-2.5 rounded-md bg-[#090D16] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500/70"
              >
                <option value="ALL">{t('alerts.allLines')}</option>
                {impactedRouteIds.map((rid) => {
                  const r = routesById[rid];
                  return (
                    <option key={rid} value={rid}>
                      {t('alerts.lineOption', { line: r ? r.shortName : rid })}
                    </option>
                  );
                })}
              </select>

              <select
                aria-label={t('alerts.filterCauseAria')}
                value={causeFilter}
                onChange={(e) => setCauseFilter(e.target.value as 'ALL' | AlertCause)}
                className="flex-1 sm:flex-none min-w-0 h-8 px-2.5 rounded-md bg-[#090D16] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500/70"
              >
                <option value="ALL">{t('alerts.allCauses')}</option>
                {availableCauses.map((c) => (
                  <option key={c} value={c}>
                    {formatCauseLabel(c, locale)}
                  </option>
                ))}
              </select>

              {activeTab === 'history' && (
                <select
                  aria-label={t('alerts.filterStatusAria')}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | AlertStatus)}
                  className="flex-1 sm:flex-none min-w-0 h-8 px-2.5 rounded-md bg-[#090D16] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500/70"
                >
                  <option value="all">{t('alerts.allStatuses')}</option>
                  <option value="active">{t('alerts.statusActiveOnly')}</option>
                  <option value="resolved">{t('alerts.statusResolvedOnly')}</option>
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Alerts & History List */}
        <div className="flex-1 overflow-y-auto transit-scroll divide-y divide-slate-800/75">
          {error && (
            <div className="m-4 p-3 rounded-lg bg-rose-950/60 border border-rose-800/70 flex items-center justify-between gap-3 text-xs text-rose-200">
              <span>{error}</span>
              <button
                type="button"
                onClick={onRefresh}
                className="px-2.5 py-1 rounded bg-rose-900 hover:bg-rose-800 text-white font-medium whitespace-nowrap"
              >
                {t('app.retry')}
              </button>
            </div>
          )}

          {isLoading && !alertsData && (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-lg bg-slate-900/70 border border-slate-800/80 animate-pulse"
                />
              ))}
            </div>
          )}

          {!isLoading && filteredList.length === 0 && (
            <div className="px-6 py-14 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400/80 mx-auto mb-3" aria-hidden="true" />
              <div className="text-sm font-semibold text-slate-100">
                {scope === 'active-lines'
                  ? t('alerts.emptyActiveTitle')
                  : t('alerts.emptyFilterTitle')}
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {scope === 'active-lines' && allActiveAlerts.length > 0
                  ? t('alerts.emptyOtherLinesBody', { count: allActiveAlerts.length })
                  : t('alerts.emptyNormalBody')}
              </p>
              {scope === 'active-lines' && allActiveAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setScope('all-network')}
                  className="mt-4 px-3.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-sky-300 border border-slate-700 transition-colors"
                >
                  {t('alerts.viewAllDisruptions', { count: allActiveAlerts.length })}
                </button>
              )}
            </div>
          )}

          {filteredList.map((alert) => {
            const isExpanded = expandedId === alert.id;
            const meta = severityMeta(alert, t);
            const StatusIcon = meta.Icon;
            const affectsEnabledSet = alert.affectedRouteIds.some((rid) => enabledRouteIds.has(rid));
            const localizedAlert = localizeServiceAlertText(alert, locale);
            const durationText = formatAlertDuration(
              alert.startTime,
              alert.resolvedAt ?? alert.endTime,
              nowEpochSec,
              locale
            );

            return (
              <article
                key={alert.id}
                data-testid={`alert-item-${alert.id}`}
                className="bg-[#0F1522] transition-colors"
              >
                {/* Clickable Summary Header */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                  aria-expanded={isExpanded}
                  className={`w-full text-left px-4 sm:px-5 py-3.5 transition-colors focus:outline-none ${
                    isExpanded ? 'bg-slate-900/55' : 'hover:bg-slate-900/45'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {/* Top Metadata Row: Route Badges + Status + Cause/Effect */}
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <div className="flex items-center gap-1">
                          {alert.affectedRouteIds.slice(0, 6).map((rid) => {
                            const r = routesById[rid];
                            return (
                              <RouteBadge
                                key={rid}
                                shortName={r ? r.shortName : rid}
                                color={r ? r.color : '#475569'}
                                textColor={r ? r.textColor : '#FFFFFF'}
                                size="xs"
                              />
                            );
                          })}
                          {alert.affectedRouteIds.length > 6 && (
                            <span className="font-mono-tabular text-[11px] text-slate-400">
                              +{alert.affectedRouteIds.length - 6}
                            </span>
                          )}
                        </div>

                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${meta.textClass}`}>
                          <StatusIcon className="w-3 h-3" aria-hidden="true" />
                          <span>{meta.label}</span>
                        </span>

                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>

                        <span className="text-[11px] text-slate-300 font-medium">
                          {formatEffectLabel(alert.effect, locale)}
                        </span>

                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>

                        <span className="text-[11px] text-slate-400">
                          {formatCauseLabel(alert.cause, locale)}
                        </span>

                        {affectsEnabledSet && alert.status !== 'resolved' && (
                          <span className="text-[11px] font-medium text-amber-300/90 sm:ml-auto whitespace-nowrap">
                            {t('alerts.activeLineTag')}
                          </span>
                        )}
                      </div>

                      {/* Alert Headline */}
                      <h3 className="text-sm font-semibold text-slate-100 leading-snug">
                        {localizedAlert.headerText}
                      </h3>

                      {/* Compact Timeline Metadata */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1 font-mono-tabular">
                          <Clock className="w-3 h-3 text-slate-500" aria-hidden="true" />
                          <span>{durationText}</span>
                        </span>
                        {alert.updatedAt && (
                          <span className="font-mono-tabular">
                            {t('inspector.updatedAt', {
                              time: formatParisDateTime(alert.updatedAt, locale),
                            })}
                          </span>
                        )}
                        {alert.affectedStopNames.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-500" aria-hidden="true" />
                            <span>
                              {alert.affectedStopNames.length === 1
                                ? t('alerts.stopsReferencedOne')
                                : t('alerts.stopsReferencedMany', {
                                    count: alert.affectedStopNames.length,
                                  })}
                            </span>
                          </span>
                        )}
                        <span className="font-mono-tabular text-slate-500">ID {alert.id}</span>
                      </div>
                    </div>

                    <span className="p-1 text-slate-400 shrink-0 mt-0.5" aria-hidden="true">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </span>
                  </div>
                </button>

                {/* Expanded Comprehensive Disruption Details */}
                {isExpanded && (
                  <div
                    className="px-4 sm:px-5 pb-4 pt-1 bg-[#0B101B] border-t border-slate-800/70 space-y-4"
                    data-testid="alert-detail-body"
                  >
                    {/* Key-Value Technical Grid */}
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 pt-2.5 text-xs">
                      <div>
                        <dt className="text-[11px] text-slate-500">{t('alerts.metaStart')}</dt>
                        <dd className="font-mono-tabular text-slate-200 mt-0.5">
                          {alert.startTime
                            ? formatParisDateTime(alert.startTime, locale)
                            : t('alerts.metaImmediate')}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-slate-500">
                          {alert.resolvedAt
                            ? t('alerts.metaResolvedAt')
                            : t('alerts.metaScheduledEnd')}
                        </dt>
                        <dd className="font-mono-tabular text-slate-200 mt-0.5">
                          {alert.resolvedAt
                            ? formatParisDateTime(alert.resolvedAt, locale)
                            : formatParisDateTime(alert.endTime, locale)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-slate-500">{t('alerts.metaLastUpdate')}</dt>
                        <dd className="font-mono-tabular text-slate-200 mt-0.5">
                          {alert.updatedAt ? formatParisDateTime(alert.updatedAt, locale) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-slate-500">
                          {t('alerts.metaCauseEffect')}
                        </dt>
                        <dd className="text-slate-200 mt-0.5">
                          {formatCauseLabel(alert.cause, locale)} ·{' '}
                          {formatEffectLabel(alert.effect, locale)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-slate-500">{t('alerts.metaFeedSource')}</dt>
                        <dd className="text-slate-200 mt-0.5">{localizedAlert.sourceLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-slate-500">{t('alerts.metaIdPriority')}</dt>
                        <dd className="font-mono-tabular text-slate-200 mt-0.5">
                          {alert.id} · P{alert.priority}
                        </dd>
                      </div>
                    </dl>

                    {/* Affected / Relocated Stops */}
                    {alert.affectedStopNames.length > 0 && (
                      <div className="pt-2.5 border-t border-slate-800/70">
                        <div className="text-[11px] font-medium text-slate-400 mb-1.5">
                          {t('alerts.impactedStops', { count: alert.affectedStopNames.length })}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-200">
                          {alert.affectedStopNames.map((stop) => (
                            <span key={stop} className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-sky-400 shrink-0" aria-hidden="true" />
                              <span>{stop}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Accessibility Caveat (PMR) */}
                    {alert.accessibilityNote && (
                      <div className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/8 text-xs text-amber-200 flex items-start gap-2">
                        <Accessibility
                          className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span>{alert.accessibilityNote}</span>
                      </div>
                    )}

                    {/* Official Advisory Body (Safely Structured) */}
                    {(alert.paragraphs.length > 0 || alert.bulletPoints.length > 0) && (
                      <div className="pt-2.5 border-t border-slate-800/70 space-y-2">
                        <div className="text-[11px] font-medium text-slate-400">
                          {t('alerts.officialDetails')}
                        </div>
                        {localizedAlert.paragraphs.map((p, idx) => (
                          <p key={idx} className="text-xs text-slate-300 leading-relaxed">
                            {p}
                          </p>
                        ))}
                        {alert.bulletPoints.length > 0 && (
                          <ul className="space-y-1.5 pl-4 list-disc text-xs text-slate-300 leading-relaxed marker:text-slate-500">
                            {alert.bulletPoints.map((bp, idx) => (
                              <li key={idx}>{bp}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* External Official Links */}
                    {alert.links.length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {alert.links.map((link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-2"
                          >
                            <span>{localizeAlertLinkLabel(link.label, locale)}</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Chronological Revision & Lifecycle Timeline */}
                    {alert.revisionHistory.length > 0 && (
                      <div className="pt-2.5 border-t border-slate-800/70">
                        <div className="text-[11px] font-medium text-slate-400 mb-2">
                          {t('alerts.revisionLog')}
                        </div>
                        <ol className="space-y-2 border-l border-slate-700/80 ml-1.5 pl-3.5">
                          {alert.revisionHistory.map((ev, idx) => (
                            <li key={`${ev.kind}-${ev.timestamp}-${idx}`} className="relative text-xs">
                              <span
                                className={`w-2 h-2 rounded-full absolute -left-[18.5px] top-1.5 ${
                                  ev.kind === 'resolved'
                                    ? 'bg-emerald-400'
                                    : ev.kind === 'updated'
                                      ? 'bg-amber-400'
                                      : ev.kind === 'observed'
                                        ? 'bg-sky-400'
                                        : 'bg-slate-400'
                                }`}
                                aria-hidden="true"
                              />
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-slate-200">
                                  {localizeRevisionSummary(ev.summary, locale)}
                                </span>
                                <span className="font-mono-tabular text-[11px] text-slate-400">
                                  {formatParisDateTime(ev.timestamp, locale)}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Action Footer */}
                    {alert.affectedRouteIds.length > 0 && (
                      <div className="pt-2.5 border-t border-slate-800/70 flex items-center justify-between gap-3">
                        <span className="text-[11px] text-slate-400">
                          {t('alerts.firstObserved')}{' '}
                          <span className="font-mono-tabular text-slate-300">
                            {formatParisDateTime(alert.firstSeenAt, locale)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onFocusRoutes(alert.affectedRouteIds);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1D3557] hover:bg-[#264673] text-xs font-medium text-sky-100 border border-sky-500/30 transition-colors whitespace-nowrap"
                        >
                          <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {alert.affectedRouteIds.length === 1
                              ? t('alerts.showOneLineOnMap', {
                                  line:
                                    routesById[alert.affectedRouteIds[0]]?.shortName ||
                                    alert.affectedRouteIds[0],
                                })
                              : t('alerts.showManyLinesOnMap', {
                                  count: alert.affectedRouteIds.length,
                                })}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
});

ServiceAlertsDrawer.displayName = 'ServiceAlertsDrawer';
