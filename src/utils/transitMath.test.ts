import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBearing,
  classifyT2CRouteTier,
  computeSegmentProgress,
  findNearestPointIndex,
  formatDelayStatus,
  formatEtaCountdown,
  formatParisClock,
  formatShortStationLabel,
  haversineMeters,
  interpolateAlongPath,
  normalizeSearchText,
  preparePolylinePath,
  projectPointOntoPolyline,
  resolveLiveFeedClock,
  samplePreparedPath,
  simplifyPath,
  sliceBestShapeBetweenStops,
  sliceShapeBetweenStops,
} from './transitMath';

test('haversineMeters computes accurate distance in Clermont-Ferrand', () => {
  // Place de Jaude to Gare SNCF (~1.5 km)
  const jaude = { lat: 45.7769, lng: 3.0819 };
  const gare = { lat: 45.7789, lng: 3.1008 };
  const dist = haversineMeters(jaude, gare);
  assert.ok(dist > 1400 && dist < 1600, `Expected ~1480m, got ${dist}`);
});

test('calculateBearing returns cardinal headings accurately', () => {
  const origin = { lat: 45.77, lng: 3.08 };
  const north = { lat: 45.78, lng: 3.08 };
  const east = { lat: 45.77, lng: 3.09 };
  const south = { lat: 45.76, lng: 3.08 };

  assert.ok(calculateBearing(origin, north) < 1 || calculateBearing(origin, north) > 359);
  assert.ok(Math.abs(calculateBearing(origin, east) - 90) < 1);
  assert.ok(Math.abs(calculateBearing(origin, south) - 180) < 1);
});

test('interpolateAlongPath smoothly moves along multi-segment path', () => {
  const path = [
    { lat: 45.77, lng: 3.08 },
    { lat: 45.77, lng: 3.09 },
    { lat: 45.78, lng: 3.09 },
  ];

  const start = interpolateAlongPath(path, 0);
  assert.equal(start.position.lat, 45.77);
  assert.equal(start.position.lng, 3.08);

  const end = interpolateAlongPath(path, 1);
  assert.equal(end.position.lat, 45.78);
  assert.equal(end.position.lng, 3.09);

  const mid = interpolateAlongPath(path, 0.25);
  assert.ok(mid.position.lng > 3.08 && mid.position.lng < 3.09);
  assert.ok(Math.abs(mid.bearing - 90) < 2);
});

test('preparePolylinePath + samplePreparedPath match interpolateAlongPath accurately', () => {
  const path = [
    { lat: 45.770, lng: 3.080 },
    { lat: 45.773, lng: 3.085 },
    { lat: 45.778, lng: 3.086 },
    { lat: 45.782, lng: 3.092 },
  ];
  const prepared = preparePolylinePath(path);
  assert.ok(prepared.totalLength > 1000);
  assert.equal(prepared.cumDist.length, path.length);
  assert.equal(prepared.segBearings.length, path.length - 1);

  for (const t of [0, 0.1, 0.37, 0.5, 0.72, 0.99, 1]) {
    const a = samplePreparedPath(prepared, t);
    const b = interpolateAlongPath(path, t);
    assert.ok(Math.abs(a.position.lat - b.position.lat) < 1e-9);
    assert.ok(Math.abs(a.position.lng - b.position.lng) < 1e-9);
    assert.ok(Math.abs(a.bearing - b.bearing) < 1e-4);
  }
});

test('computeSegmentProgress clamps cleanly between 0 and 1', () => {
  assert.equal(computeSegmentProgress(100, 100, 200), 0);
  assert.equal(computeSegmentProgress(150, 100, 200), 0.5);
  assert.equal(computeSegmentProgress(250, 100, 200), 1);
  assert.equal(computeSegmentProgress(50, 100, 200), 0);
});

