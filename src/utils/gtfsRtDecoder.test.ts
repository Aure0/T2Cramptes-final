import assert from 'node:assert/strict';
import test from 'node:test';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { decodeGtfsRtFeedMessage } from './gtfsRtDecoder';

test('decodeGtfsRtFeedMessage decodes official GTFS-RT TripUpdate payloads including negative delays', () => {
  const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;
  const encoded = FeedMessage.encode({
    header: {
      gtfsRealtimeVersion: '2.0',
      timestamp: 1795290000,
    },
    entity: [
      {
        id: 'ent-1',
        tripUpdate: {
          trip: {
            tripId: 'TRIP_A_101',
            routeId: 'A',
            directionId: 1,
          },
          vehicle: {
            id: 'V16',
            label: '16',
          },
          stopTimeUpdate: [
            {
              stopSequence: 4,
              stopId: 'JAUD_1',
              arrival: { delay: -120, time: 1795290060 },
              departure: { delay: -105, time: 1795290075 },
            },
            {
              stopSequence: 5,
              stopId: 'GAILL_1',
              arrival: { delay: 185, time: 1795290360 },
              departure: { delay: 185, time: 1795290380 },
            },
          ],
        },
      },
    ],
  }).finish();

  const decoded = decodeGtfsRtFeedMessage(encoded);

  assert.equal(decoded.header.gtfsRealtimeVersion, '2.0');
  assert.equal(decoded.header.timestamp, 1795290000);
  assert.equal(decoded.entity.length, 1);

  const ent = decoded.entity[0];
  assert.equal(ent.id, 'ent-1');
  assert.equal(ent.tripUpdate?.trip?.tripId, 'TRIP_A_101');
  assert.equal(ent.tripUpdate?.trip?.routeId, 'A');
  assert.equal(ent.tripUpdate?.trip?.directionId, 1);
  assert.equal(ent.tripUpdate?.vehicle?.label, '16');

  const stus = ent.tripUpdate?.stopTimeUpdate || [];
  assert.equal(stus.length, 2);
  assert.equal(stus[0].stopSequence, 4);
  assert.equal(stus[0].stopId, 'JAUD_1');
  assert.equal(stus[0].arrival?.delay, -120);
  assert.equal(stus[0].arrival?.time, 1795290060);
  assert.equal(stus[0].departure?.delay, -105);
  assert.equal(stus[1].arrival?.delay, 185);
  assert.equal(stus[1].departure?.time, 1795290380);
});
