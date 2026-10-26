import { useEffect, useRef, useState } from "react";

import type { LatLng } from "../lib/emergencyTypes";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
/** Re-route when the responder has moved this far from where the last route started… */
const REROUTE_DISTANCE_M = 150;
/** …or this long has passed (traffic and ETA change). */
const REROUTE_INTERVAL_MS = 60000;

export type DirectionsState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      path: { latitude: number; longitude: number }[];
      distanceText: string;
      durationText: string;
      distanceMeters: number;
      durationSeconds: number;
      fetchedAt: number;
    }
  | { status: "error"; message: string };

export const metresBetween = (a: LatLng, b: LatLng) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** Google encoded-polyline decoder. */
const decodePolyline = (encoded: string) => {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
};

/**
 * Driving route from `origin` to `destination` using Google Directions. Only real routing data
 * is returned: on failure the state is "error" and callers must not draw an invented line.
 */
export function useDirections(origin: LatLng | null, destination: LatLng | null, enabled: boolean): DirectionsState {
  const [state, setState] = useState<DirectionsState>({ status: "idle" });
  const lastRequest = useRef<{ origin: LatLng; at: number; destinationKey: string } | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (!enabled || !origin || !destination) {
      inFlight.current?.abort();
      setState({ status: "idle" });
      lastRequest.current = null;
      return;
    }
    if (!GOOGLE_MAPS_API_KEY) {
      setState({ status: "error", message: "Directions aren't configured in this build." });
      return;
    }

    const destinationKey = `${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
    const previous = lastRequest.current;
    const due =
      !previous ||
      previous.destinationKey !== destinationKey ||
      metresBetween(previous.origin, origin) > REROUTE_DISTANCE_M ||
      Date.now() - previous.at > REROUTE_INTERVAL_MS;
    if (!due) return;
    lastRequest.current = { origin, at: Date.now(), destinationKey };

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    if (!previous) setState({ status: "loading" });
    const url =
      "https://maps.googleapis.com/maps/api/directions/json" +
      `?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}` +
      `&mode=driving&departure_time=now&key=${GOOGLE_MAPS_API_KEY}`;

    void fetch(url, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        const route = data?.routes?.[0];
        const leg = route?.legs?.[0];
        if (data?.status !== "OK" || !leg || !route?.overview_polyline?.points) {
          setState({
            status: "error",
            message: data?.status === "ZERO_RESULTS" ? "No driving route to the incident was found." : "Directions are unavailable right now.",
          });
          return;
        }
        const duration = leg.duration_in_traffic ?? leg.duration;
        setState({
          status: "ready",
          path: decodePolyline(route.overview_polyline.points),
          distanceText: leg.distance?.text ?? "",
          durationText: duration?.text ?? "",
          distanceMeters: leg.distance?.value ?? 0,
          durationSeconds: duration?.value ?? 0,
          fetchedAt: Date.now(),
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setState({ status: "error", message: "Directions are unavailable right now." });
      });
  }, [enabled, origin?.lat, origin?.lng, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
