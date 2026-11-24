import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransitStation } from '../types/transit';
import {
  buildThermalColorLut,
  computeDensityHotspots,
  computeVehicleCongestionWeight,
  computeZoomKernelRadiusPx,
  type WeightedDensityPoint,
} from './densityMath';

test('computeVehicleCongestionWeight weights trams and delayed vehicles accurately', () => {
  const onTimeBus = computeVehicleCongestionWeight({ routeType: 3, delaySeconds: 30 }, 'congestion');
  const onTimeTram = computeVehicleCongestionWeight({ routeType: 0, delaySeconds: 30 }, 'congestion');
  const delayedBus = computeVehicleCongestionWeight({ routeType: 3, delaySeconds: 420 }, 'congestion');
  const volumeDelayedBus = computeVehicleCongestionWeight({ routeType: 3, delaySeconds: 420 }, 'volume');

  assert.equal(onTimeBus, 1.0);
  assert.equal(onTimeTram, 1.25);
  assert.ok(delayedBus > 1.5 && delayedBus <= 2.1, `expected boosted weight, got ${delayedBus}`);
  assert.equal(volumeDelayedBus, 1.0);
});

test('buildThermalColorLut creates valid 256-step dark-mode RGBA palette', () => {
  const lut = buildThermalColorLut();
  assert.equal(lut.length, 256 * 4);
  // Index 0 must be fully transparent
  assert.equal(lut[3], 0);
  // High intensity must be bright warm red/pink with strong opacity
  const peakOffset = 255 * 4;
  assert.ok(lut[peakOffset] > 230, 'peak red channel high');
  assert.ok(lut[peakOffset + 3] > 220, 'peak alpha high');
});

test('computeZoomKernelRadiusPx scales smoothly and stays within visual bounds', () => {
  const z11 = computeZoomKernelRadiusPx(11);
  const z13 = computeZoomKernelRadiusPx(13);
  const z16 = computeZoomKernelRadiusPx(16);
  assert.ok(z11 >= 22 && z11 < z13);
  assert.ok(z13 < z16 && z16 <= 110);
});

test('computeDensityHotspots clusters nearby vehicles and labels by nearest station', () => {
  const stations: TransitStation[] = [
    {
      id: 'st_jaude',
      name: 'Clermont-Ferrand Jaude',
      lat: 45.7768,
      lng: 3.0819,
      wheelchairAccessible: true,
      routeIds: ['A', 'B', 'C'],
      platformIds: ['p1'],
      isMajorHub: true,
    },
    {
      id: 'st_pardieu',
      name: 'Clermont-Ferrand La Pardieu Gare',
      lat: 45.7642,
      lng: 3.1338,
      wheelchairAccessible: true,
      routeIds: ['A'],
      platformIds: ['p2'],
      isMajorHub: true,
    },
  ];

  const points: WeightedDensityPoint[] = [
    {
      vehicleId: 'v1',
      routeId: 'A',
      routeShortName: 'A',
      position: { lat: 45.7769, lng: 3.082 },
      delaySeconds: 240,
      weight: 1.8,
    },
    {
      vehicleId: 'v2',
      routeId: 'B',
      routeShortName: 'B',
      position: { lat: 45.7772, lng: 3.0824 },
      delaySeconds: 180,
      weight: 1.4,
    },
    {
      vehicleId: 'v3',
      routeId: 'C',
      routeShortName: 'C',
      position: { lat: 45.7765, lng: 3.0815 },
      delaySeconds: 60,
      weight: 1.0,
    },
    {
      vehicleId: 'v4',
      routeId: 'A',
      routeShortName: 'A',
      position: { lat: 45.7643, lng: 3.1336 },
      delaySeconds: 0,
      weight: 1.25,
    },
  ];

  const summary = computeDensityHotspots(points, stations, 680, 3);
  assert.equal(summary.totalVehicles, 4);
  assert.equal(summary.delayedVehicles, 2);
  assert.equal(summary.hotspots.length, 2);
  assert.equal(summary.hotspots[0].zoneName, 'Jaude');
  assert.equal(summary.hotspots[0].vehicleCount, 3);
  assert.equal(summary.hotspots[1].zoneName, 'La Pardieu Gare');
  assert.equal(summary.hotspots[1].vehicleCount, 1);
});
