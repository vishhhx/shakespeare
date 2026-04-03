import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { updateUserLocation } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enableTracking) {
      // Stop tracking if disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setIsTracking(false);
        if (debug) console.log('[LocationTracking] Stopped tracking');
      }
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

        // Send location immediately
        await sendLocationUpdate();

        // Set up interval for periodic updates
        intervalRef.current = setInterval(async () => {
          await sendLocationUpdate();
        }, intervalSeconds * 1000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        if (debug) console.error('[LocationTracking] Error:', message);
      }
    };

    const sendLocationUpdate = async () => {
      try {
        // Check if tracking is still enabled in AsyncStorage
        const trackingEnabled = await AsyncStorage.getItem('enableContinuousTracking');
        if (trackingEnabled !== 'true') {
          if (debug) console.log('[LocationTracking] Tracking disabled by user preference');
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setIsTracking(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const locationData = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
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
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enableTracking, intervalSeconds, debug]);

  return {
    isTracking,
    lastUpdateTime,
    error,
  };
};
