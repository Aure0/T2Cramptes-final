import type { LatLngPoint } from '../types/transit';
import { haversineMeters } from './transitMath';

export interface CameraPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface StationCameraInput {
  currentCenter: LatLngPoint;
  currentZoom: number;
  target: LatLngPoint;
  isMajorHub: boolean;
  viewportWidthPx: number;
  viewportHeightPx: number;
  hasMobileBottomSheet: boolean;
  prefersReducedMotion: boolean;
}

export interface StationCameraPlan {
  mode: 'fly' | 'ease' | 'jump';
  center: [number, number]; // [lng, lat]
  zoom: number;
  durationMs: number;
  curve: number;
  padding: CameraPadding;
  distanceMeters: number;
}

export const STATION_HUB_MIN_ZOOM = 15.2;
export const STATION_STOP_MIN_ZOOM = 15.6;
export const STATION_MAX_PRESERVED_ZOOM = 17.5;

export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

export function computeStationCameraPlan(input: StationCameraInput): StationCameraPlan {
  const {
    currentCenter,
    currentZoom,
    target,
    isMajorHub,
    viewportWidthPx,
    viewportHeightPx,
    hasMobileBottomSheet,
    prefersReducedMotion,
  } = input;

  const distanceMeters = haversineMeters(currentCenter, target);
  const desiredMinZoom = isMajorHub ? STATION_HUB_MIN_ZOOM : STATION_STOP_MIN_ZOOM;
  const targetZoom = Math.min(
    STATION_MAX_PRESERVED_ZOOM,
    Math.max(currentZoom, desiredMinZoom)
  );
  const zoomDelta = Math.abs(targetZoom - currentZoom);

  // On mobile viewports the bottom sheet occupies ~58dvh, so pad the bottom of the camera
  // framing so the selected station marker centers cleanly in the visible upper map window.
  const padding: CameraPadding =
    hasMobileBottomSheet && viewportWidthPx < 768
      ? {
          top: 56,
          bottom: Math.round(
            Math.max(0, Math.min(viewportHeightPx * 0.56, viewportHeightPx - 140))
          ),
          left: 20,
          right: 20,
        }
      : {
          top: 48,
          bottom: 32,
          left: 24,
          right: 24,
        };

  const center: [number, number] = [target.lng, target.lat];

  if (prefersReducedMotion) {
    return {
      mode: 'jump',
      center,
      zoom: targetZoom,
      durationMs: 0,
      curve: 1,
      padding,
      distanceMeters,
    };
  }

  // Short local hop when already zoomed in: smooth linear-zoom glide without arc bounce
  if (distanceMeters < 450 && zoomDelta < 0.8) {
    return {
      mode: 'ease',
      center,
      zoom: targetZoom,
      durationMs: 650,
      curve: 1,
      padding,
      distanceMeters,
    };
  }

  // Medium/long jump or zoom-in: smooth parabolic flight calibrated to distance & zoom delta
  const durationMs = Math.round(
    Math.min(1400, Math.max(850, 720 + distanceMeters * 0.08 + zoomDelta * 95))
  );
  const curve = distanceMeters > 1500 ? 1.32 : 1.15;

  return {
    mode: 'fly',
    center,
    zoom: targetZoom,
    durationMs,
    curve,
    padding,
    distanceMeters,
  };
}

export interface DeadZoneFollowInput {
  /** Projected screen X of the followed vehicle in CSS pixels */
  pointX: number;
  /** Projected screen Y of the followed vehicle in CSS pixels */
  pointY: number;
  /** Map canvas width in CSS pixels */
  width: number;
  /** Map canvas height in CSS pixels */
  height: number;
  /** Dead-zone half-width as a fraction of viewport width (default 0.24) */
  marginFractionX?: number;
  /** Dead-zone half-height as a fraction of visible viewport height (default 0.26) */
  marginFractionY?: number;
  /** Optional bottom obstruction in CSS pixels (e.g. mobile bottom sheet) */
  bottomInsetPx?: number;
  /** Minimum overflow in pixels required to trigger a camera pan (prevents micro-jitter) */
  minShiftPx?: number;
}

export interface DeadZoneFollowResult {
  shouldPan: boolean;
  /** Target screen-space center X to unproject as the new map center */
  newCenterX: number;
  /** Target screen-space center Y to unproject as the new map center */
  newCenterY: number;
  /** Applied horizontal pixel shift (0 when X is inside the dead-zone) */
  shiftX: number;
  /** Applied vertical pixel shift (0 when Y is inside the dead-zone) */
  shiftY: number;
}

/**
 * Computes a minimal, per-axis camera pan when a followed vehicle exits an inner dead-zone.
 * Unlike coupled clamping, each axis only shifts when it independently overflows its margin,
 * eliminating perpendicular camera drift and keeping fixed map features rock-solid.
 */
export function computeDeadZoneFollowShift(
  input: DeadZoneFollowInput
): DeadZoneFollowResult {
  const {
    pointX,
    pointY,
    width,
    height,
    marginFractionX = 0.24,
    marginFractionY = 0.26,
    bottomInsetPx = 0,
    minShiftPx = 4,
  } = input;

  const centerX = width / 2;
  const centerY = height / 2;

  if (width <= 0 || height <= 0) {
    return {
      shouldPan: false,
      newCenterX: centerX,
      newCenterY: centerY,
      shiftX: 0,
      shiftY: 0,
    };
  }

  const clampedInset = Math.max(0, Math.min(bottomInsetPx, height * 0.7));
  const visibleHeight = Math.max(80, height - clampedInset);
  const safeCenterY = visibleHeight / 2;

  const marginX = width * marginFractionX;
  const marginY = visibleHeight * marginFractionY;

  const dx = pointX - centerX;
  const dy = pointY - safeCenterY;

  const shiftX = Math.abs(dx) > marginX ? dx - Math.sign(dx) * marginX : 0;
  const shiftY = Math.abs(dy) > marginY ? dy - Math.sign(dy) * marginY : 0;

  if (Math.hypot(shiftX, shiftY) < minShiftPx) {
    return {
      shouldPan: false,
      newCenterX: centerX,
      newCenterY: centerY,
      shiftX: 0,
      shiftY: 0,
    };
  }

  return {
    shouldPan: true,
    newCenterX: centerX + shiftX,
    newCenterY: centerY + shiftY,
    shiftX,
    shiftY,
  };
}

