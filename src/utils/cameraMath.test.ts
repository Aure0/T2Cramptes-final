import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDeadZoneFollowShift,
  computeStationCameraPlan,
  easeOutCubic,
  STATION_HUB_MIN_ZOOM,
  STATION_STOP_MIN_ZOOM,
} from './cameraMath';

const CLERMONT_CENTER = { lat: 45.7772, lng: 3.087 };
const JAUDE = { lat: 45.7765, lng: 3.0819 };
const LES_VERGNES = { lat: 45.8165, lng: 3.1098 };

test('easeOutCubic starts at 0, decelerates smoothly, and ends at 1', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(0.5), 0.875);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.25) < easeOutCubic(0.5));
  assert.ok(easeOutCubic(0.5) < easeOutCubic(0.75));
});

test('computeStationCameraPlan uses smooth flyTo for distant station or zoom-in transitions', () => {
  const plan = computeStationCameraPlan({
    currentCenter: CLERMONT_CENTER,
    currentZoom: 12.2,
    target: LES_VERGNES,
    isMajorHub: false,
    viewportWidthPx: 1440,
    viewportHeightPx: 900,
    hasMobileBottomSheet: false,
    prefersReducedMotion: false,
  });

  assert.equal(plan.mode, 'fly');
  assert.deepEqual(plan.center, [LES_VERGNES.lng, LES_VERGNES.lat]);
  assert.equal(plan.zoom, STATION_STOP_MIN_ZOOM);
  assert.ok(plan.durationMs >= 850 && plan.durationMs <= 1400);
  assert.equal(plan.curve, 1.32);
  assert.equal(plan.padding.bottom, 32);
});

test('computeStationCameraPlan preserves tighter zoom and uses smooth ease for nearby hop', () => {
  const plan = computeStationCameraPlan({
    currentCenter: { lat: 45.7766, lng: 3.0835 },
    currentZoom: 16.4,
    target: JAUDE,
    isMajorHub: true,
    viewportWidthPx: 1440,
    viewportHeightPx: 900,
    hasMobileBottomSheet: false,
    prefersReducedMotion: false,
  });

  assert.equal(plan.mode, 'ease');
  assert.equal(plan.zoom, 16.4);
  assert.equal(plan.durationMs, 650);
});

test('computeStationCameraPlan offsets bottom padding on mobile so station centers above bottom sheet', () => {
  const plan = computeStationCameraPlan({
    currentCenter: CLERMONT_CENTER,
    currentZoom: 12.2,
    target: JAUDE,
    isMajorHub: true,
    viewportWidthPx: 390,
    viewportHeightPx: 844,
    hasMobileBottomSheet: true,
    prefersReducedMotion: false,
  });

  assert.equal(plan.mode, 'fly');
  assert.equal(plan.zoom, STATION_HUB_MIN_ZOOM);
  assert.ok(plan.padding.bottom >= 400 && plan.padding.bottom <= 500);
  assert.equal(plan.padding.top, 56);
});

test('computeStationCameraPlan honors prefers-reduced-motion with instant jump', () => {
  const plan = computeStationCameraPlan({
    currentCenter: CLERMONT_CENTER,
    currentZoom: 12.2,
    target: JAUDE,
    isMajorHub: true,
    viewportWidthPx: 1440,
    viewportHeightPx: 900,
    hasMobileBottomSheet: false,
    prefersReducedMotion: true,
  });

  assert.equal(plan.mode, 'jump');
  assert.equal(plan.durationMs, 0);
  assert.equal(plan.zoom, STATION_HUB_MIN_ZOOM);
});

test('computeDeadZoneFollowShift stays still inside dead-zone and pans independently per axis', () => {
  // Inside dead-zone: no pan at all
  const inside = computeDeadZoneFollowShift({
    pointX: 550,
    pointY: 420,
    width: 1000,
    height: 800,
  });
  assert.equal(inside.shouldPan, false);
  assert.equal(inside.shiftX, 0);
  assert.equal(inside.shiftY, 0);

  // Exceeds X margin ONLY (marginX = 240 -> edge at 740, point at 800 -> +60px);
  // Y is slightly off-center (430 vs 400) but inside marginY (208) -> shiftY MUST remain 0!
  const xOnly = computeDeadZoneFollowShift({
    pointX: 800,
    pointY: 430,
    width: 1000,
    height: 800,
  });
  assert.equal(xOnly.shouldPan, true);
  assert.equal(xOnly.shiftX, 60);
  assert.equal(xOnly.shiftY, 0);
  assert.equal(xOnly.newCenterX, 560);
  assert.equal(xOnly.newCenterY, 400);

  // Exceeds Y margin ONLY -> shiftX MUST remain 0
  const yOnly = computeDeadZoneFollowShift({
    pointX: 460,
    pointY: 100,
    width: 1000,
    height: 800,
  });
  assert.equal(yOnly.shouldPan, true);
  assert.equal(yOnly.shiftX, 0);
  assert.ok(yOnly.shiftY < -80);

  // Mobile bottom-sheet inset shifts safe vertical framing upward
  const mobileBottomSheet = computeDeadZoneFollowShift({
    pointX: 195,
    pointY: 360,
    width: 390,
    height: 760,
    bottomInsetPx: 420,
  });
  assert.equal(mobileBottomSheet.shouldPan, true);
  assert.ok(mobileBottomSheet.shiftY > 50);
});
