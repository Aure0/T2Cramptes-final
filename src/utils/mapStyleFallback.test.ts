import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackMapStyle,
  buildRasterFallbackMapStyle,
  classifyMapLibreError,
  getBasemapStyleChain,
  shouldAdvanceBasemapProvider,
  styleSupportsGlyphLabels,
} from './mapStyleFallback';

test('getBasemapStyleChain provides 4 ordered failover tiers for dark and light themes', () => {
  const darkChain = getBasemapStyleChain('dark');
  assert.deepEqual(
    darkChain.map((c) => c.id),
    ['carto-vector', 'openfreemap-vector', 'carto-raster', 'offline-canvas']
  );
  assert.match(darkChain[0].styleUrl || '', /dark-matter-gl-style\/style\.json$/);
  assert.match(darkChain[1].styleUrl || '', /tiles\.openfreemap\.org\/styles\/dark$/);

  const lightChain = getBasemapStyleChain('liberty');
  assert.deepEqual(
    lightChain.map((c) => c.id),
    ['carto-vector', 'openfreemap-vector', 'carto-raster', 'offline-canvas']
  );
  assert.match(lightChain[0].styleUrl || '', /voyager-gl-style\/style\.json$/);
  assert.match(lightChain[1].styleUrl || '', /tiles\.openfreemap\.org\/styles\/liberty$/);
});

test('buildRasterFallbackMapStyle and buildFallbackMapStyle produce valid MapLibre v8 styles', () => {
  const rasterDark = buildRasterFallbackMapStyle('dark');
  assert.equal(rasterDark.version, 8);
  assert.ok('carto-raster' in rasterDark.sources);
  assert.equal(styleSupportsGlyphLabels(rasterDark), false);

  const offlineDark = buildFallbackMapStyle('dark');
  assert.equal(offlineDark.version, 8);
  assert.deepEqual(offlineDark.sources, {});
  assert.equal(offlineDark.layers.length, 1);
  assert.equal(styleSupportsGlyphLabels(offlineDark), false);
});

test('styleSupportsGlyphLabels detects valid glyph endpoints', () => {
  assert.equal(
    styleSupportsGlyphLabels({
      glyphs: 'https://tiles.basemaps.cartocdn.com/v/20261118-01/fonts/{fontstack}/{range}.pbf',
    }),
    true
  );
  assert.equal(styleSupportsGlyphLabels({ glyphs: '' }), false);
  assert.equal(styleSupportsGlyphLabels({}), false);
  assert.equal(styleSupportsGlyphLabels(null), false);
});

test('classifyMapLibreError separates style-load, source-or-tile, font/sprite transient, and runtime errors', () => {
  const cartoUrl = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const ofmUrl = 'https://tiles.openfreemap.org/styles/dark';

  // Style document failure
  assert.equal(
    classifyMapLibreError(
      { status: 0, url: cartoUrl, message: `AJAXError: Load failed (0): ${cartoUrl}` },
      cartoUrl
    ),
    'style-load'
  );
  assert.equal(
    classifyMapLibreError(
      { status: 503, url: ofmUrl, message: `AJAXError: Service Unavailable (503): ${ofmUrl}` },
      ofmUrl
    ),
    'style-load'
  );

  // TileJSON (/planet) or vector tile (.pbf / .mvt) failures -> source-or-tile
  assert.equal(
    classifyMapLibreError(
      {
        status: 0,
        url: 'https://tiles.openfreemap.org/planet',
        message: 'AJAXError: Load failed (0): https://tiles.openfreemap.org/planet',
      },
      ofmUrl
    ),
    'source-or-tile'
  );
  assert.equal(
    classifyMapLibreError(
      {
        status: 404,
        url: 'https://tiles.openfreemap.org/planet/20261122_124456_pt/12/2083/1460.pbf',
        message: 'AJAXError: Not Found (404)',
      },
      ofmUrl
    ),
    'source-or-tile'
  );
  assert.equal(
    classifyMapLibreError(
      {
        status: 0,
        url: 'https://tiles.basemaps.cartocdn.com/v/20261118-01/vectortiles/carto.streets/v2/12/2083/1460.mvt',
        message: 'AJAXError: Load failed (0)',
      },
      cartoUrl
    ),
    'source-or-tile'
  );

  // Font/sprite transient error -> network-transient (does not trigger basemap failover)
  assert.equal(
    classifyMapLibreError(
      {
        status: 404,
        url: 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf',
        message: 'AJAXError: Not Found (404)',
      },
      ofmUrl
    ),
    'network-transient'
  );

  // Non-network runtime error
  assert.equal(classifyMapLibreError(new Error('WebGL context lost'), cartoUrl), 'other');
});

test('shouldAdvanceBasemapProvider fails over on style-load or repeated zero-tile source errors', () => {
  assert.equal(
    shouldAdvanceBasemapProvider({
      category: 'style-load',
      loadedBasemapTiles: 0,
      consecutiveTileErrors: 0,
      providerIndex: 0,
      chainLength: 4,
    }),
    true
  );

  // Single tile error shouldn't immediately thrash; 2+ consecutive errors with 0 loaded tiles triggers failover
  assert.equal(
    shouldAdvanceBasemapProvider({
      category: 'source-or-tile',
      loadedBasemapTiles: 0,
      consecutiveTileErrors: 1,
      providerIndex: 0,
      chainLength: 4,
    }),
    false
  );
  assert.equal(
    shouldAdvanceBasemapProvider({
      category: 'source-or-tile',
      loadedBasemapTiles: 0,
      consecutiveTileErrors: 2,
      providerIndex: 0,
      chainLength: 4,
    }),
    true
  );

  // Once tiles have already loaded successfully, an occasional tile blip should NOT tear down the map
  assert.equal(
    shouldAdvanceBasemapProvider({
      category: 'source-or-tile',
      loadedBasemapTiles: 6,
      consecutiveTileErrors: 4,
      providerIndex: 0,
      chainLength: 4,
    }),
    false
  );

  // Never advance past final offline tier
  assert.equal(
    shouldAdvanceBasemapProvider({
      category: 'style-load',
      loadedBasemapTiles: 0,
      consecutiveTileErrors: 5,
      providerIndex: 3,
      chainLength: 4,
    }),
    false
  );
});
