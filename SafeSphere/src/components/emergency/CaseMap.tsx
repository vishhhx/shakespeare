import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { AlertTriangle, Building2, User } from "lucide-react-native";

import { radius, space, useTheme, type Palette } from "../../theme";
import { AppText } from "../ui";
import { metresBetween } from "../../hooks/useDirections";
import {
  RESPONDER_STATUS_LABELS,
  ROLE_LABELS,
  type CaseResponder,
  type LatLng,
  type Organization,
} from "../../lib/emergencyTypes";

/** A shared position older than this is shown as stale (faded, "last seen …"). */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export const ageText = (iso?: string | null) => {
  if (!iso) return "time unknown";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
};

const isStale = (iso?: string | null) => !iso || Date.now() - new Date(iso).getTime() > STALE_AFTER_MS;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

type Party =
  | { id: string; kind: "incident"; coordinate: LatLng; title: string; detail: string }
  | { id: string; kind: "reporter"; coordinate: LatLng; title: string; detail: string; stale: boolean }
  | { id: string; kind: "responder"; coordinate: LatLng; title: string; detail: string; stale: boolean; responder: CaseResponder }
  | { id: string; kind: "authority"; coordinate: LatLng; title: string; detail: string };

const markerColors = (colors: Palette) => ({
  incident: colors.danger,
  reporter: colors.info,
  responder: colors.success,
  authority: colors.accentText,
});

type Props = {
  incident: LatLng & { address?: string; reportedAt?: string };
  subjectLabel: string;
  reporter?: { name: string; liveLocation: (LatLng & { updatedAt: string }) | null; isViewer: boolean };
  responders: CaseResponder[];
  authority?: Organization | null;
  /** Route for the viewing responder; drawn only from real routing data. */
  route?: { latitude: number; longitude: number }[];
  showMyLocation: boolean;
};

