import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapStyle } from './userPreferences';

export type MapLibreErrorCategory =
  | 'style-load'
  | 'source-or-tile'
  | 'network-transient'
  | 'other';

export interface BasemapProviderCandidate {
  id: 'carto-vector' | 'openfreemap-vector' | 'carto-raster' | 'offline-canvas';
  label: string;
  style: string | StyleSpecification;
  /** Non-empty URL when `style` is a remote style document */
  styleUrl: string | null;
  /** Whether this provider renders remote map tiles that can fail to load */
  expectsRemoteTiles: boolean;
}

interface MapLibreAjaxLikeError {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  url?: unknown;
}

/**
 * Retina raster fallback style backed by CARTO's global Fastly CDN.
 * Requires zero external style JSON, zero vector tile parsing, and zero WebGL glyph dependencies,
 * guaranteeing a crisp dark/light street map even if vector tile providers experience an outage.
 */
export function buildRasterFallbackMapStyle(basemap: BasemapStyle): StyleSpecification {
  const isDark = basemap === 'dark';
  const tilePath = isDark ? 'dark_all' : 'rastertiles/voyager';
  return {
    version: 8,
    name: isDark ? 'T2Cramptés Raster Dark' : 'T2Cramptés Raster Street',
    sources: {
      'carto-raster': {
        type: 'raster',
        tiles: [
          `https://a.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png`,
          `https://b.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png`,
          `https://c.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png`,
          `https://d.basemaps.cartocdn.com/${tilePath}/{z}/{x}/{y}@2x.png`,
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [
      {
        id: 't2c-raster-background',
        type: 'background',
        paint: {
          'background-color': isDark ? '#0B0F17' : '#EEF2F7',
        },
      },
      {
        id: 't2c-raster-tiles',
        type: 'raster',
        source: 'carto-raster',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
}

/**
 * Self-contained, zero-network MapLibre v8 style used as a final offline fallback
 * whenever all remote basemap providers are unreachable (airplane mode / strict offline).
 */
export function buildFallbackMapStyle(basemap: BasemapStyle): StyleSpecification {
  const isDark = basemap === 'dark';
  return {
    version: 8,
    name: isDark ? 'T2Cramptés Offline Dark' : 'T2Cramptés Offline Light',
    sources: {},
    layers: [
      {
        id: 't2c-fallback-background',
        type: 'background',
        paint: {
          'background-color': isDark ? '#0B0F17' : '#EEF2F7',
        },
      },
    ],
  };
}

/**
 * Ordered 4-tier basemap failover cascade for a given theme (`dark` or `liberty`).
 * 0. CARTO Vector (Fastly global CDN, inline immutable tile URLs, zero rotating TileJSON trap)
 * 1. OpenFreeMap Vector (automatic failover if CARTO Vector is unavailable)
 * 2. CARTO Retina Raster (lightweight PNG tiles if vector tiles fail to load)
 * 3. Offline Canvas (zero-network background so T2C routes & live vehicles always remain visible)
 */
export function getBasemapStyleChain(basemap: BasemapStyle): BasemapProviderCandidate[] {
  const isDark = basemap === 'dark';
  const cartoStyleUrl = isDark
    ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  const ofmStyleUrl = isDark
    ? 'https://tiles.openfreemap.org/styles/dark'
    : 'https://tiles.openfreemap.org/styles/liberty';

  return [
    {
      id: 'carto-vector',
      label: isDark ? 'CARTO Dark Matter (Vector)' : 'CARTO Voyager (Vector)',
      style: cartoStyleUrl,
      styleUrl: cartoStyleUrl,
      expectsRemoteTiles: true,
    },
    {
      id: 'openfreemap-vector',
      label: isDark ? 'OpenFreeMap Dark (Vector)' : 'OpenFreeMap Street (Vector)',
      style: ofmStyleUrl,
      styleUrl: ofmStyleUrl,
      expectsRemoteTiles: true,
    },
    {
      id: 'carto-raster',
      label: isDark ? 'CARTO Dark (Raster)' : 'CARTO Street (Raster)',
      style: buildRasterFallbackMapStyle(basemap),
      styleUrl: null,
      expectsRemoteTiles: true,
    },
    {
      id: 'offline-canvas',
      label: isDark ? 'Offline Dark Canvas' : 'Offline Light Canvas',
      style: buildFallbackMapStyle(basemap),
      styleUrl: null,
      expectsRemoteTiles: false,
    },
  ];
}

/**
 * Returns true only when the loaded MapLibre style provides a glyphs endpoint
 * capable of rendering WebGL `symbol` layers with `text-field`.
 */
export function styleSupportsGlyphLabels(
  style: { glyphs?: unknown } | null | undefined
): boolean {
  return typeof style?.glyphs === 'string' && style.glyphs.trim().length > 0;
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Classifies errors emitted by MapLibre GL's `error` event so:
 * - Style-document failures (`style-load`) immediately advance to the next provider tier.
 * - TileJSON / vector-tile / raster-tile source failures (`source-or-tile`) are tracked so a
 *   "black map with 0 loaded tiles" automatically fails over to a healthy provider.
 * - Transient font/sprite/aborted fetch errors (`network-transient`) are absorbed cleanly without
 *   polluting `console.error`.
 */
export function classifyMapLibreError(
  error: unknown,
  activeStyleUrl: string | null
): MapLibreErrorCategory {
  if (!error || typeof error !== 'object') {
    return 'other';
  }

  const err = error as MapLibreAjaxLikeError;
  const message = typeof err.message === 'string' ? err.message : '';
  const name = typeof err.name === 'string' ? err.name : '';
  const url = typeof err.url === 'string' ? err.url : '';
  const status = typeof err.status === 'number' ? err.status : null;

  const isAjaxOrNetwork =
    status !== null ||
    name === 'AJAXError' ||
    name === 'AbortError' ||
    /^(AJAXError:|Failed to fetch|Load failed|NetworkError|The Internet connection appears to be offline)/i.test(
      message
    ) ||
    /AJAXError|Failed to fetch|Load failed|NetworkError/i.test(message);

  if (!isAjaxOrNetwork) {
    return 'other';
  }

  const target = normalizeUrl(url || message);
  const normalizedStyleUrl = activeStyleUrl ? normalizeUrl(activeStyleUrl) : '';

  if (
    normalizedStyleUrl &&
    (target === normalizedStyleUrl ||
      message.includes(normalizedStyleUrl) ||
      /\/styles\/(dark|liberty)(\?|$)/i.test(target) ||
      /\/gl\/(dark-matter|voyager)-gl-style\/style\.json(\?|$)/i.test(target))
  ) {
    return 'style-load';
  }

  // TileJSON metadata (/planet, /backup_planet) or map tile payloads (.pbf, .mvt, @2x.png)
  const isFontOrSprite = /\/(fonts|sprites)\//i.test(target) || /sprite(@2x)?\.(json|png)/i.test(target);
  if (
    !isFontOrSprite &&
    (/\/(planet|backup_planet)(\/|$)/i.test(target) ||
      /\/vectortiles\//i.test(target) ||
      /\/(dark_all|rastertiles\/voyager)\//i.test(target) ||
      /\.(pbf|mvt)(\?|$)/i.test(target))
  ) {
    return 'source-or-tile';
  }

  return 'network-transient';
}

/**
 * Decides whether the current basemap provider should fail over to the next tier in the chain.
 */
export function shouldAdvanceBasemapProvider(params: {
  category: MapLibreErrorCategory;
  loadedBasemapTiles: number;
  consecutiveTileErrors: number;
  providerIndex: number;
  chainLength: number;
}): boolean {
  if (params.providerIndex >= params.chainLength - 1) return false;
  if (params.category === 'style-load') return true;
  if (
    params.category === 'source-or-tile' &&
    params.loadedBasemapTiles === 0 &&
    params.consecutiveTileErrors >= 2
  ) {
    return true;
  }
  return false;
}
