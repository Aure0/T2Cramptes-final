import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import type { FeedHealthAssessment } from '../utils/feedHealth';
import { formatParisClock } from '../utils/transitMath';

interface NetworkStatusIndicatorProps {
  health: FeedHealthAssessment;
  feedTimestampSec: number | null;
  isRefreshing: boolean;
  onRetry: () => void;
}

export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = React.memo(({
  health,
  feedTimestampSec,
  isRefreshing,
  onRetry,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const isStale = health.state === 'stale';
  const isUnreachable = health.state === 'unreachable';
  const isConnecting = health.state === 'connecting';

  const triggerClass = isUnreachable
    ? 'bg-rose-500/12 hover:bg-rose-500/20 text-rose-200 border-rose-500/45 px-2'
    : isStale
      ? 'bg-amber-500/12 hover:bg-amber-500/20 text-amber-200 border-amber-500/45 px-2'
      : 'bg-transparent hover:bg-slate-800/70 text-slate-400 hover:text-slate-200 border-transparent px-1.5';

  const accessibleLabel = health.isWarning
    ? t('status.warningAria', { headline: health.headline, detail: health.detail })
    : t('status.okAria', { headline: health.headline, age: health.formattedAge });

  return (
    <div ref={rootRef} className="relative flex items-center shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="network-status-indicator"
        data-feed-state={health.state}
        data-feed-warning={health.isWarning ? 'true' : 'false'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={accessibleLabel}
        title={`${health.headline} (${health.formattedAge})`}
        className={`inline-flex items-center justify-center gap-1.5 h-7 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${triggerClass}`}
      >
        {isUnreachable ? (
          <WifiOff
            className="w-3.5 h-3.5 text-rose-400 shrink-0"
            aria-hidden="true"
            data-testid="network-status-unreachable-icon"
          />
        ) : isStale ? (
          <AlertTriangle
            className="w-3.5 h-3.5 text-amber-400 shrink-0"
            aria-hidden="true"
            data-testid="network-status-stale-icon"
          />
        ) : (
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isConnecting ? 'bg-slate-400 animate-pulse' : 'bg-emerald-400/90'
            }`}
            aria-hidden="true"
            data-testid="network-status-live-dot"
          />
        )}

        {health.isWarning && (
          <span className="hidden sm:inline leading-none">{health.shortLabel}</span>
        )}
      </button>

      {/* Polite screen-reader live announcement when transitioning into a warning */}
      <span className="sr-only" role="status" aria-live="polite">
        {health.isWarning ? `${health.headline}. ${health.detail}` : ''}
      </span>

      {open && (
        <div
          role="dialog"
          aria-label={t('status.dialogAria')}
          data-testid="network-status-popover"
          className="fixed left-3 right-3 top-[60px] sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-72 rounded-xl bg-[#111827] border border-slate-700/90 shadow-2xl p-3.5 z-50 text-xs text-slate-200 space-y-3"
        >
          <div className="flex items-start gap-2.5">
            <div
              className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                isUnreachable
                  ? 'bg-rose-500/15 text-rose-400'
                  : isStale
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {isUnreachable ? (
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : isStale ? (
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display font-semibold text-white text-[13px] leading-snug">
                {health.headline}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                {health.detail}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-[#090D16] border border-slate-800/80 px-2.5 py-2 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">{t('status.lastUpdate')}</span>
              <span
                className={`font-mono-tabular font-medium ${
                  isUnreachable
                    ? 'text-rose-300'
                    : isStale
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }`}
              >
                {health.formattedAge}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">{t('status.gtfsFeedTime')}</span>
              <span className="font-mono-tabular text-slate-200">
                {feedTimestampSec ? formatParisClock(feedTimestampSec, true) : '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                onRetry();
              }}
              disabled={isRefreshing}
              data-testid="network-status-retry-btn"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-60 ${
                health.isWarning
                  ? 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 border-sky-500/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/80'
              }`}
            >
              <RefreshCw
                className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{health.isWarning ? t('status.retryNow') : t('status.checkNow')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

NetworkStatusIndicator.displayName = 'NetworkStatusIndicator';