export function CaseMap({ incident, subjectLabel, reporter, responders, authority, route, showMyLocation }: Props) {
  const { colors } = useTheme();
  const tint = markerColors(colors);
  const mapRef = useRef<MapView>(null);
  const [selectedId, setSelectedId] = useState<string>("incident");

  const parties = useMemo<Party[]>(() => {
    const list: Party[] = [
      {
        id: "incident",
        kind: "incident",
        coordinate: incident,
        title: "Incident location",
        detail: `${subjectLabel} · reported ${ageText(incident.reportedAt)}${incident.address ? ` · ${incident.address}` : ""}`,
      },
    ];
    const live = reporter?.liveLocation;
    // The reporter is only drawn separately when their live position differs from the incident.
    if (reporter && live && metresBetween(live, incident) > 25) {
      list.push({
        id: "reporter",
        kind: "reporter",
        coordinate: live,
        title: reporter.isViewer ? "You (reporter)" : `${reporter.name} (reporter)`,
        detail: `Live position · updated ${ageText(live.updatedAt)}`,
        stale: isStale(live.updatedAt),
      });
    }
    for (const responder of responders) {
      if (!responder.location) continue;
      list.push({
        id: `responder-${responder.userId}`,
        kind: "responder",
        coordinate: responder.location,
        title: responder.isMe ? "You" : responder.name,
        detail: `${ROLE_LABELS[responder.actorRole]}${responder.organization ? ` · ${responder.organization.name}` : ""} · ${
          RESPONDER_STATUS_LABELS[responder.status]
        } · position ${ageText(responder.locationUpdatedAt)}`,
        stale: isStale(responder.locationUpdatedAt),
        responder,
      });
    }
    if (authority?.location) {
      list.push({
        id: "authority",
        kind: "authority",
        coordinate: authority.location,
        title: authority.name,
        detail: "Responsible authority · registered station (not a live position)",
      });
    }
    return list;
  }, [authority, incident, reporter, responders, subjectLabel]);

  const fitKey = parties.map((party) => party.id).join("|");
  useEffect(() => {
    const coordinates = [
      ...parties.map((party) => ({ latitude: party.coordinate.lat, longitude: party.coordinate.lng })),
      ...(route?.length ? [route[0]!] : []),
    ];
    const timer = setTimeout(() => {
      if (coordinates.length > 1) {
        mapRef.current?.fitToCoordinates(coordinates, {
          edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
          animated: true,
        });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [fitKey, route?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = parties.find((party) => party.id === selectedId) ?? parties[0]!;
  const unlocated = responders.filter((responder) => !responder.location);

  const legend: { kind: Party["kind"]; label: string }[] = [
    { kind: "incident", label: "Incident" },
    { kind: "reporter", label: "Reporter (live)" },
    { kind: "responder", label: "Responders" },
    { kind: "authority", label: "Authority station" },
  ];

  return (
    <View style={styles.wrap}>
      <View style={[styles.mapFrame, { borderColor: colors.border }]}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          style={StyleSheet.absoluteFill}
          initialRegion={{ latitude: incident.lat, longitude: incident.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
          showsUserLocation={showMyLocation}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          accessibilityLabel="Map of the incident, the reporter and responders"
        >
          {route && route.length > 1 && <Polyline coordinates={route} strokeColor={colors.info} strokeWidth={5} />}
          {parties.map((party) => (
            <Marker
              key={`${party.id}-${"stale" in party && party.stale ? "s" : "f"}`}
              coordinate={{ latitude: party.coordinate.lat, longitude: party.coordinate.lng }}
              onPress={() => setSelectedId(party.id)}
              tracksViewChanges={false}
              anchor={party.kind === "incident" ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
              accessibilityLabel={`${party.title}. ${party.detail}`}
              zIndex={party.kind === "incident" ? 10 : 5}
            >
              <MarkerGlyph party={party} color={tint[party.kind]} border={colors.surface} />
            </Marker>
          ))}
        </MapView>
      </View>

      <View style={styles.legend}>
        {legend.map((item) => (
          <View key={item.kind} style={styles.legendItem}>
            <LegendGlyph kind={item.kind} color={tint[item.kind]} />
            <AppText variant="caption" tone="muted">{item.label}</AppText>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="summary"
        style={[styles.detail, { backgroundColor: colors.surfaceMuted }]}
        onPress={() =>
          mapRef.current?.animateToRegion({
            latitude: selected.coordinate.lat,
            longitude: selected.coordinate.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          })
        }
      >
        <LegendGlyph kind={selected.kind} color={tint[selected.kind]} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{selected.title}</AppText>
          <AppText variant="caption" tone="muted">{selected.detail}</AppText>
          {"stale" in selected && selected.stale && (
            <AppText variant="caption" tone="danger">This position may be out of date.</AppText>
          )}
        </View>
      </Pressable>

      {unlocated.length > 0 && (
        <AppText variant="caption" tone="muted">
          Not on the map (no position shared yet): {unlocated.map((responder) => (responder.isMe ? "you" : responder.name)).join(", ")}.
        </AppText>
      )}
    </View>
  );
}

function MarkerGlyph({ party, color, border }: { party: Party; color: string; border: string }) {
  const faded = "stale" in party && party.stale;
  if (party.kind === "incident") {
    return (
      <View style={styles.pinWrap}>
        <View style={[styles.pin, { backgroundColor: color, borderColor: border }]}>
          <AlertTriangle size={18} color="#FFFFFF" />
        </View>
        <View style={[styles.pinTail, { borderTopColor: color }]} />
      </View>
    );
  }
  if (party.kind === "authority") {
    return (
      <View style={[styles.square, { backgroundColor: color, borderColor: border }]}>
        <Building2 size={16} color="#FFFFFF" />
      </View>
    );
  }
  if (party.kind === "reporter") {
    return (
      <View style={[styles.circle, { backgroundColor: color, borderColor: border, opacity: faded ? 0.5 : 1 }]}>
        <User size={16} color="#FFFFFF" />
      </View>
    );
  }
  return (
    <View style={[styles.circle, { backgroundColor: color, borderColor: border, opacity: faded ? 0.5 : 1 }]}>
      <AppText variant="overline" style={styles.onColor}>{initials(party.title)}</AppText>
    </View>
  );
}

function LegendGlyph({ kind, color }: { kind: Party["kind"]; color: string }) {
  if (kind === "incident") return <View style={[styles.legendPin, { backgroundColor: color }]} />;
  if (kind === "authority") return <View style={[styles.legendSquare, { backgroundColor: color }]} />;
  return <View style={[styles.legendDot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  mapFrame: { height: 300, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendSquare: { width: 12, height: 12, borderRadius: 3 },
  legendPin: { width: 12, height: 12, borderRadius: 6, borderBottomRightRadius: 0, transform: [{ rotate: "45deg" }] },
  detail: { flexDirection: "row", gap: space.sm, padding: space.sm, borderRadius: radius.md, alignItems: "flex-start" },
  flex: { flex: 1, gap: 2 },
  pinWrap: { alignItems: "center" },
  pin: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -2,
  },
  circle: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  square: { width: 30, height: 30, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  onColor: { color: "#FFFFFF" },
});
