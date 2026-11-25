import { useCallback, useEffect, useState } from 'react';
import type { StationArrival, TransitStation } from '../types/transit';
import { translate, type AppLocale } from '../utils/i18n';
import { formatShortStationLabel } from '../utils/transitMath';

export interface DepartureReminder {
  key: string;
  tripId: string;
  stopId: string;
  stationId: string;
  stationName: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  headsign: string;
  arrivalTime: number; // Unix epoch seconds
  leadMinutes: number;
  triggered: boolean;
}

export function buildReminderKey(tripId: string, stopId: string): string {
  return `${tripId}::${stopId}`;
}

export interface UseDepartureRemindersResult {
  reminders: DepartureReminder[];
  activeTriggeredReminder: DepartureReminder | null;
  isReminderArmed: (tripId: string, stopId: string) => boolean;
  toggleReminder: (arrival: StationArrival, station: TransitStation, leadMinutes?: number) => void;
  dismissTriggeredReminder: () => void;
  removeReminder: (key: string) => void;
}

export function useDepartureReminders(
  nowEpochSec: number,
  locale: AppLocale
): UseDepartureRemindersResult {
  const [reminders, setReminders] = useState<DepartureReminder[]>([]);
  const [activeTriggeredReminder, setActiveTriggeredReminder] =
    useState<DepartureReminder | null>(null);

  const isReminderArmed = useCallback(
    (tripId: string, stopId: string): boolean => {
      const key = buildReminderKey(tripId, stopId);
      return reminders.some((r) => r.key === key);
    },
    [reminders]
  );

  const toggleReminder = useCallback(
    (arrival: StationArrival, station: TransitStation, leadMinutes = 5) => {
      const key = buildReminderKey(arrival.tripId, arrival.stopId);
      setReminders((prev) => {
        if (prev.some((r) => r.key === key)) {
          return prev.filter((r) => r.key !== key);
        }

        // Request Web Notification permission non-intrusively on explicit user tap
        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          window.Notification.permission === 'default'
        ) {
          window.Notification.requestPermission().catch(() => {});
        }

        const next: DepartureReminder = {
          key,
          tripId: arrival.tripId,
          stopId: arrival.stopId,
          stationId: station.id,
          stationName: formatShortStationLabel(station.name),
          routeShortName: arrival.routeShortName,
          routeColor: arrival.routeColor,
          routeTextColor: arrival.routeTextColor,
          headsign: formatShortStationLabel(arrival.headsign),
          arrivalTime: arrival.arrivalTime,
          leadMinutes,
          triggered: false,
        };
        return [...prev, next];
      });
    },
    []
  );

  const removeReminder = useCallback((key: string) => {
    setReminders((prev) => prev.filter((r) => r.key !== key));
    setActiveTriggeredReminder((curr) => (curr && curr.key === key ? null : curr));
  }, []);

  const dismissTriggeredReminder = useCallback(() => {
    setActiveTriggeredReminder(null);
  }, []);

  // Watch live clock and fire reminder when arrival enters the leadMinutes window
  useEffect(() => {
    if (reminders.length === 0) return;

    const toTrigger: DepartureReminder[] = [];
    let hasExpired = false;

    for (const rem of reminders) {
      const remainingSec = rem.arrivalTime - nowEpochSec;
      if (remainingSec < -90) {
        hasExpired = true;
        continue;
      }
      if (!rem.triggered && remainingSec <= rem.leadMinutes * 60) {
        toTrigger.push(rem);
      }
    }

    if (toTrigger.length === 0 && !hasExpired) return;

    if (toTrigger.length > 0) {
      const primary = toTrigger[0];
      setActiveTriggeredReminder({ ...primary, triggered: true });

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([160, 80, 160]);
        } catch {
          // Ignore restricted vibration environments
        }
      }

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        const minsLeft = Math.max(1, Math.round((primary.arrivalTime - nowEpochSec) / 60));
        try {
          new window.Notification(
            translate(locale, 'reminder.notifTitle', {
              line: primary.routeShortName,
              station: primary.stationName,
            }),
            {
              body: translate(locale, 'reminder.notifBody', {
                headsign: primary.headsign,
                mins: minsLeft,
              }),
              icon: './pwa-192x192.png',
              tag: primary.key,
            }
          );
        } catch {
          // Ignore WebView Notification constructor limits
        }
      }
    }

    const triggerKeys = new Set(toTrigger.map((r) => r.key));
    setReminders((prev) =>
      prev
        .filter((r) => r.arrivalTime - nowEpochSec >= -90)
        .map((r) => (triggerKeys.has(r.key) ? { ...r, triggered: true } : r))
    );
  }, [reminders, nowEpochSec, locale]);

  return {
    reminders,
    activeTriggeredReminder,
    isReminderArmed,
    toggleReminder,
    dismissTriggeredReminder,
    removeReminder,
  };
}