test('findNearestPointIndex locates closest shape vertex with exact distance', () => {
  const shape = [
    { lat: 45.770, lng: 3.080 },
    { lat: 45.775, lng: 3.085 },
    { lat: 45.780, lng: 3.090 },
  ];
  const res = findNearestPointIndex(shape, { lat: 45.7752, lng: 3.0849 });
  assert.equal(res.index, 1);
  assert.ok(res.distanceMeters < 30);
});

test('sliceShapeBetweenStops extracts exact on-shape sub-polyline without backward vertex jumps', () => {
  const shape = [
    { lat: 45.770, lng: 3.080 },
    { lat: 45.772, lng: 3.081 },
    { lat: 45.774, lng: 3.082 },
    { lat: 45.776, lng: 3.083 },
    { lat: 45.778, lng: 3.084 },
  ];
  const from = { lat: 45.7721, lng: 3.0811 };
  const to = { lat: 45.7761, lng: 3.0831 };
  const sliced = sliceShapeBetweenStops(shape, from, to);

  assert.ok(haversineMeters(sliced[0], from) < 20);
  assert.ok(haversineMeters(sliced[sliced.length - 1], to) < 20);
  assert.ok(sliced.length >= 3, `Expected intermediate vertices, got ${sliced.length}`);
  // First segment must point strictly forward (~19 deg NNE), never backward!
  const firstBear = calculateBearing(sliced[0], sliced[1]);
  const overallBear = calculateBearing(from, to);
  const diff = Math.abs(firstBear - overallBear);
  assert.ok(Math.min(diff, 360 - diff) < 15, `Expected forward heading, got diff ${diff}`);
});

test('projectPointOntoPolyline & sliceShapeBetweenStops handle 900m straight simplified gaps without snapping backward', () => {
  // Reproduces the exact Tram A Avenue de la République / Hôtel de Ville -> Delille case
  const longStraightShape = [
    { lat: 45.78036, lng: 3.08386 },
    { lat: 45.78140, lng: 3.09173 }, // ~620m straight segment
    { lat: 45.78200, lng: 3.09350 },
  ];
  const hovir = { lat: 45.78060, lng: 3.08500 }; // 93m past vertex 0, ON segment 0->1
  const demor = { lat: 45.78122, lng: 3.09045 }; // 101m before vertex 1, ON segment 0->1

  const projStart = projectPointOntoPolyline(longStraightShape, hovir);
  assert.ok(projStart !== null);
  assert.ok(projStart.distanceMeters < 15, `Expected on-segment projection, got ${projStart.distanceMeters}m`);
  assert.ok(projStart.alongMeters > 70, 'Must project forward along segment, not back to vertex 0');

  const sliced = sliceShapeBetweenStops(longStraightShape, hovir, demor);
  const firstBear = calculateBearing(sliced[0], sliced[1]);
  const overallBear = calculateBearing(hovir, demor);
  const diff = Math.abs(firstBear - overallBear);
  assert.ok(Math.min(diff, 360 - diff) < 5, `Expected forward eastbound heading, got diff ${diff}`);
});

test('sliceBestShapeBetweenStops snaps inbound vehicles cleanly onto deduplicated display line in reverse', () => {
  // Display line runs South -> North
  const displayTrunk = [
    { lat: 45.770, lng: 3.085 },
    { lat: 45.775, lng: 3.085 },
    { lat: 45.780, lng: 3.085 },
  ];
  // Inbound directional shape runs North -> South 10m to the east
  const dir1Shape = [
    { lat: 45.780, lng: 3.08513 },
    { lat: 45.775, lng: 3.08513 },
    { lat: 45.770, lng: 3.08513 },
  ];
  const fromNorth = { lat: 45.779, lng: 3.08513 };
  const toSouth = { lat: 45.772, lng: 3.08513 };

  const seg = sliceBestShapeBetweenStops([dir1Shape], fromNorth, toSouth, [displayTrunk]);
  // Should ride strictly southbound (~180 deg) on the display trunk (lng === 3.085)
  assert.ok(Math.abs(seg[0].lng - 3.085) < 1e-6);
  assert.ok(Math.abs(seg[seg.length - 1].lng - 3.085) < 1e-6);
  const bear = calculateBearing(seg[0], seg[seg.length - 1]);
  assert.ok(Math.abs(bear - 180) < 2, `Expected ~180 deg southbound, got ${bear}`);
});

