import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import * as Location from "expo-location";

import type { LatLng } from "../lib/emergencyTypes";

export type LocationStatus = "locating" | "ready" | "denied" | "unavailable";

export type CurrentLocation = {
  status: LocationStatus;
  coords: LatLng | null;
  /** Metres, as reported by the device. */
  accuracy: number | null;
  /** When the fix was taken (ms). */
  fixedAt: number | null;
  /** False when the OS will no longer show the permission prompt (send people to Settings). */
  canAskAgain: boolean;
  /** Ask for permission (if needed) and take a fresh fix. Resolves to the best position we have. */
  refresh: () => Promise<LatLng | null>;
  openSettings: () => void;
};

const FIX_TIMEOUT_MS = 12000;

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Foreground location for emergency screens. Shows a last-known fix immediately, then replaces it
 * with a fresh one; `watch` keeps it updated while the screen is open. Never hangs: a fix that
 * takes longer than 12 s falls back to whatever we already have.
 */
export function useCurrentLocation({ watch = false }: { watch?: boolean } = {}): CurrentLocation {
  const [status, setStatus] = useState<LocationStatus>("locating");
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [fixedAt, setFixedAt] = useState<number | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const coordsRef = useRef<LatLng | null>(null);
  const fixedAtRef = useRef<number | null>(null);
  const mounted = useRef(true);

  const apply = useCallback((position: Location.LocationObject | null) => {
    if (!position || !mounted.current) return;
    // Ignore fixes older than the one we show (watch + one-shot requests can interleave).
    if (fixedAtRef.current && position.timestamp < fixedAtRef.current) return;
    const next = { lat: position.coords.latitude, lng: position.coords.longitude };
    fixedAtRef.current = position.timestamp;
    coordsRef.current = next;
    setCoords(next);
    setAccuracy(position.coords.accuracy ?? null);
    setFixedAt(position.timestamp);
    setStatus("ready");
  }, []);

  const refresh = useCallback(async () => {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted" && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!mounted.current) return coordsRef.current;
      setCanAskAgain(permission.canAskAgain);
      if (permission.status !== "granted") {
        setStatus("denied");
        return null;
      }

      if (!coordsRef.current) setStatus("locating");
      const servicesOn = await Location.hasServicesEnabledAsync();
      if (!servicesOn) {
        if (!coordsRef.current) setStatus("unavailable");
        return coordsRef.current;
      }

      apply(await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null));
      const fresh = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
        FIX_TIMEOUT_MS,
      );
      apply(fresh);
      if (!coordsRef.current && mounted.current) setStatus("unavailable");
      return coordsRef.current;
    } catch {
      if (mounted.current && !coordsRef.current) setStatus("unavailable");
      return coordsRef.current;
    }
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!watch || status === "denied") return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted" || cancelled) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 },
        apply,
      );
      if (cancelled) subscription.remove();
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [watch, status === "denied", apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  return { status, coords, accuracy, fixedAt, canAskAgain, refresh, openSettings };
}
