import test from 'node:test';
import assert from 'node:assert/strict';
import type { LatLngPoint, TransitRoute } from '../types/transit';
import {
  buildStackedCorridorFeatures,
  clusterStationPlatforms,
  deduplicateRouteShapes,
} from './routeCorridorMath';
import { haversineMeters } from './transitMath';

test('deduplicateRouteShapes collapses two-way street into one line while preserving branches and one-way loops', () => {
  // Outbound runs West -> East along lat 45.7770
  const outbound: LatLngPoint[] = [
    { lat: 45.7770, lng: 3.0800 },
    { lat: 45.7770, lng: 3.0850 },
    { lat: 45.7770, lng: 3.0900 },
  ];
  // Inbound returns East -> West 10m north (same two-way avenue)
  const inboundSameStreet: LatLngPoint[] = [
    { lat: 45.77709, lng: 3.0900 },
    { lat: 45.77709, lng: 3.0850 },
    { lat: 45.77709, lng: 3.0800 },
  ];
  // Branch diverges 220m north from the eastern half
  const northBranch: LatLngPoint[] = [
    { lat: 45.7770, lng: 3.0800 },
    { lat: 45.7770, lng: 3.0850 },
    { lat: 45.7790, lng: 3.0875 },
    { lat: 45.7790, lng: 3.0900 },
  ];

  // 1. Two-way street only -> collapses to a single polyline!
  const twoWayOnly = deduplicateRouteShapes([outbound, inboundSameStreet]);
  assert.equal(twoWayOnly.length, 1, 'Same two-way street outbound+inbound must draw 1 line');

  // 2. With distinct branch -> trunk + 1 bridged branch segment (2 polylines total, no doubled trunk)
  const withBranch = deduplicateRouteShapes([outbound, inboundSameStreet, northBranch]);
  assert.equal(withBranch.length, 2, 'Distinct branch must be preserved without doubling the trunk');
  // Both the north branch tip and main eastern tip must be covered within 5m
  const allPts = withBranch.flat();
  const minDistToBranchTip = Math.min(
    ...allPts.map((pt) => haversineMeters(pt, { lat: 45.7790, lng: 3.0900 }))
  );
  const minDistToMainTip = Math.min(
    ...allPts.map((pt) => haversineMeters(pt, { lat: 45.7770, lng: 3.0900 }))
  );
  assert.ok(minDistToBranchTip < 5, `Expected branch tip covered, got ${minDistToBranchTip}m`);
  assert.ok(minDistToMainTip < 5, `Expected main tip covered, got ${minDistToMainTip}m`);
});