test('samplePreparedPathInto look-ahead bearing ignores tiny 1m quantized vertex jitter', () => {
  // Straight eastbound line with a tiny 1m northbound quantization blip in the middle
  const noisyPath = [
    { lat: 45.77700, lng: 3.08000 },
    { lat: 45.77700, lng: 3.08100 },
    { lat: 45.77701, lng: 3.08101 }, // 1.3m diagonal quantization blip (~38 deg)
    { lat: 45.77700, lng: 3.08200 },
  ];
  const prepared = preparePolylinePath(noisyPath);
  const mid = samplePreparedPath(prepared, 0.5);
  assert.ok(Math.abs(mid.bearing - 90) < 5, `Expected ~90 deg eastbound despite 1m blip, got ${mid.bearing}`);
});

test('simplifyPath preserves endpoints and reduces collinear points', () => {
  const collinear = [
    { lat: 45.77, lng: 3.08 },
    { lat: 45.771, lng: 3.081 },
    { lat: 45.772, lng: 3.082 },
    { lat: 45.773, lng: 3.083 },
  ];
  const simplified = simplifyPath(collinear, 0.00005);
  assert.equal(simplified.length, 2);
  assert.deepEqual(simplified[0], collinear[0]);
  assert.deepEqual(simplified[1], collinear[3]);
});

test('classifyT2CRouteTier categorizes T2C InspiRe routes properly', () => {
  assert.equal(classifyT2CRouteTier('A'), 'core');
  assert.equal(classifyT2CRouteTier('B'), 'core');
  assert.equal(classifyT2CRouteTier('C'), 'core');
  assert.equal(classifyT2CRouteTier('E1'), 'essential');
  assert.equal(classifyT2CRouteTier('S10'), 'secondary');
  assert.equal(classifyT2CRouteTier('P34'), 'local');
  assert.equal(classifyT2CRouteTier('110'), 'other');
});

test('formatEtaCountdown, formatDelayStatus, and formatParisClock produce clean labels', () => {
  const now = 1_795_100_000;
  assert.equal(formatEtaCountdown(now + 20, now), 'Due');
  assert.equal(formatEtaCountdown(now + 180, now), '3 min');
  assert.equal(formatEtaCountdown(now + 4200, now), '1h 10m');

  assert.deepEqual(formatDelayStatus(25), { label: 'On time', tone: 'ontime' });
  assert.deepEqual(formatDelayStatus(185), { label: '+3 min late', tone: 'delayed' });
  assert.deepEqual(formatDelayStatus(-130), { label: '2 min early', tone: 'early' });

  assert.match(formatParisClock(now, false), /^\d{2}:\d{2}$/);
  assert.match(formatParisClock(now, true), /^\d{2}:\d{2}:\d{2}$/);
});

test('preparePolylinePath caches prepared tables per path array identity', () => {
  const path = [
    { lat: 45.77, lng: 3.08 },
    { lat: 45.775, lng: 3.085 },
  ];
  const first = preparePolylinePath(path);
  const second = preparePolylinePath(path);
  assert.equal(first, second);
});

