import assert from 'node:assert/strict';
import test from 'node:test';
import type { TransitRoute } from '../types/transit';
import {
  buildUrlSearchString,
  DEFAULT_USER_PREFERENCES,
  parsePreferencesJson,
  parseUrlSearchParams,
  resolveRouteTokensToIds,
  toggleFavoriteId,
} from './userPreferences';

const MOCK_ROUTES: TransitRoute[] = [
  {
    id: 'A',
    shortName: 'A',
    longName: 'Tramway A',
    description: 'Les Vergnes - La Pardieu Gare',
    routeType: 0,
    tier: 'core',
    color: '#D71920',
    textColor: '#FFFFFF',
    sortOrder: 1,
    headsigns: ['Les Vergnes', 'La Pardieu Gare'],
    shapes: [],
    stationIds: [],
  },
  {
    id: 'B',
    shortName: 'B',
    longName: 'BHNS B',
    description: 'Royat - Aulnat',
    routeType: 3,
    tier: 'core',
    color: '#0072BC',
    textColor: '#FFFFFF',
    sortOrder: 2,
    headsigns: ['Royat', 'Aulnat'],
    shapes: [],
    stationIds: [],
  },
  {
    id: 'C',
    shortName: 'C',
    longName: 'BHNS C',
    description: 'Cournon - Durtol',
    routeType: 3,
    tier: 'core',
    color: '#009E49',
    textColor: '#FFFFFF',
    sortOrder: 3,
    headsigns: ['Cournon', 'Durtol'],
    shapes: [],
    stationIds: [],
  },
  {
    id: 'ROUTE_E1',
    shortName: 'E1',
    longName: 'Bus E1',
    description: 'Gerzat - Aubière',
    routeType: 3,
    tier: 'essential',
    color: '#F59E0B',
    textColor: '#000000',
    sortOrder: 10,
    headsigns: ['Gerzat', 'Aubière'],
    shapes: [],
    stationIds: [],
  },
];

test('parsePreferencesJson validates, deduplicates, and falls back safely on invalid JSON', () => {
  assert.deepEqual(parsePreferencesJson(null), DEFAULT_USER_PREFERENCES);
  assert.deepEqual(parsePreferencesJson('{invalid'), DEFAULT_USER_PREFERENCES);

  const parsed = parsePreferencesJson(
    JSON.stringify({
      favoriteStationIds: ['JAUDE', 'GARE', 'JAUDE', ''],
      enabledRouteIds: ['A', 'ROUTE_E1', 'A'],
      basemap: 'liberty',
      showStops: false,
      showStationLabels: true,
      showDensity: true,
    })
  );
  assert.deepEqual(parsed.favoriteStationIds, ['JAUDE', 'GARE']);
  assert.deepEqual(parsed.enabledRouteIds, ['A', 'ROUTE_E1']);
  assert.equal(parsed.basemap, 'liberty');
  assert.equal(parsed.showStops, false);
  assert.equal(parsed.showStationLabels, true);
  assert.equal(parsed.showDensity, true);
});

test('toggleFavoriteId prepends new favorites and removes existing ones', () => {
  const step1 = toggleFavoriteId([], 'JAUDE');
  assert.deepEqual(step1, ['JAUDE']);

  const step2 = toggleFavoriteId(step1, 'GARE');
  assert.deepEqual(step2, ['GARE', 'JAUDE']);

  const step3 = toggleFavoriteId(step2, 'JAUDE');
  assert.deepEqual(step3, ['GARE']);
});

test('parseUrlSearchParams parses lines, station, style, and density cleanly', () => {
  const parsed = parseUrlSearchParams('?lines=A,e1,B&station=JAUDE_1&style=street&density=1');
  assert.deepEqual(parsed.lines, ['A', 'e1', 'B']);
  assert.equal(parsed.stationId, 'JAUDE_1');
  assert.equal(parsed.basemap, 'liberty');
  assert.equal(parsed.showDensity, true);

  const emptyLines = parseUrlSearchParams('?lines=none&style=dark&density=0');
  assert.deepEqual(emptyLines.lines, []);
  assert.equal(emptyLines.basemap, 'dark');
  assert.equal(emptyLines.showDensity, false);
});

test('resolveRouteTokensToIds matches both route IDs and case-insensitive shortNames', () => {
  const ids = resolveRouteTokensToIds(['a', 'E1', 'ROUTE_E1', 'UNKNOWN'], MOCK_ROUTES);
  assert.deepEqual(ids, ['A', 'ROUTE_E1']);
});

test('buildUrlSearchString omits defaults and serializes clean shareable query parameters', () => {
  const defaults = new Set(['A', 'B', 'C']);

  // Pure defaults -> empty query string
  assert.equal(
    buildUrlSearchString({
      enabledRouteIds: new Set(['A', 'B', 'C']),
      defaultRouteIds: defaults,
      routes: MOCK_ROUTES,
      selectedStationId: null,
      basemap: 'dark',
      showDensity: false,
    }),
    ''
  );

  // Custom lines + station + street style + density
  assert.equal(
    buildUrlSearchString({
      enabledRouteIds: new Set(['A', 'ROUTE_E1']),
      defaultRouteIds: defaults,
      routes: MOCK_ROUTES,
      selectedStationId: 'STOP_JAUDE',
      basemap: 'liberty',
      showDensity: true,
    }),
    '?lines=A%2CE1&station=STOP_JAUDE&style=street&density=1'
  );

  // Cleared lines
  assert.equal(
    buildUrlSearchString({
      enabledRouteIds: new Set(),
      defaultRouteIds: defaults,
      routes: MOCK_ROUTES,
      selectedStationId: null,
      basemap: 'dark',
      showDensity: false,
    }),
    '?lines=none'
  );
});
