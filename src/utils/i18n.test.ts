import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBestLocale,
  localizeAlertLinkLabel,
  localizePunctualityLabel,
  localizeRevisionSummary,
  localizeServiceAlertText,
  normalizeLocale,
  translate,
  TRANSLATIONS,
  type TranslationKey,
} from './i18n';
import { evaluateFeedHealth, formatRelativeAge } from './feedHealth';
import { formatCauseLabel, formatEffectLabel, formatParisDateTime } from './alertsMath';
import { formatAvgDelaySeconds } from './punctualityMath';
import { formatDelayStatus, formatEtaCountdown } from './transitMath';
import {
  buildUrlSearchString,
  parsePreferencesJson,
  parseUrlSearchParams,
} from './userPreferences';

test('normalizeLocale handles BCP-47 tags and rejects unsupported strings', () => {
  assert.equal(normalizeLocale('fr'), 'fr');
  assert.equal(normalizeLocale('fr-FR'), 'fr');
  assert.equal(normalizeLocale('FR_ca'), 'fr');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('EN'), 'en');
  assert.equal(normalizeLocale('de-DE'), null);
  assert.equal(normalizeLocale(''), null);
  assert.equal(normalizeLocale(null), null);
});

test('detectBestLocale respects URL > saved preference > browser languages > fallback', () => {
  // URL param wins over saved & browser
  assert.equal(
    detectBestLocale({
      urlLocale: 'en',
      savedLocale: 'fr',
      browserLanguages: ['fr-FR'],
    }),
    'en'
  );

  // Saved user preference wins over browser
  assert.equal(
    detectBestLocale({
      urlLocale: null,
      savedLocale: 'fr',
      browserLanguages: ['en-US'],
    }),
    'fr'
  );

  // Auto-detects French from browser preference order
  assert.equal(
    detectBestLocale({
      browserLanguages: ['de-DE', 'fr-FR', 'en-US'],
    }),
    'fr'
  );

  // Auto-detects English when listed ahead of French
  assert.equal(
    detectBestLocale({
      browserLanguages: ['en-GB', 'fr-FR'],
    }),
    'en'
  );

  // Falls back cleanly to English for unsupported browser locales
  assert.equal(
    detectBestLocale({
      browserLanguages: ['es-ES', 'ja-JP'],
    }),
    'en'
  );
});

test('English and French catalogs have complete key & placeholder parity', () => {
  const enKeys = Object.keys(TRANSLATIONS.en) as TranslationKey[];
  const frKeys = Object.keys(TRANSLATIONS.fr) as TranslationKey[];
  assert.deepEqual(frKeys.sort(), [...enKeys].sort());

  const extractPlaceholders = (s: string) =>
    Array.from(s.matchAll(/\{([a-zA-Z0-9_]+)\}/g))
      .map((m) => m[1])
      .sort();

  for (const key of enKeys) {
    const enVal = TRANSLATIONS.en[key];
    const frVal = TRANSLATIONS.fr[key];
    assert.ok(enVal.trim().length > 0, `Empty EN string for ${key}`);
    assert.ok(frVal.trim().length > 0, `Empty FR string for ${key}`);
    assert.deepEqual(
      extractPlaceholders(frVal),
      extractPlaceholders(enVal),
      `Mismatched placeholders for ${key}`
    );
  }
});

test('translate interpolates parameters cleanly in both EN and FR', () => {
  assert.equal(translate('en', 'sidebar.tabLines', { count: 3 }), 'Lines (3)');
  assert.equal(translate('fr', 'sidebar.tabLines', { count: 3 }), 'Lignes (3)');
  assert.equal(
    translate('fr', 'search.noMatches', { query: 'Jaude' }),
    'Aucun arrêt ni ligne T2C ne correspond à « Jaude ».'
  );
});

