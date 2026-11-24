import React, { useEffect, useState } from 'react';
import { formatParisClock } from '../utils/transitMath';

interface ClermontClockProps {
  serverClockOffsetSec: number;
  cityLabel: string;
}

/**
 * Isolated 1Hz Clermont-Ferrand local clock so ticking seconds never
 * triggers re-renders across App, TransitMap, or Inspector panels.
 */
export const ClermontClock: React.FC<ClermontClockProps> = React.memo(
  ({ serverClockOffsetSec, cityLabel }) => {
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

    useEffect(() => {
      const id = window.setInterval(() => {
        if (!document.hidden) {
          setNowMs(Date.now());
        }
      }, 1000);
      return () => window.clearInterval(id);
    }, []);

    const clockText = formatParisClock(Math.floor(nowMs / 1000 + serverClockOffsetSec), true);

    return (
      <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 whitespace-nowrap">
        <span className="font-mono-tabular text-slate-200 font-medium">{clockText}</span>
        <span aria-hidden="true">·</span>
        <span>{cityLabel}</span>
      </div>
    );
  }
);

ClermontClock.displayName = 'ClermontClock';
