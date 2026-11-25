import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline,
  decodeStaticIndex,
  encodePolyline,
  encodeStaticIndexV2,
  type CompactStaticIndexV1,
} from './staticIndexCodec';

test('encodePolyline & decodePolyline round-trip Clermont-Ferrand coordinates within 1e-5 deg', () => {
  const pts = [
    { lat: 45.777213, lng: 3.087012 },
    { lat: 45.778945, lng: 3.081234 },
    { lat: 45.764102, lng: 3.112891 },
    { lat: 45.812345, lng: 3.098765 },
  ];

  const encoded = encodePolyline(pts);
  assert.ok(encoded.length > 0 && encoded.length < JSON.stringify(pts).length / 3);

  const decoded = decodePolyline(encoded);
  assert.equal(decoded.length, pts.length);
  for (let i = 0; i < pts.length; i++) {
    assert.ok(Math.abs(decoded[i].lat - pts[i].lat) < 0.00001);
    assert.ok(Math.abs(decoded[i].lng - pts[i].lng) < 0.00001);
  }
});

test('encodeStaticIndexV2 deduplicates identical polylines across display and directional shapes', () => {
  const sharedPoly = [
    { lat: 45.7772, lng: 3.087 },
    { lat: 45.7795, lng: 3.089 },
  ];
  const encoded = encodeStaticIndexV2({
    platforms: {
      STOP_1: { parentStationId: 'ST_1', name: 'Jaude', lat: 45.7772, lng: 3.087 },
    },
    displayShapesByRoute: {
      A: [sharedPoly],
    },
    shapesByRouteDir: {
      'A:0': [sharedPoly],
    },
  });

  assert.equal(encoded.v, 2);
  assert.equal(encoded.polylines.length, 1);
  assert.deepEqual(encoded.displayShapesByRoute.A, [0]);
  assert.deepEqual(encoded.shapesByRouteDir['A:0'], [0]);

  const decoded = decodeStaticIndex(encoded);
  assert.equal(decoded.platforms.get('STOP_1')?.name, 'Jaude');
  assert.equal(decoded.displayShapesByRoute.get('A')?.length, 1);
  assert.equal(decoded.shapesByRouteDir.get('A:0')?.length, 1);
  assert.ok(
    Math.abs((decoded.displayShapesByRoute.get('A')?.[0][0].lat ?? 0) - 45.7772) < 0.00001
  );
});

test('decodeStaticIndex remains backward-compatible with legacy V1 payloads', () => {
  const v1: CompactStaticIndexV1 = {
    platforms: {
      P1: ['S1', 'Gare SNCF', 45.7787, 3.1006],
    },
    displayShapesByRoute: {
      B: [
        [
          [45.7787, 3.1006],
          [45.7772, 3.087],
        ],
      ],
    },
    shapesByRouteDir: {
      'B:0': [
        [45.7787, 3.1006],
        [45.7772, 3.087],
      ],
    },
  };

  const decoded = decodeStaticIndex(v1);
  assert.equal(decoded.platforms.get('P1')?.parentStationId, 'S1');
  assert.equal(decoded.displayShapesByRoute.get('B')?.[0].length, 2);
  assert.equal(decoded.shapesByRouteDir.get('B:0')?.[0].length, 2);
});
