import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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

interface LocalizedBucket extends PunctualityBucket {
  displayLabel: string;
}

const CHART_HEIGHT = 212;
const PAD_TOP = 10;
const PAD_RIGHT = 10;
const PAD_BOTTOM = 26;
const PAD_LEFT = 32;

function buildSmoothLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export const RoutePunctualityChart: React.FC<RoutePunctualityChartProps> = React.memo(({
  routeId,
  routeShortName,
}) => {
  const { locale, t } = useI18n();
  const uid = useId().replace(/:/g, '');
  const [period, setPeriod] = useState<PunctualityPeriod>('24h');
  const [chartMode, setChartMode] = useState<ChartMode>('early-late');
  const [data, setData] = useState<RoutePunctualityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(330);
  const chartBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 120) setChartWidth(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

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
          setHoverIdx(null);
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

  const localizedBuckets = useMemo<LocalizedBucket[]>(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      ...b,
      displayLabel: localizePunctualityLabel(b.label, locale),
    }));
  }, [data, locale]);

  const innerW = Math.max(80, chartWidth - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const yMax = useMemo(() => {
    if (chartMode === 'full-split') return 100;
    let peak = 20;
    for (const b of localizedBuckets) {
      if (b.latePct > peak) peak = b.latePct;
      if (b.earlyPct > peak) peak = b.earlyPct;
    }
    return Math.min(100, Math.max(25, Math.ceil(peak / 10) * 10));
  }, [chartMode, localizedBuckets]);

  const yTicks = useMemo(() => {
    const steps = 4;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push(Math.round((yMax * i) / steps));
    }
    return out;
  }, [yMax]);

  const xStepEvery = useMemo(() => {
    const n = localizedBuckets.length;
    if (n <= 7) return 1;
    if (n <= 12) return 2;
    if (n <= 20) return 3;
    return 4;
  }, [localizedBuckets.length]);

  const xAt = useCallback(
    (idx: number) => {
      const n = localizedBuckets.length;
      if (n <= 1) return PAD_LEFT + innerW / 2;
      if (chartMode === 'full-split') {
        const slot = innerW / n;
        return PAD_LEFT + slot * (idx + 0.5);
      }
      return PAD_LEFT + (idx / (n - 1)) * innerW;
    },
    [localizedBuckets.length, innerW, chartMode]
  );

  const yAt = useCallback(
    (pct: number) => {
      const clamped = Math.max(0, Math.min(yMax, pct));
      return PAD_TOP + innerH * (1 - clamped / yMax);
    },
    [yMax, innerH]
  );

  const areaGeometry = useMemo(() => {
    if (chartMode !== 'early-late' || localizedBuckets.length === 0) return null;
    const latePts = localizedBuckets.map((b, i) => ({ x: xAt(i), y: yAt(b.latePct) }));
    const earlyPts = localizedBuckets.map((b, i) => ({ x: xAt(i), y: yAt(b.earlyPct) }));
    const baselineY = PAD_TOP + innerH;

    const lateLine = buildSmoothLinePath(latePts);
    const earlyLine = buildSmoothLinePath(earlyPts);
    const firstX = latePts[0].x.toFixed(1);
    const lastX = latePts[latePts.length - 1].x.toFixed(1);

    return {
      latePts,
      earlyPts,
      lateLine,
      earlyLine,
      lateArea: `${lateLine} L ${lastX} ${baselineY.toFixed(1)} L ${firstX} ${baselineY.toFixed(1)} Z`,
      earlyArea: `${earlyLine} L ${lastX} ${baselineY.toFixed(1)} L ${firstX} ${baselineY.toFixed(1)} Z`,
    };
  }, [chartMode, localizedBuckets, xAt, yAt, innerH]);

  const handlePointerMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
      if (localizedBuckets.length === 0) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
      if (typeof clientX !== 'number') return;
      const relX = clientX - rect.left - PAD_LEFT;
      const frac = Math.max(0, Math.min(1, relX / innerW));
      const idx =
        chartMode === 'full-split'
          ? Math.min(localizedBuckets.length - 1, Math.floor(frac * localizedBuckets.length))
          : Math.round(frac * (localizedBuckets.length - 1));
      setHoverIdx(idx);
    },
    [localizedBuckets.length, innerW, chartMode]
  );

  const hoveredBucket =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < localizedBuckets.length
      ? localizedBuckets[hoverIdx]
      : null;

  const hoveredX = hoverIdx !== null ? xAt(hoverIdx) : 0;

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
          {/* Flat 3-column KPI Summary Strip */}
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

          {/* Zero-dependency Native Responsive SVG Chart */}
          <div className="px-3 pt-4 pb-2 border-b border-slate-800/70">
            <div
              ref={chartBoxRef}
              className="relative w-full h-[212px] select-none"
              data-testid="svg-punctuality-canvas"
            >
              <svg
                width={chartWidth}
                height={CHART_HEIGHT}
                viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t('punctuality.lineHeader', { line: routeShortName })}
                onMouseMove={handlePointerMove}
                onTouchMove={handlePointerMove}
                onMouseLeave={() => setHoverIdx(null)}
                className="w-full h-full overflow-visible"
              >
                <defs>
                  <linearGradient id={`lateFill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.36} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id={`earlyFill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                {/* Horizontal Gridlines & Y-Axis Labels */}
                {yTicks.map((tick) => {
                  const y = yAt(tick);
                  return (
                    <g key={tick}>
                      <line
                        x1={PAD_LEFT}
                        x2={chartWidth - PAD_RIGHT}
                        y1={y}
                        y2={y}
                        stroke="#1E293B"
                        strokeDasharray={tick === 0 ? undefined : '3 3'}
                        strokeWidth={1}
                      />
                      <text
                        x={PAD_LEFT - 6}
                        y={y + 3}
                        textAnchor="end"
                        fill="#94A3B8"
                        fontSize={10}
                        className="font-mono-tabular"
                      >
                        {tick}%
                      </text>
                    </g>
                  );
                })}

                {/* Early / Late Smooth Area Series */}
                {chartMode === 'early-late' && areaGeometry && (
                  <g>
                    <path d={areaGeometry.lateArea} fill={`url(#lateFill-${uid})`} />
                    <path d={areaGeometry.earlyArea} fill={`url(#earlyFill-${uid})`} />
                    <path
                      d={areaGeometry.lateLine}
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={areaGeometry.earlyLine}
                      fill="none"
                      stroke="#38BDF8"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {hoverIdx !== null && areaGeometry.latePts[hoverIdx] && (
                      <>
                        <line
                          x1={hoveredX}
                          x2={hoveredX}
                          y1={PAD_TOP}
                          y2={PAD_TOP + innerH}
                          stroke="#475569"
                          strokeWidth={1}
                          strokeDasharray="2 2"
                        />
                        <circle
                          cx={areaGeometry.latePts[hoverIdx].x}
                          cy={areaGeometry.latePts[hoverIdx].y}
                          r={3.5}
                          fill="#F59E0B"
                          stroke="#090D16"
                          strokeWidth={1.5}
                        />
                        <circle
                          cx={areaGeometry.earlyPts[hoverIdx].x}
                          cy={areaGeometry.earlyPts[hoverIdx].y}
                          r={3.5}
                          fill="#38BDF8"
                          stroke="#090D16"
                          strokeWidth={1.5}
                        />
                      </>
                    )}
                  </g>
                )}

                {/* Full Split Stacked Bars */}
                {chartMode === 'full-split' && localizedBuckets.length > 0 && (
                  <g>
                    {localizedBuckets.map((b, i) => {
                      const slot = innerW / localizedBuckets.length;
                      const barW = Math.max(4, Math.min(24, slot * 0.68));
                      const x = PAD_LEFT + i * slot + (slot - barW) / 2;
                      const isHovered = hoverIdx === i;

                      const onTimeH = (Math.max(0, b.onTimePct) / 100) * innerH;
                      const earlyH = (Math.max(0, b.earlyPct) / 100) * innerH;
                      const lateH = (Math.max(0, b.latePct) / 100) * innerH;

                      const yOnTime = PAD_TOP + innerH - onTimeH;
                      const yEarly = yOnTime - earlyH;
                      const yLate = Math.max(PAD_TOP, yEarly - lateH);

                      return (
                        <g key={`${b.timestamp}-${i}`} opacity={hoverIdx === null || isHovered ? 1 : 0.62}>
                          {isHovered && (
                            <rect
                              x={x - 2}
                              y={PAD_TOP}
                              width={barW + 4}
                              height={innerH}
                              rx={2}
                              fill="rgba(148, 163, 184, 0.1)"
                            />
                          )}
                          <rect x={x} y={yOnTime} width={barW} height={onTimeH} fill="#10B981" />
                          <rect x={x} y={yEarly} width={barW} height={earlyH} fill="#38BDF8" />
                          <rect
                            x={x}
                            y={yLate}
                            width={barW}
                            height={Math.max(0, yEarly - yLate)}
                            rx={1.5}
                            fill="#F59E0B"
                          />
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* X-Axis Labels */}
                {localizedBuckets.map((b, i) => {
                  const isLast = i === localizedBuckets.length - 1;
                  if (i % xStepEvery !== 0 && !isLast) return null;
                  if (isLast && i % xStepEvery !== 0 && i - Math.floor(i / xStepEvery) * xStepEvery < 1) {
                    return null;
                  }
                  return (
                    <text
                      key={`x-${i}`}
                      x={xAt(i)}
                      y={CHART_HEIGHT - 6}
                      textAnchor={i === 0 ? 'start' : isLast ? 'end' : 'middle'}
                      fill="#94A3B8"
                      fontSize={10}
                    >
                      {b.displayLabel}
                    </text>
                  );
                })}
              </svg>

              {/* Interactive Floating Tooltip */}
              {hoveredBucket && (
                <div
                  style={{
                    left: hoveredX > chartWidth * 0.56 ? undefined : Math.min(chartWidth - 178, Math.max(8, hoveredX + 10)),
                    right: hoveredX > chartWidth * 0.56 ? Math.max(8, chartWidth - hoveredX + 10) : undefined,
                  }}
                  className="pointer-events-none absolute top-2 z-20 rounded-lg bg-[#090D16]/95 border border-slate-700/90 px-3 py-2 shadow-xl text-xs space-y-1.5 min-w-[168px]"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1">
                    <span className="font-medium text-white">{hoveredBucket.displayLabel}</span>
                    <span className="text-[10px] text-slate-400">
                      {hoveredBucket.source === 'live'
                        ? t('punctuality.sourceLive')
                        : t('punctuality.sourceBaseline')}
                    </span>
                  </div>
                  <div className="space-y-1 font-mono-tabular">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-emerald-400">{t('punctuality.onTime')}</span>
                      <span className="text-slate-100 font-medium">
                        {hoveredBucket.onTimePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-amber-400">{t('punctuality.late')}</span>
                      <span className="text-slate-100 font-medium">
                        {hoveredBucket.latePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sky-400">{t('punctuality.early')}</span>
                      <span className="text-slate-100 font-medium">
                        {hoveredBucket.earlyPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono-tabular">
                    <span>
                      {t('punctuality.avgLabel', {
                        value: formatAvgDelaySeconds(hoveredBucket.avgDelaySec, locale),
                      })}
                    </span>
                    <span>
                      n={hoveredBucket.sampleCount.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Clean inline legend */}
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
