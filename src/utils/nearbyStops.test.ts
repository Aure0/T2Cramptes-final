import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransitStation } from '../types/transit';
import {
  estimateWalkMinutes,
  findNearbyStations,
  formatDistanceLabel,
  haversineDistanceMeters,
} from './nearbyStops';

const SAMPLE_STATIONS: TransitStation[] = [
  {
    id: 'jaude',
    name: 'Jaude (Tram)',
    lat: 45.7769,
    lng: 3.0819,
    wheelchairAccessible: true,
    routeIds: ['A'],
    platformIds: ['p1'],
    isMajorHub: true,
  },
  {
    id: 'gaillard',
    name: 'Gaillard (Tram)',
    lat: 45.7804,
    lng: 3.0825,
    wheelchairAccessible: true,
    routeIds: ['A'],
    platformIds: ['p2'],
    isMajorHub: true,
  },
  {
    id: 'far_away',
    name: 'Pardieu Gare',
    lat: 45.758,
    lng: 3.133,
    wheelchairAccessible: true,
    routeIds: ['A'],
    platformIds: ['p3'],
    isMajorHub: true,
  },
];

test('haversineDistanceMeters computes accurate Clermont-Ferrand distances', () => {
  const dist = haversineDistanceMeters(
    { lat: 45.7769, lng: 3.0819 },
    { lat: 45.7804, lng: 3.0825 }
  );
  assert.ok(dist > 350 && dist < 430, `expected ~390m, got ${dist}`);
});

test('findNearbyStations sorts closest first and filters outside maxDistanceMeters', () => {
  const nearby = findNearbyStations({ lat: 45.777, lng: 3.082 }, SAMPLE_STATIONS, {
    maxDistanceMeters: 1500,
    limit: 5,
  });
  assert.equal(nearby.length, 2);
  assert.equal(nearby[0].station.id, 'jaude');
  assert.equal(nearby[1].station.id, 'gaillard');
  assert.equal(nearby[0].walkMinutes, 1);
  assert.ok(nearby[1].walkMinutes >= 4 && nearby[1].walkMinutes <= 6);
});

test('formatDistanceLabel localizes meters and kilometers cleanly in FR and EN', () => {
  assert.equal(formatDistanceLabel(143, 'fr'), '140 m');
  assert.equal(formatDistanceLabel(1250, 'fr'), '1,3 km');
  assert.equal(formatDistanceLabel(1250, 'en'), '1.3 km');
  assert.equal(estimateWalkMinutes(0), 1);
});