test('French formatters produce idiomatic transit, health, alert, and punctuality strings', () => {
  assert.equal(formatEtaCountdown(1030, 1000, 'fr'), 'Proche');
  assert.equal(formatEtaCountdown(1000 + 75 * 60, 1000, 'fr'), '1 h 15');
  assert.equal(formatDelayStatus(0, 'fr').label, 'À l’heure');
  assert.equal(formatDelayStatus(180, 'fr').label, '+3 min retard');
  assert.equal(formatDelayStatus(-120, 'fr').label, '2 min avance');

  assert.equal(formatRelativeAge(12, 'fr'), 'il y a 12 s');
  assert.equal(formatRelativeAge(120, 'fr'), 'il y a 2 min');

  const health = evaluateFeedHealth(
    {
      isOnline: true,
      hasData: true,
      serverFeedStatus: 'live',
      feedTimestampSec: 1_700_000_000,
      lastSuccessAtMs: 1_700_000_005_000,
      nowMs: 1_700_000_010_000,
      nowEpochSec: 1_700_000_010,
      consecutiveFailures: 0,
      lastError: null,
    },
    'fr'
  );
  assert.equal(health.compactLabel, 'GTFS-RT En direct');
  assert.equal(health.headline, 'Flux T2C en direct connecté');

  assert.equal(formatCauseLabel('CONSTRUCTION', 'fr'), 'Travaux');
  assert.equal(formatEffectLabel('DETOUR', 'fr'), 'Itinéraire dévié');
  assert.equal(formatParisDateTime(null, 'fr'), 'Jusqu’à nouvel ordre');
  assert.equal(formatAvgDelaySeconds(5, 'fr'), 'À l’heure');
  assert.equal(formatAvgDelaySeconds(90, 'fr'), '+1,5 min');

  assert.equal(translate('en', 'app.brand'), 'T2Cramptés');
  assert.equal(translate('fr', 'app.brand'), 'T2Cramptés');
  assert.equal(
    localizeRevisionSummary('Cleared from live ServiceAlerts feed', 'fr'),
    'Levée du flux ServiceAlerts en direct'
  );
  assert.equal(
    localizeRevisionSummary('Detected via live GTFS-RT TripUpdates (4/10 vehicles delayed)', 'fr'),
    'Détectée via GTFS-RT TripUpdates en direct (4/10 véhicules en retard)'
  );
  assert.equal(localizeAlertLinkLabel('Official T2C Notice', 'fr'), 'Notice officielle T2C');
  assert.equal(localizeAlertLinkLabel('Official T2C Notice', 'en'), 'Official T2C Notice');

  const localizedDelay = localizeServiceAlertText(
    {
      source: 'gtfs-rt-delay',
      sourceLabel: 'GTFS-RT TripUpdates Telemetry',
      headerText: 'Line A: Significant delays detected (+5 min avg)',
      paragraphs: [
        '4 of 12 active vehicles on Line A are currently delayed by more than 3 minutes in real-time GTFS-RT telemetry.',
        'Average schedule offset across active units is +5 min, with a peak observed delay of +9 min.',
      ],
    },
    'fr'
  );
  assert.equal(localizedDelay.sourceLabel, 'Télémétrie GTFS-RT TripUpdates');
  assert.equal(
    localizedDelay.headerText,
    'Ligne A : retards importants détectés (+5 min moy.)'
  );
  assert.match(localizedDelay.paragraphs[0], /^4 véhicules actifs sur 12 de la ligne A/);
  assert.match(localizedDelay.paragraphs[1], /\+5 min.*\+9 min/);

  assert.equal(localizePunctualityLabel('Now', 'fr'), 'Actuel');
  assert.equal(localizePunctualityLabel('Mon 12', 'fr'), 'Lun 12');
  assert.equal(localizePunctualityLabel('14 Jan', 'fr'), '14 Janv.');
  assert.equal(localizePunctualityLabel('Mar 26', 'fr'), 'Mars 26');
  assert.equal(localizePunctualityLabel('Sep 26', 'fr'), 'Sept. 26');
});

test('userPreferences persists locale and URL parser/builder handle ?lang=fr', () => {
  const parsed = parsePreferencesJson(JSON.stringify({ locale: 'fr', showStops: false }));
  assert.equal(parsed.locale, 'fr');
  assert.equal(parsed.showStops, false);

  const urlState = parseUrlSearchParams('?station=JAUD&lang=fr');
  assert.equal(urlState.stationId, 'JAUD');
  assert.equal(urlState.lang, 'fr');

  const qs = buildUrlSearchString({
    enabledRouteIds: new Set(['A', 'B', 'C']),
    defaultRouteIds: new Set(['A', 'B', 'C']),
    routes: [],
    selectedStationId: 'JAUD',
    basemap: 'dark',
    showDensity: false,
    lang: 'fr',
  });
  assert.equal(qs, '?station=JAUD&lang=fr');
});