test('clusterStationPlatforms splits Jaude Tram vs Bus/BHNS into distinct accurately located stops', () => {
  const tramLine: LatLngPoint[] = [
    { lat: 45.7755, lng: 3.08176 },
    { lat: 45.7780, lng: 3.08176 },
  ];
  const busLine: LatLngPoint[] = [
    { lat: 45.77703, lng: 3.0790 },
    { lat: 45.77703, lng: 3.0830 },
  ];
  const routeShapes = new Map<string, LatLngPoint[][]>([
    ['A', [tramLine]],
    ['B', [busLine]],
    ['C', [busLine]],
  ]);
  const sortOrders = new Map<string, number>([
    ['A', 1],
    ['B', 2],
    ['C', 3],
  ]);

  const clusters = clusterStationPlatforms(
    'JAUD',
    'Clermont-Ferrand Jaude',
    [
      {
        stopId: 'JAUDA',
        name: 'Jaude',
        lat: 45.776758,
        lng: 3.081772,
        wheelchair: true,
        routeIds: ['A'],
        hasTram: true,
      },
      {
        stopId: 'JAUDR',
        name: 'Jaude',
        lat: 45.776881,
        lng: 3.081751,
        wheelchair: true,
        routeIds: ['A'],
        hasTram: true,
      },
      {
        stopId: 'JAUDB',
        name: 'Jaude',
        lat: 45.777017,
        lng: 3.080743,
        wheelchair: true,
        routeIds: ['B', 'C'],
        hasTram: false,
      },
      {
        stopId: 'JAUDS',
        name: 'Jaude',
        lat: 45.777049,
        lng: 3.081283,
        wheelchair: true,
        routeIds: ['B', 'C'],
        hasTram: false,
      },
    ],
    routeShapes,
    sortOrders
  );

  assert.equal(clusters.length, 2, 'Jaude must split into Tram and Bus physical stops');
  const tramStop = clusters.find((c) => c.mode === 'tram')!;
  const busStop = clusters.find((c) => c.mode === 'bus')!;
  assert.ok(tramStop && busStop);
  assert.equal(tramStop.name, 'Clermont-Ferrand Jaude (Tram)');
  assert.equal(busStop.name, 'Clermont-Ferrand Jaude (Bus)');
  assert.deepEqual(tramStop.routeIds, ['A']);
  assert.deepEqual(busStop.routeIds, ['B', 'C']);

  // Physical distance between Jaude (Tram) and Jaude (Bus) should be ~55-65m
  const separationM = haversineMeters(tramStop, busStop);
  assert.ok(separationM > 45 && separationM < 85, `Expected ~60m separation, got ${separationM}m`);
  // Tram stop must be snapped directly onto Tram line (lng === 3.08176)
  assert.ok(Math.abs(tramStop.lng - 3.08176) < 0.00003);
  // Bus stop must be snapped directly onto Bus line (lat === 45.77703)
  assert.ok(Math.abs(busStop.lat - 45.77703) < 0.00003);
});

test('buildStackedCorridorFeatures stacks opposite-digitized shared routes side-by-side and centers solo routes', () => {
  const makeRoute = (
    id: string,
    sortOrder: number,
    color: string,
    shape: LatLngPoint[]
  ): TransitRoute => ({
    id,
    shortName: id,
    longName: id,
    description: id,
    routeType: 3,
    color,
    textColor: '#FFFFFF',
    sortOrder,
    tier: 'core',
    headsigns: [],
    shapes: [shape],
    stationIds: [],
  });

  // Route B runs West -> East along shared corridor then turns North alone
  const routeB = makeRoute('B', 2, '#0069B4', [
    { lat: 45.7770, lng: 3.0800 },
    { lat: 45.7770, lng: 3.0840 },
    { lat: 45.7800, lng: 3.0840 },
  ]);
  // Route C runs OPPOSITE (East -> West) along the shared corridor then continues West alone
  const routeC = makeRoute('C', 3, '#008C3C', [
    { lat: 45.7770, lng: 3.0840 },
    { lat: 45.7770, lng: 3.0800 },
    { lat: 45.7770, lng: 3.0760 },
  ]);

  const fc = buildStackedCorridorFeatures([routeB, routeC], {
    focusedRouteId: null,
    showDensity: false,
  });

  const bFeatures = fc.features.filter((f) => f.properties?.routeId === 'B');
  const cFeatures = fc.features.filter((f) => f.properties?.routeId === 'C');

  // Route B should have both an offset shared section (-0.5) and a centered solo section (0)
  assert.ok(bFeatures.some((f) => f.properties?.offsetSlot === -0.5), 'Expected Route B shared slot -0.5');
  assert.ok(bFeatures.some((f) => f.properties?.offsetSlot === 0), 'Expected Route B solo slot 0');

  // Route C runs OPPOSITE to reference Route B on the shared section:
  // Its rank slot is +0.5, negated by opposite dot product -> -0.5 relative to C's own westbound vector
  // (left of westbound = South, while -0.5 of eastbound B = North -> opposite sides, zero collision!)
  assert.ok(cFeatures.some((f) => f.properties?.offsetSlot === -0.5), 'Expected Route C aligned shared slot -0.5');
  assert.ok(cFeatures.some((f) => f.properties?.offsetSlot === 0), 'Expected Route C solo slot 0');
});
