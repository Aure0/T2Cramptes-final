import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { fetchRoutePunctualityData } from '../services/transitClient';
import type {
  PunctualityBucket,
  PunctualityPeriod,
  RoutePunctualityResponse,
} from '../types/transit';
import { localizePunctualityLabel } from '../utils/i18n';
import { formatAvgDelaySeconds } from '../utils/punctualityMath';

interface RoutePunctualityChartProps {
  routeId: string;
  routeShortName: string;
}

type ChartMode = 'early-late' | 'full-split';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PunctualityBucket }>;
}

const PunctualityTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  const { locale, t } = useI18n();
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;

  return (
    <div className="rounded-lg bg-[#090D16]/95 border border-slate-700/90 px-3 py-2.5 shadow-xl text-xs space-y-1.5 min-w-[170px]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1">
        <span className="font-medium text-white">
          {localizePunctualityLabel(bucket.label, locale)}
        </span>
        <span className="text-[10px] text-slate-400">
          {bucket.source === 'live'
            ? t('punctuality.sourceLive')
            : t('punctuality.sourceBaseline')}
        </span>
      </div>
      <div className="space-y-1 font-mono-tabular">
        <div className="flex items-center justify-between gap-4">
          <span className="text-emerald-400">{t('punctuality.onTime')}</span>
          <span className="text-slate-100 font-medium">{bucket.onTimePct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-amber-400">{t('punctuality.late')}</span>
          <span className="text-slate-100 font-medium">{bucket.latePct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sky-400">{t('punctuality.early')}</span>
          <span className="text-slate-100 font-medium">{bucket.earlyPct.toFixed(1)}%</span>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono-tabular">
        <span>
          {t('punctuality.avgLabel', {
            value: formatAvgDelaySeconds(bucket.avgDelaySec, locale),
          })}
        </span>
        <span>n={bucket.sampleCount.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}</span>
      </div>
    </div>
  );
};

export const RoutePunctualityChart: React.FC<RoutePunctualityChartProps> = React.memo(({
  routeId,
  routeShortName,
}) => {
  const { locale, t } = useI18n();
  const [period, setPeriod] = useState<PunctualityPeriod>('24h');
  const [chartMode, setChartMode] = useState<ChartMode>('early-late');
  const [data, setData] = useState<RoutePunctualityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const periodOptions = useMemo<
    Array<{ id: PunctualityPeriod; label: string; title: string }>
  >(
    () => [
      { id: '6h', label: t('punctuality.period6h'), title: t('punctuality.period6hTitle') },
      { id: '24h', label: t('punctuality.period24h'), title: t('punctuality.period24hTitle') },
      { id: '7d', label: t('punctuality.period7d'), title: t('punctuality.period7dTitle') },
      { id: '30d', label: t('punctuality.period30d'), title: t('punctuality.period30dTitle') },
      { id: 'all', label: t('punctuality.periodAll'), title: t('punctuality.periodAllTitle') },
    ],
    [t]
  );

  const loadPunctuality = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setHasError(false);
      try {
        const json = await fetchRoutePunctualityData(routeId, period, signal);
        if (!signal?.aborted) {
          setData(json);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!signal?.aborted) {
          setHasError(true);
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [routeId, period]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadPunctuality(controller.signal);
    return () => controller.abort();
  }, [loadPunctuality]);

  const xInterval =
    period === '24h' ? 3 : period === '30d' ? 2 : period === '6h' ? 2 : period === 'all' ? 1 : 0;

  const localizedBuckets = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      ...b,
      displayLabel: localizePunctualityLabel(b.label, locale),
    }));
  }, [data, locale]);

  return (
    <div
      data-testid="route-punctuality-view"
      data-period={period}
      data-chart-mode={chartMode}
      className="flex-1 overflow-y-auto transit-scroll"
    >
      {/* Timeframe selector & chart mode bar */}
      <div className="px-4 py-3 border-b border-slate-800/70 space-y-2.5">
        <div
          role="group"
          aria-label={t('punctuality.periodGroupAria')}
          className="grid grid-cols-5 gap-1 p-1 rounded-lg bg-[#090D16] border border-slate-800/80"
        >
          {periodOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.title}
              aria-pressed={period === opt.id}
              onClick={() => setPeriod(opt.id)}
              className={`py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                period === opt.id
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
            {t('punctuality.lineHeader', { line: routeShortName })}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={chartMode === 'early-late'}
              onClick={() => setChartMode('early-late')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                chartMode === 'early-late'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {t('punctuality.modeEarlyLate')}
            </button>
            <button
              type="button"
              aria-pressed={chartMode === 'full-split'}
              onClick={() => setChartMode('full-split')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                chartMode === 'full-split'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {t('punctuality.modeFullSplit')}
            </button>
          </div>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && !data ? (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="h-12 rounded bg-slate-800/40 animate-pulse" />
            <div className="h-12 rounded bg-slate-800/40 animate-pulse" />
            <div className="h-12 rounded bg-slate-800/40 animate-pulse" />
          </div>
          <div className="h-[210px] rounded-lg bg-slate-800/40 animate-pulse" />
        </div>
      ) : hasError ? (
        <div className="p-6 text-center space-y-3">
          <AlertCircle className="w-5 h-5 text-rose-400 mx-auto" aria-hidden="true" />
          <p className="text-xs text-rose-300">{t('error.loadPunctuality')}</p>
          <button
            type="button"
            onClick={() => loadPunctuality()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {t('app.retry')}
          </button>
        </div>
      ) : data ? (
        <div
          className={`transition-opacity duration-150 ${
            isLoading ? 'opacity-70' : 'opacity-100'
          }`}
        >
          {/* Flat 3-column KPI Summary Strip (no nested cards) */}
          <div className="grid grid-cols-3 divide-x divide-slate-800/70 border-b border-slate-800/70">
            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-400">{t('punctuality.onTime')}</div>
              <div className="font-mono-tabular text-base font-semibold text-emerald-400 mt-0.5">
                {data.summary.onTimePct.toFixed(1)}%
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-400">{t('punctuality.late')}</div>
              <div className="font-mono-tabular text-base font-semibold text-amber-400 mt-0.5">
                {data.summary.latePct.toFixed(1)}%
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-400">{t('punctuality.early')}</div>
              <div className="font-mono-tabular text-base font-semibold text-sky-400 mt-0.5">
                {data.summary.earlyPct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Chart Canvas */}
          <div className="px-3 pt-4 pb-2 border-b border-slate-800/70">
            <div className="w-full h-[215px]" data-testid="recharts-punctuality-canvas">
              <ResponsiveContainer width="100%" height={215}>
                {chartMode === 'early-late' ? (
                  <AreaChart
                    data={localizedBuckets}
                    margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="t2cLateFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="t2cEarlyFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1E293B"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="displayLabel"
                      interval={xInterval}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={{ stroke: '#1E293B' }}
                      tickLine={false}
                    />
                    <YAxis
                      unit="%"
                      domain={[0, 'auto']}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<PunctualityTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="latePct"
                      name={t('punctuality.latePct')}
                      stroke="#F59E0B"
                      strokeWidth={2}
                      fill="url(#t2cLateFill)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="earlyPct"
                      name={t('punctuality.earlyPct')}
                      stroke="#38BDF8"
                      strokeWidth={2}
                      fill="url(#t2cEarlyFill)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                ) : (
                  <BarChart
                    data={localizedBuckets}
                    margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1E293B"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="displayLabel"
                      interval={xInterval}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={{ stroke: '#1E293B' }}
                      tickLine={false}
                    />
                    <YAxis
                      unit="%"
                      domain={[0, 100]}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<PunctualityTooltip />} />
                    <Bar
                      dataKey="onTimePct"
                      stackId="punctuality"
                      name={t('punctuality.onTimePct')}
                      fill="#10B981"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="earlyPct"
                      stackId="punctuality"
                      name={t('punctuality.earlyPct')}
                      fill="#38BDF8"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="latePct"
                      stackId="punctuality"
                      name={t('punctuality.latePct')}
                      fill="#F59E0B"
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Clean inline legend (unboxed text + color swatches) */}
            <div className="flex items-center justify-center gap-4 pt-2 pb-1 text-[11px] text-slate-400">
              {chartMode === 'full-split' && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2 rounded-xs bg-emerald-500" aria-hidden="true" />
                  {t('punctuality.onTime')}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2 rounded-xs bg-amber-500" aria-hidden="true" />
                {t('punctuality.late')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2 rounded-xs bg-sky-400" aria-hidden="true" />
                {t('punctuality.early')}
              </span>
            </div>
          </div>

          {/* Operational Breakdown Rows */}
          <div className="divide-y divide-slate-800/60 text-xs">
            <div className="px-4 py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-400">{t('punctuality.rowAvgOffset')}</span>
              <span className="font-mono-tabular font-medium text-slate-100">
                {formatAvgDelaySeconds(data.summary.avgDelaySec, locale)}
              </span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-400">{t('punctuality.rowPeakLate')}</span>
              <span className="font-mono-tabular font-medium text-amber-400">
                {localizePunctualityLabel(data.summary.peakLateLabel, locale)} (
                {data.summary.peakLatePct.toFixed(1)}%)
              </span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-400">{t('punctuality.rowBestOnTime')}</span>
              <span className="font-mono-tabular font-medium text-emerald-400">
                {localizePunctualityLabel(data.summary.bestOnTimeLabel, locale)} (
                {data.summary.bestOnTimePct.toFixed(1)}%)
              </span>
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-400">{t('punctuality.rowLiveObs')}</span>
              <span className="font-mono-tabular text-slate-200">
                {data.summary.liveSampleCount > 0
                  ? data.summary.liveSampleCount === 1
                    ? t('punctuality.tripsLatestBucketOne')
                    : t('punctuality.tripsLatestBucket', { count: data.summary.liveSampleCount })
                  : t('punctuality.syncingFeed')}
              </span>
            </div>
          </div>

          <p className="px-4 py-3 text-[11px] leading-relaxed text-slate-500">
            {t('punctuality.footnote', { threshold: data.thresholdSeconds })}
          </p>
        </div>
      ) : null}
    </div>
  );
});

RoutePunctualityChart.displayName = 'RoutePunctualityChart';

export default RoutePunctualityChart;
