import type { TransitRoute } from '../types/transit';
import { normalizeLocale, type AppLocale } from './i18n';

export type BasemapStyle = 'dark' | 'liberty';

export interface UserPreferences {
  favoriteStationIds: string[];
  enabledRouteIds: string[] | null;
  basemap: BasemapStyle;
  showStops: boolean;
  showStationLabels: boolean;
  showDensity: boolean;
  locale?: AppLocale | null;
}

export interface UrlViewState {
  lines: string[] | null;
  stationId: string | null;
  basemap: BasemapStyle | null;
  showDensity: boolean | null;
  lang: AppLocale | null;
}

export const PREFERENCES_STORAGE_KEY = 't2c_clermont_prefs_v1';
export const MAX_FAVORITE_STATIONS = 25;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  favoriteStationIds: [],
  enabledRouteIds: null,
  basemap: 'dark',
  showStops: true,
  showStationLabels: false,
  showDensity: false,
  locale: null,
};

function dedupeStrings(items: unknown[], limit = 100): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

export function parsePreferencesJson(raw: string | null): UserPreferences {
  if (!raw) return { ...DEFAULT_USER_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof UserPreferences, unknown>>;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_USER_PREFERENCES };
    }

    const favoriteStationIds = Array.isArray(parsed.favoriteStationIds)
      ? dedupeStrings(parsed.favoriteStationIds, MAX_FAVORITE_STATIONS)
      : [];

    const enabledRouteIds = Array.isArray(parsed.enabledRouteIds)
      ? dedupeStrings(parsed.enabledRouteIds, 80)
      : null;

    const basemap: BasemapStyle =
      parsed.basemap === 'liberty' || parsed.basemap === 'dark'
        ? parsed.basemap
        : DEFAULT_USER_PREFERENCES.basemap;

    const showStops =
      typeof parsed.showStops === 'boolean'
        ? parsed.showStops
        : DEFAULT_USER_PREFERENCES.showStops;

    const showStationLabels =
      typeof parsed.showStationLabels === 'boolean'
        ? parsed.showStationLabels
        : DEFAULT_USER_PREFERENCES.showStationLabels;

    const showDensity =
      typeof parsed.showDensity === 'boolean'
        ? parsed.showDensity
        : DEFAULT_USER_PREFERENCES.showDensity;

    const locale = normalizeLocale(parsed.locale);

    return {
      favoriteStationIds,
      enabledRouteIds,
      basemap,
      showStops,
      showStationLabels,
      showDensity,
      locale,
    };
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
}

export function loadUserPreferences(): UserPreferences {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_USER_PREFERENCES };
    }
    return parsePreferencesJson(window.localStorage.getItem(PREFERENCES_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
}

export function saveUserPreferences(prefs: UserPreferences): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private-mode errors gracefully
  }
}

export function toggleFavoriteId(current: string[], stationId: string): string[] {
  const trimmed = stationId.trim();
  if (!trimmed) return current;
  if (current.includes(trimmed)) {
    return current.filter((id) => id !== trimmed);
  }
  return [trimmed, ...current].slice(0, MAX_FAVORITE_STATIONS);
}

export function parseUrlSearchParams(search: string): UrlViewState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  let lines: string[] | null = null;
  if (params.has('lines')) {
    const rawLines = (params.get('lines') || '').trim();
    if (rawLines === 'none') {
      lines = [];
    } else if (rawLines.length > 0) {
      lines = dedupeStrings(
        rawLines.split(',').map((t) => t.trim()),
        80
      );
    }
  }

  const rawStation = params.get('station')?.trim() || null;

  const rawStyle = params.get('style')?.trim().toLowerCase();
  let basemap: BasemapStyle | null = null;
  if (rawStyle === 'street' || rawStyle === 'liberty') {
    basemap = 'liberty';
  } else if (rawStyle === 'dark') {
    basemap = 'dark';
  }

  const rawDensity = params.get('density')?.trim().toLowerCase();
  let showDensity: boolean | null = null;
  if (rawDensity === '1' || rawDensity === 'true') {
    showDensity = true;
  } else if (rawDensity === '0' || rawDensity === 'false') {
    showDensity = false;
  }

  const lang = normalizeLocale(params.get('lang'));

  return {
    lines,
    stationId: rawStation,
    basemap,
    showDensity,
    lang,
  };
}

export function resolveRouteTokensToIds(
  tokens: string[],
  routes: TransitRoute[]
): string[] {
  if (tokens.length === 0 || routes.length === 0) return [];
  const byId = new Map<string, string>();
  const byShortLower = new Map<string, string>();
  for (const r of routes) {
    byId.set(r.id, r.id);
    byId.set(r.id.toLowerCase(), r.id);
    byShortLower.set(r.shortName.toLowerCase(), r.id);
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.trim().toLowerCase();
    const match = byId.get(token.trim()) || byId.get(key) || byShortLower.get(key);
    if (match && !seen.has(match)) {
      seen.add(match);
      resolved.push(match);
    }
  }
  return resolved;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export interface BuildUrlSearchInput {
  enabledRouteIds: Set<string>;
  defaultRouteIds: Set<string>;
  routes: TransitRoute[];
  selectedStationId: string | null;
  basemap: BasemapStyle;
  showDensity: boolean;
  lang?: AppLocale | null;
}

export function buildUrlSearchString(input: BuildUrlSearchInput): string {
  const params = new URLSearchParams();

  // Only serialize ?lines= when diverging from default A·B·C selection
  if (!setsEqual(input.enabledRouteIds, input.defaultRouteIds)) {
    if (input.enabledRouteIds.size === 0) {
      params.set('lines', 'none');
    } else {
      const routeById = new Map<string, TransitRoute>();
      for (const r of input.routes) routeById.set(r.id, r);
      const tokens = Array.from(input.enabledRouteIds)
        .map((id) => routeById.get(id)?.shortName || id)
        .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
      params.set('lines', tokens.join(','));
    }
  }

  if (input.selectedStationId) {
    params.set('station', input.selectedStationId);
  }

  if (input.basemap === 'liberty') {
    params.set('style', 'street');
  }

  if (input.showDensity) {
    params.set('density', '1');
  }

  if (input.lang === 'fr' || input.lang === 'en') {
    params.set('lang', input.lang);
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
