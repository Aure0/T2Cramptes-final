import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLngPoint } from '../types/transit';

export type GeolocationErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export interface UserLocationPoint extends LatLngPoint {
  accuracy: number;
  updatedAtMs: number;
}

export interface UseGeolocationResult {
  location: UserLocationPoint | null;
  isLocating: boolean;
  errorCode: GeolocationErrorCode | null;
  locateNonce: number;
  requestLocation: () => void;
  clearLocation: () => void;
}

export function useGeolocation(): UseGeolocationResult {
  const [location, setLocation] = useState<UserLocationPoint | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [errorCode, setErrorCode] = useState<GeolocationErrorCode | null>(null);
  const [locateNonce, setLocateNonce] = useState(0);
  const watchIdRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopWatch();
  }, [stopWatch]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErrorCode('unsupported');
      return;
    }

    setIsLocating(true);
    setErrorCode(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: UserLocationPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 25),
          updatedAtMs: Date.now(),
        };
        setLocation(next);
        setLocateNonce((n) => n + 1);
        setIsLocating(false);
        setErrorCode(null);

        // Start passive watch to keep blue dot gently updated while active
        if (watchIdRef.current === null) {
          try {
            watchIdRef.current = navigator.geolocation.watchPosition(
              (watchPos) => {
                setLocation({
                  lat: watchPos.coords.latitude,
                  lng: watchPos.coords.longitude,
                  accuracy: Math.round(watchPos.coords.accuracy || 25),
                  updatedAtMs: Date.now(),
                });
              },
              () => {
                // Keep last known fix quietly on transient watch errors
              },
              {
                enableHighAccuracy: false,
                maximumAge: 15_000,
                timeout: 15_000,
              }
            );
          } catch {
            // Ignore watch failures in restricted webviews
          }
        }
      },
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setErrorCode('denied');
        } else if (err.code === err.TIMEOUT) {
          setErrorCode('timeout');
        } else {
          setErrorCode('unavailable');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 20_000,
      }
    );
  }, []);

  const clearLocation = useCallback(() => {
    stopWatch();
    setLocation(null);
    setErrorCode(null);
    setIsLocating(false);
  }, [stopWatch]);

  return {
    location,
    isLocating,
    errorCode,
    locateNonce,
    requestLocation,
    clearLocation,
  };
}