test('formatShortStationLabel strips T2C commune prefixes and redundant duplicates cleanly', () => {
  assert.equal(
    formatShortStationLabel("Clermont-Ferrand Bibliothèque de l'Hôtel Dieu"),
    "Bibliothèque de l'Hôtel Dieu"
  );
  assert.equal(formatShortStationLabel('Clermont-Ferrand Jaude'), 'Jaude');
  assert.equal(formatShortStationLabel("Cournon-d'Auvergne Alouettes"), 'Alouettes');
  assert.equal(formatShortStationLabel('Pont-du-Château Carrosse'), 'Carrosse');
  assert.equal(
    formatShortStationLabel('Pérignat-lès-Sarliève Croix Notre-Dame'),
    'Croix Notre-Dame'
  );
  assert.equal(formatShortStationLabel('Blanzat Pl. du Montel'), 'Pl. du Montel');
  assert.equal(formatShortStationLabel('Le Cendre Arverne'), 'Arverne');
  assert.equal(
    formatShortStationLabel('Saint-Genès-Champanelle Beaune Le Chaud'),
    'Beaune Le Chaud'
  );
  // Redundant immediate repetition of the same commune is also removed
  assert.equal(formatShortStationLabel('Aubière AUBIÈRE Pl. des Ramacles'), 'Pl. des Ramacles');
  assert.equal(
    formatShortStationLabel('Chamalières CHAMALIÈRES Aristide Briand'),
    'Aristide Briand'
  );
  assert.equal(
    formatShortStationLabel('Mur sur Allier MUR-SUR-ALLIER Font Grande'),
    'Font Grande'
  );
  assert.equal(
    formatShortStationLabel("Pérignat-sur-Allier PÉRIGNAT-ÈS-ALLIER La Garde"),
    'La Garde'
  );
  assert.equal(
    formatShortStationLabel("Les Martres-d'Artière LES MARTRES D'ARTIÈRE École"),
    'École'
  );
  // Distinct secondary landmark/commune name is preserved
  assert.equal(formatShortStationLabel('Chamalières ROYAT Pl. Allard'), 'ROYAT Pl. Allard');
  // Standalone commune or non-prefixed stop name is never emptied
  assert.equal(formatShortStationLabel('Royat'), 'Royat');
  assert.equal(formatShortStationLabel('Gare de Gerzat'), 'Gare de Gerzat');
});

test('resolveLiveFeedClock preserves real staleness while calibrating broken device clocks', () => {
  const now = 1_795_100_000;

  // Fresh feed (25s old) -> live
  const fresh = resolveLiveFeedClock(now, now - 25);
  assert.equal(fresh.feedStatus, 'live');
  assert.equal(fresh.calibratedFromFeed, false);
  assert.equal(fresh.serverNowSeconds, now);
  assert.equal(fresh.feedAgeSec, 25);

  // Genuinely stale feed (10 min old) -> stale (NOT masked as live!)
  const stale = resolveLiveFeedClock(now, now - 600);
  assert.equal(stale.feedStatus, 'stale');
  assert.equal(stale.calibratedFromFeed, false);
  assert.equal(stale.feedAgeSec, 600);

  // Genuinely degraded feed (40 min old) -> degraded
  const degraded = resolveLiveFeedClock(now, now - 2400);
  assert.equal(degraded.feedStatus, 'degraded');
  assert.equal(degraded.calibratedFromFeed, false);

  // Device clock lagging behind feed timestamp (>90s in the future) -> calibrate to feed clock
  const laggingDevice = resolveLiveFeedClock(now - 300, now);
  assert.equal(laggingDevice.calibratedFromFeed, true);
  assert.equal(laggingDevice.serverNowSeconds, now);
  assert.equal(laggingDevice.feedStatus, 'live');

  // Device clock wildly ahead (>1h wrong timezone/year) -> calibrate to feed clock
  const wrongYear = resolveLiveFeedClock(now + 7200, now);
  assert.equal(wrongYear.calibratedFromFeed, true);
  assert.equal(wrongYear.serverNowSeconds, now);
  assert.equal(wrongYear.feedStatus, 'live');
});

test('normalizeSearchText enables accent-insensitive French transit search', () => {
  assert.equal(normalizeSearchText('  CÉBAZAT CHU L. Michel '), 'cebazat chu l. michel');
  assert.equal(normalizeSearchText('AUBIÈRE'), 'aubiere');
  assert.equal(normalizeSearchText('Chamalières'), 'chamalieres');
  assert.equal(normalizeSearchText('Trémonteix'), 'tremonteix');
  assert.equal(normalizeSearchText("Hôtel-Dieu"), 'hotel dieu');
  assert.equal(normalizeSearchText("Pont-du-Château"), 'pont du chateau');
});
