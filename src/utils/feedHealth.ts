export type FeedHealthState = 'connecting' | 'live' | 'stale' | 'unreachable';
export type FeedHealthSeverity = 'ok' | 'warning' | 'error';

export const STALE_POLL_THRESHOLD_SEC = 45;
export const STALE_FEED_TIMESTAMP_THRESHOLD_SEC = 180;
export const UNREACHABLE_FAILURE_THRESHOLD = 2;

export interface FeedHealthInput {
  isOnline: boolean;
  hasData: boolean;
  serverFeedStatus: 'live' | 'stale' | 'degraded' | null;
  feedTimestampSec: number | null;
  lastSuccessAtMs: number | null;
  nowMs: number;
  nowEpochSec: number;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface FeedHealthAssessment {
  state: FeedHealthState;
  severity: FeedHealthSeverity;
  isWarning: boolean;
  shortLabel: string;
  compactLabel: string;
  headline: string;
  detail: string;
  ageSeconds: number | null;
  formattedAge: string;
}

export function formatRelativeAge(
  ageSeconds: number | null,
  locale: 'en' | 'fr' = 'en'
): string {
  if (ageSeconds === null || !Number.isFinite(ageSeconds)) {
    return locale === 'fr' ? 'inconnu' : 'unknown';
  }
  const clamped = Math.max(0, Math.floor(ageSeconds));
  if (clamped < 5) return locale === 'fr' ? 'à l’instant' : 'just now';
  if (clamped < 60) return locale === 'fr' ? `il y a ${clamped} s` : `${clamped}s ago`;

  const totalMinutes = Math.floor(clamped / 60);
  if (totalMinutes < 60) {
    return locale === 'fr' ? `il y a ${totalMinutes} min` : `${totalMinutes}m ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (locale === 'fr') {
    return remMinutes > 0 ? `il y a ${hours} h ${remMinutes} min` : `il y a ${hours} h`;
  }
  return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`;
}

export function evaluateFeedHealth(
  input: FeedHealthInput,
  locale: 'en' | 'fr' = 'en'
): FeedHealthAssessment {
  const {
    isOnline,
    hasData,
    serverFeedStatus,
    feedTimestampSec,
    lastSuccessAtMs,
    nowMs,
    nowEpochSec,
    consecutiveFailures,
  } = input;

  const isFr = locale === 'fr';

  const pollAgeSec =
    lastSuccessAtMs !== null ? Math.max(0, Math.floor((nowMs - lastSuccessAtMs) / 1000)) : null;
  const feedAgeSec =
    feedTimestampSec !== null && feedTimestampSec > 0
      ? Math.max(0, Math.floor(nowEpochSec - feedTimestampSec))
      : null;

  const effectiveAgeSec =
    pollAgeSec !== null && feedAgeSec !== null
      ? Math.max(pollAgeSec, feedAgeSec)
      : pollAgeSec ?? feedAgeSec;

  const formattedAge = formatRelativeAge(effectiveAgeSec, locale);

  // 1. Browser offline
  if (!isOnline) {
    return {
      state: 'unreachable',
      severity: 'error',
      isWarning: true,
      shortLabel: isFr ? 'Hors ligne' : 'Offline',
      compactLabel: isFr ? 'Hors ligne' : 'Offline',
      headline: isFr ? 'Aucune connexion Internet' : 'No internet connection',
      detail: hasData
        ? isFr
          ? `Dernière mise à jour temps réel : ${formattedAge}. Affichage des dernières positions connues en attendant le retour du réseau.`
          : `Last real-time update was ${formattedAge}. Showing cached vehicle positions until connection returns.`
        : isFr
          ? 'Impossible de joindre le flux temps réel T2C hors connexion.'
          : 'Unable to reach the T2C live transit feed while offline.',
      ageSeconds: effectiveAgeSec,
      formattedAge,
    };
  }

  // 2. Unreachable: repeated client failures, failed initial load, or upstream feed degraded
  if (
    consecutiveFailures >= UNREACHABLE_FAILURE_THRESHOLD ||
    (consecutiveFailures >= 1 && !hasData) ||
    serverFeedStatus === 'degraded'
  ) {
    const attemptNote =
      consecutiveFailures >= 2
        ? isFr
          ? ` (${consecutiveFailures} tentatives échouées)`
          : ` (${consecutiveFailures} failed polls)`
        : '';
    return {
      state: 'unreachable',
      severity: 'error',
      isWarning: true,
      shortLabel: isFr ? 'Indisponible' : 'Unreachable',
      compactLabel: isFr ? 'Flux indisponible' : 'Feed unreachable',
      headline: isFr ? 'Flux temps réel indisponible' : 'Live transit feed unreachable',
      detail: hasData
        ? isFr
          ? `Impossible d’actualiser les données temps réel${attemptNote}. Dernière mise à jour : ${formattedAge} ; les positions peuvent être datées.`
          : `Unable to refresh real-time data${attemptNote}. Last update was ${formattedAge}; vehicle positions may be outdated.`
        : isFr
          ? `Impossible de joindre le flux GTFS-RT T2C pour le moment${attemptNote}. Nouvelle tentative automatique.`
          : `Unable to reach the T2C GTFS-RT live feed right now${attemptNote}. Retrying automatically.`,
      ageSeconds: effectiveAgeSec,
      formattedAge,
    };
  }

  // 3. Initial load still in flight
  if (!hasData) {
    return {
      state: 'connecting',
      severity: 'ok',
      isWarning: false,
      shortLabel: isFr ? 'Synchro' : 'Syncing',
      compactLabel: isFr ? 'Connexion…' : 'Connecting…',
      headline: isFr ? 'Connexion au flux T2C en direct' : 'Connecting to T2C live feed',
      detail: isFr
        ? 'Récupération des positions des véhicules et des prochains passages en temps réel.'
        : 'Fetching current real-time vehicle positions and arrival forecasts.',
      ageSeconds: null,
      formattedAge: isFr ? 'synchro' : 'syncing',
    };
  }

  // 4. Stale: delayed upstream feed, aged client poll, or single transient poll hiccup
  const isPollStale = pollAgeSec !== null && pollAgeSec >= STALE_POLL_THRESHOLD_SEC;
  const isFeedHeaderStale =
    feedAgeSec !== null && feedAgeSec >= STALE_FEED_TIMESTAMP_THRESHOLD_SEC;

  if (
    serverFeedStatus === 'stale' ||
    isPollStale ||
    isFeedHeaderStale ||
    consecutiveFailures === 1
  ) {
    const detail =
      consecutiveFailures === 1
        ? isFr
          ? `La dernière actualisation a échoué. Dernière mise à jour : ${formattedAge} ; nouvelle tentative automatique.`
          : `Latest refresh attempt failed. Last update was ${formattedAge}; retrying automatically.`
        : isFr
          ? `Les données temps réel sont retardées (dernière mise à jour : ${formattedAge}). Les positions sont estimées d’après la télémétrie récente.`
          : `Real-time transit data is delayed (last updated ${formattedAge}). Positions are estimated from recent telemetry.`;

    return {
      state: 'stale',
      severity: 'warning',
      isWarning: true,
      shortLabel: isFr ? 'Obsolète' : 'Stale',
      compactLabel: isFr ? 'Flux obsolète' : 'Feed stale',
      headline: isFr ? 'Flux temps réel obsolète' : 'Live transit feed is stale',
      detail,
      ageSeconds: effectiveAgeSec,
      formattedAge,
    };
  }

  // 5. Healthy live feed
  return {
    state: 'live',
    severity: 'ok',
    isWarning: false,
    shortLabel: isFr ? 'Direct' : 'Live',
    compactLabel: isFr ? 'GTFS-RT En direct' : 'GTFS-RT Live',
    headline: isFr ? 'Flux T2C en direct connecté' : 'T2C live feed connected',
    detail: isFr
      ? `Réception des données GTFS-RT en temps réel (${formattedAge}).`
      : `Receiving real-time GTFS-RT updates (${formattedAge}).`,
    ageSeconds: effectiveAgeSec,
    formattedAge,
  };
}
