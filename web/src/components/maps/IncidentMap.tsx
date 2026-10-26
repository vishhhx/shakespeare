import { useEffect, useRef, useState } from "react";

import { loadGoogleMaps } from "@/lib/googleMaps";
import { MARKER_COLORS, type LatLng, type MapMarkerKind } from "@/lib/emergency";

export type { MapMarkerKind };

export type MapMarker = {
  id: string;
  kind: MapMarkerKind;
  position: LatLng;
  title: string;
  /** Short text inside the marker (initials, severity letter). */
  label?: string;
  stale?: boolean;
  /** Incident markers are coloured by severity. */
  emphasis?: "critical" | "high" | "medium" | "low";
};

export type RouteResult =
  | { status: "loading" }
  | { status: "ready"; distanceText: string; durationText: string; fetchedAt: number }
  | { status: "error"; message: string };


const SEVERITY_FILL = { critical: "#991B1B", high: "#DC2626", medium: "#F97316", low: "#737373" } as const;

// Pin for incidents, circle for people, rounded square for an organisation's station.
const PIN_PATH = "M12 2C7.6 2 4 5.6 4 10c0 5.4 7 11.5 7.3 11.8.4.3 1 .3 1.4 0C13 21.5 20 15.4 20 10c0-4.4-3.6-8-8-8z";
const SQUARE_PATH = "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z";

const iconFor = (maps: typeof google.maps, marker: MapMarker): google.maps.Symbol => {
  const fill = marker.kind === "incident" && marker.emphasis ? SEVERITY_FILL[marker.emphasis] : MARKER_COLORS[marker.kind];
  const common = { fillColor: fill, fillOpacity: marker.stale ? 0.45 : 1, strokeColor: "#FFFFFF", strokeWeight: 2 };
  if (marker.kind === "incident") return { ...common, path: PIN_PATH, scale: 1.7, anchor: new maps.Point(12, 22), labelOrigin: new maps.Point(12, 10) };
  if (marker.kind === "authority") return { ...common, path: SQUARE_PATH, scale: 1.2, anchor: new maps.Point(12, 12), labelOrigin: new maps.Point(12, 12) };
  return { ...common, path: maps.SymbolPath.CIRCLE, scale: 12 };
};

type Props = {
  markers: MapMarker[];
  /** Route drawn with Google Directions (real data only). */
  route?: { origin: LatLng; destination: LatLng } | null;
  onRoute?: (result: RouteResult) => void;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  className?: string;
};

export default function IncidentMap({ markers, route, onRoute, onSelect, selectedId, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRefs = useRef(new Map<string, google.maps.Marker>());
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const lastRouteRef = useRef<{ key: string; at: number } | null>(null);
  const fittedKeyRef = useRef("");
  const [maps, setMaps] = useState<typeof google.maps | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new api.Map(containerRef.current, {
          center: markers[0]?.position ?? { lat: 20.59, lng: 78.96 },
          zoom: markers.length ? 13 : 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        setMaps(api);
      })
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync markers in place so they don't flicker on every update.
  useEffect(() => {
    if (!maps || !mapRef.current) return;
    const seen = new Set<string>();
    for (const item of markers) {
      seen.add(item.id);
      const existing = markerRefs.current.get(item.id);
      const options: google.maps.MarkerOptions = {
        position: item.position,
        title: item.title,
        icon: iconFor(maps, item),
        label: item.label ? { text: item.label, color: "#FFFFFF", fontSize: "11px", fontWeight: "700" } : undefined,
        zIndex: item.kind === "incident" ? 100 : selectedId === item.id ? 90 : 50,
        opacity: item.stale ? 0.7 : 1,
      };
      if (existing) {
        existing.setOptions(options);
      } else {
        const marker = new maps.Marker({ ...options, map: mapRef.current });
        marker.addListener("click", () => onSelect?.(item.id));
        markerRefs.current.set(item.id, marker);
      }
    }
    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        marker.setMap(null);
        markerRefs.current.delete(id);
      }
    }

    // Fit everything once per new set of markers (not on every position tick).
    const key = markers.map((item) => item.id).sort().join("|");
    if (key !== fittedKeyRef.current && markers.length) {
      fittedKeyRef.current = key;
      if (markers.length === 1) {
        mapRef.current.setCenter(markers[0]!.position);
        mapRef.current.setZoom(14);
      } else {
        const bounds = new maps.LatLngBounds();
        markers.forEach((item) => bounds.extend(item.position));
        mapRef.current.fitBounds(bounds, 64);
      }
    }
  }, [maps, markers, onSelect, selectedId]);

  // Directions: real route or an explicit error; re-request when origin moves >150 m or after 60 s.
  useEffect(() => {
    if (!maps || !mapRef.current) return;
    if (!route) {
      rendererRef.current?.setMap(null);
      rendererRef.current = null;
      lastRouteRef.current = null;
      return;
    }
    const key = `${route.origin.lat.toFixed(3)},${route.origin.lng.toFixed(3)}>${route.destination.lat.toFixed(5)},${route.destination.lng.toFixed(5)}`;
    const last = lastRouteRef.current;
    if (last && last.key === key && Date.now() - last.at < 60000) return;
    lastRouteRef.current = { key, at: Date.now() };
    if (!last) onRoute?.({ status: "loading" });

    new maps.DirectionsService().route(
      {
        origin: route.origin,
        destination: route.destination,
        travelMode: maps.TravelMode.DRIVING,
        drivingOptions: { departureTime: new Date() },
      },
      (result, status) => {
        if (status !== maps.DirectionsStatus.OK || !result?.routes?.[0]?.legs?.[0]) {
          onRoute?.({
            status: "error",
            message: status === maps.DirectionsStatus.ZERO_RESULTS ? "No driving route to the incident was found." : "Directions are unavailable right now.",
          });
          return;
        }
        if (!rendererRef.current) {
          rendererRef.current = new maps.DirectionsRenderer({
            map: mapRef.current!,
            suppressMarkers: true,
            preserveViewport: true,
            polylineOptions: { strokeColor: "#1D4ED8", strokeWeight: 5, strokeOpacity: 0.85 },
          });
        }
        rendererRef.current.setDirections(result);
        const leg = result.routes[0]!.legs[0]!;
        onRoute?.({
          status: "ready",
          distanceText: leg.distance?.text ?? "",
          durationText: (leg.duration_in_traffic ?? leg.duration)?.text ?? "",
          fetchedAt: Date.now(),
        });
      },
    );
  }, [maps, route?.origin.lat, route?.origin.lng, route?.destination.lat, route?.destination.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      markerRefs.current.forEach((marker) => marker.setMap(null));
      rendererRef.current?.setMap(null);
    },
    [],
  );

  if (loadError) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}>
        {loadError}
      </div>
    );
  }

  return <div ref={containerRef} role="region" aria-label="Incident map" className={`rounded-xl border border-border ${className ?? ""}`} />;
}
