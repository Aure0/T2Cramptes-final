import test from 'node:test';
import assert from 'node:assert/strict';
import type { StationArrival } from '../types/transit';
import { groupStationArrivalsByDirection } from './stationGrouping';

function makeArrival(overrides: Partial<StationArrival>): StationArrival {
  return {
    tripId: 't1',
    vehicleId: 'v1',
    routeId: 'A',
    routeShortName: 'A',
    routeColor: '#AB161B',
    routeTextColor: '#FFFFFF',
    routeType: 0,
    directionId: 0,
    headsign: 'Les Vergnes',
    stopId: 'stop1',
    arrivalTime: 1000,
    departureTime: 1000,
    delaySeconds: 0,
    isActiveVehicle: true,
    ...overrides,
  };
}

test('groupStationArrivalsByDirection separates opposite directions and orders by soonest arrival', () => {
  const arrivals: StationArrival[] = [
    makeArrival({ tripId: 't3', headsign: 'Les Vergnes', arrivalTime: 1600 }),
    makeArrival({ tripId: 't2', headsign: 'La Pardieu Gare', directionId: 1, arrivalTime: 1100 }),
    makeArrival({ tripId: 't1', headsign: 'Les Vergnes', arrivalTime: 1200 }),
    makeArrival({ tripId: 't4', headsign: 'La Pardieu Gare', directionId: 1, arrivalTime: 1700 }),
  ];

  const groups = groupStationArrivalsByDirection(arrivals);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].displayHeadsign, 'La Pardieu Gare');
  assert.deepEqual(
    groups[0].arrivals.map((a) => a.tripId),
    ['t2', 't4']
  );
  assert.equal(groups[1].displayHeadsign, 'Les Vergnes');
  assert.deepEqual(
    groups[1].arrivals.map((a) => a.tripId),
    ['t1', 't3']
  );
});
