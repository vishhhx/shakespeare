import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router, usePathname } from "expo-router";

import { AuthContext } from "./authContext";
import { SocketContext } from "./socketContext";
import { getMyActiveEmergency, shareCaseLocation } from "../lib/api";
import type { ActiveCases, EmergencyCard } from "../lib/emergencyTypes";

// Written by older builds; the server is now the source of truth for open cases.
const LEGACY_ACTIVE_CASE_KEY = "activeEmergencyCase";

/** Case events after which "my open case" may have changed. */
const REFRESH_EVENTS = [
  "connect",
  "emergency-case-updated",
  "emergency-case-closed",
  "emergency-dispatch-update",
  "emergency-response-accepted",
  "emergency-assigned",
  "emergency-responder-left",
];

const SHARE_MIN_INTERVAL_MS = 15000;
const SHARE_MIN_DISTANCE_M = 40;

type ActiveCaseValue = {
  active: ActiveCases | null;
  /** The case to resume: the one I reported, else the newest one I'm responding to. */
  primary: (EmergencyCard & { asReporter: boolean }) | null;
  loading: boolean;
  refresh: () => Promise<ActiveCases | null>;
};

const ActiveCaseContext = createContext<ActiveCaseValue>({
  active: null,
  primary: null,
  loading: false,
  refresh: async () => null,
});

export const useActiveCase = () => useContext(ActiveCaseContext);

const metresBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export function ActiveCaseProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, userDetails } = useContext(AuthContext);
  const { on, off } = useContext(SocketContext);
  const pathname = usePathname();
  const [active, setActive] = useState<ActiveCases | null>(null);
  const [loading, setLoading] = useState(false);
  const resumedThisLaunch = useRef(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const signedIn = Boolean(isAuthenticated && userDetails?.userId);
  const profileReady = Boolean(userDetails?.isprofileComplete);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setActive(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await getMyActiveEmergency();
      setActive(next);
      return next;
    } catch {
      return null; // keep the last known state on transient failures
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void AsyncStorage.removeItem(LEGACY_ACTIVE_CASE_KEY).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setActive(null);
      resumedThisLaunch.current = false;
      return;
    }
    void refresh();
  }, [signedIn, userDetails?.userId, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 400);
    };
    for (const event of REFRESH_EVENTS) on(event, scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      for (const event of REFRESH_EVENTS) off(event, scheduleRefresh);
    };
  }, [on, off, refresh]);

  const primary = useMemo(() => {
    if (active?.asReporter) return { ...active.asReporter, asReporter: true };
    const responding = active?.asResponder?.[0];
    return responding ? { ...responding, asReporter: false } : null;
  }, [active]);

  // Resume an open case once after launch. Only once: the user must be free to leave the case
  // screen (the old guard redirected on every navigation and trapped people there).
  useEffect(() => {
    if (resumedThisLaunch.current || !primary || !profileReady) return;
    const path = pathnameRef.current;
    if (path === "/case" || path.startsWith("/auth") || path.startsWith("/onboarding")) return;
    resumedThisLaunch.current = true;
    router.push({ pathname: "/case", params: { emergencyId: primary.emergencyId } });
  }, [primary, profileReady]);

  // Share my position with the case(s) I'm on while the app is open. Only with those cases,
  // throttled to save battery, and only if location permission was already granted.
  const caseIds = useMemo(
    () => [active?.asReporter?.emergencyId, ...(active?.asResponder ?? []).map((item) => item.emergencyId)].filter(Boolean) as string[],
    [active],
  );
  const caseKey = caseIds.join(",");

  useEffect(() => {
    if (!caseIds.length) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    let lastSent: { at: number; lat: number; lng: number } | null = null;

    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted" || cancelled) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: SHARE_MIN_INTERVAL_MS },
        (position) => {
          const point = { lat: position.coords.latitude, lng: position.coords.longitude };
          const now = Date.now();
          if (
            lastSent &&
            now - lastSent.at < SHARE_MIN_INTERVAL_MS &&
            metresBetween(lastSent, point) < SHARE_MIN_DISTANCE_M
          ) {
            return;
          }
          lastSent = { at: now, ...point };
          const recordedAt = new Date(position.timestamp || now).toISOString();
          for (const emergencyId of caseIds) {
            void shareCaseLocation(emergencyId, { ...point, recordedAt }).catch(() => undefined);
          }
        },
      );
      if (cancelled) subscription.remove();
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [caseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({ active, primary, loading, refresh }), [active, primary, loading, refresh]);
  return <ActiveCaseContext.Provider value={value}>{children}</ActiveCaseContext.Provider>;
}
