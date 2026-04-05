import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { updateUserLocation } from './api';

interface LocationTrackingOptions {
  enableTracking: boolean;
  intervalSeconds?: number;
  debug?: boolean;
}

/**
 * Custom hook for continuous location tracking
 * Periodically updates user location to backend if enabled
 */
export const useLocationTracking = (options: LocationTrackingOptions) => {
  const {
    enableTracking,
    intervalSeconds = 30,
    debug = false,
  } = options;

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enableTracking) {
      // Stop tracking if disabled
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (watchSubscriptionRef.current) {
        watchSubscriptionRef.current.remove();
        watchSubscriptionRef.current = null;
      }
      setIsTracking(false);
      if (debug) console.log('[LocationTracking] Stopped tracking');
      return;
    }

    // Start tracking
    const startTracking = async () => {
      try {
        // Request permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Permission denied');
          if (debug) console.error('[LocationTracking] Permission denied');
          return;
        }

        setIsTracking(true);
        if (debug) console.log('[LocationTracking] Started tracking');

        // Send location immediately and then subscribe to movement updates.
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await sendLocationUpdate(initial.coords.latitude, initial.coords.longitude);

        watchSubscriptionRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: intervalSeconds * 1000,
            distanceInterval: 20,
          },
          async (position) => {
            await sendLocationUpdate(position.coords.latitude, position.coords.longitude);
          },
        );

        // Heartbeat update for cases where user is static and movement callback is sparse.
        heartbeatIntervalRef.current = setInterval(async () => {
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          await sendLocationUpdate(current.coords.latitude, current.coords.longitude);
        }, intervalSeconds * 1000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        if (debug) console.error('[LocationTracking] Error:', message);
      }
    };

    const sendLocationUpdate = async (latitude: number, longitude: number) => {
      try {
        const locationData = {
          lat: latitude,
          lng: longitude,
        };

        await updateUserLocation(locationData);
        setLastUpdateTime(new Date());
        setError(null);

        if (debug) {
          console.log('[LocationTracking] Location updated:', locationData, 'at', new Date().toISOString());
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        if (debug) console.error('[LocationTracking] Failed to send location:', message);
      }
    };

    startTracking();

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (watchSubscriptionRef.current) {
        watchSubscriptionRef.current.remove();
        watchSubscriptionRef.current = null;
      }
    };
  }, [enableTracking, intervalSeconds, debug]);

  return {
    isTracking,
    lastUpdateTime,
    error,
  };
};
