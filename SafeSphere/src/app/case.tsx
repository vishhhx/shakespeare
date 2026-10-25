import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { getAppUsers, getEmergencyById, getPublicProfile } from "../lib/api";
import EmergencyVideoCallDrawer from "../components/emergency-video-call-drawer";
import EmergencyChatbotWidget from "../components/emergency-chatbot-widget";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_HEIGHT = 380;

// ─── Types ────────────────────────────────────────────────────────────────────
type MapPoint = {
  lat: number;
  lng: number;
  name?: string;
  phoneNumber?: string;
  profileImage?: string | null;
  authorityType?: string;
  userId?: string;
  authorityProfileId?: string;
  role?: string;
};

type CaseSnapshot = {
  emergencyId?: string;
  title?: string;
  description?: string;
  type?: string;
  severity?: string;
  relationToVictim?: string;
  isForSelf?: boolean;
  victimsCount?: number;
  location?: { lat: number; lng: number } | null;
  condition?: string;
  createdAt?: string;
  matchedUser?: {
    userId: string;
    name: string;
    phoneNumber: string;
    age?: number;
    gender?: string;
    profileImage?: string | null;
    contacts?: {
      name: string;
      phoneNumber: string;
      relation?: string;
      isPrimary?: boolean;
    }[];
    medicalRecord?: {
      bloodGroup?: string;
      allergies?: string[];
      medications?: string[];
      diseases?: string[];
      notes?: string;
    };
    sosMessage?: string;
  } | null;
  dispatchSummary?: {
    nearbyUsers: number;
    nearbyVolunteers: number;
    nearbyAuthorities: number;
    controllerCenters: number;
    contacts: number;
  } | null;
  dispatchMapSnapshot?: {
    incident: { lat: number; lng: number };
    nearbyUsers: MapPoint[];
    nearbyVolunteers: MapPoint[];
    nearbyContacts: MapPoint[];
    nearbyAuthorities: MapPoint[];
  } | null;
  dispatchFeed?: string[];
  respondersConnected?: number;
  participants?: {
    userId: string;
    role: "reporter" | "volunteer" | "authority";
    status?: string;
    joinedAt?: string;
  }[];
  media?: {
    type: "image" | "video" | "audio";
    url: string;
    signedUrl?: string;
  }[];
  privileges?: {
    canEditCase?: boolean;
    canCloseCase?: boolean;
    canBroadcastUpdates?: boolean;
    canViewReporterDetails?: boolean;
  };
};

type SelfEmergencyContact = {
  name: string;
  phoneNumber: string;
  relation?: string;
  isPrimary?: boolean;
};

type AppContactUser = {
  userId: string;
  name: string;
  phoneNumber: string;
};

type RouteInfo = {
  distanceText?: string;
  durationText?: string;
  path: { latitude: number; longitude: number }[];
};

const decodePolyline = (
  encoded: string,
): { latitude: number; longitude: number }[] => {
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const coordinates: { latitude: number; longitude: number }[] = [];

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return coordinates;
};

// ─── Marker config per responder type ────────────────────────────────────────
const MARKER_CONFIG = {
  incident: {
    color: "#ef4444",
    emoji: "🔴",
    label: "Incident",
    bg: "#fef2f2",
    border: "#fecaca",
    text: "#991b1b",
  },
  user: {
    color: "#3b82f6",
    emoji: "👤",
    label: "Nearby User",
    bg: "#eff6ff",
    border: "#bfdbfe",
    text: "#1e40af",
  },
  volunteer: {
    color: "#22c55e",
    emoji: "🦺",
    label: "Volunteer",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    text: "#15803d",
  },
  contact: {
    color: "#a855f7",
    emoji: "📞",
    label: "Contact",
    bg: "#faf5ff",
    border: "#e9d5ff",
    text: "#7e22ce",
  },
  authority: {
    color: "#f59e0b",
    emoji: "🚔",
    label: "Authority",
    bg: "#fffbeb",
    border: "#fde68a",
    text: "#92400e",
  },
} as const;

type MarkerType = keyof typeof MARKER_CONFIG;

const PARTICIPANT_LABELS: Record<
  NonNullable<CaseSnapshot["participants"]>[number]["role"],
  string
> = {
  reporter: "Reporter",
  volunteer: "Volunteer",
  authority: "Authority",
};

// ─── Build markers array ──────────────────────────────────────────────────────
function buildMarkers(snapshot: CaseSnapshot["dispatchMapSnapshot"]) {
  if (!snapshot) return [];

  const markers: {
    id: string;
    title: string;
    coordinates: { latitude: number; longitude: number };
    tintColor: string;
    markerType: MarkerType;
    point: MapPoint;
  }[] = [
    {
      id: "incident",
      title: "📍 Incident",
      coordinates: {
        latitude: snapshot.incident.lat,
        longitude: snapshot.incident.lng,
      },
      tintColor: MARKER_CONFIG.incident.color,
      markerType: "incident",
      point: {
        lat: snapshot.incident.lat,
        lng: snapshot.incident.lng,
        name: "Incident",
      },
    },
    ...snapshot.nearbyUsers.map((p, i) => ({
      id: `user-${p.userId ?? i}`,
      title: p.name ?? "Nearby User",
      coordinates: { latitude: p.lat, longitude: p.lng },
      tintColor: MARKER_CONFIG.user.color,
      markerType: "user" as MarkerType,
      point: p,
    })),
    ...snapshot.nearbyVolunteers.map((p, i) => ({
      id: `vol-${p.userId ?? i}`,
      title: p.name ?? "Volunteer",
      coordinates: { latitude: p.lat, longitude: p.lng },
      tintColor: MARKER_CONFIG.volunteer.color,
      markerType: "volunteer" as MarkerType,
      point: p,
    })),
    ...snapshot.nearbyContacts.map((p, i) => ({
      id: `contact-${i}`,
      title: p.name ?? "Contact",
      coordinates: { latitude: p.lat, longitude: p.lng },
      tintColor: MARKER_CONFIG.contact.color,
      markerType: "contact" as MarkerType,
      point: p,
    })),
    ...snapshot.nearbyAuthorities.map((p, i) => ({
      id: `auth-${p.authorityProfileId ?? i}`,
      title: p.authorityType ?? "Authority",
      coordinates: { latitude: p.lat, longitude: p.lng },
      tintColor: MARKER_CONFIG.authority.color,
      markerType: "authority" as MarkerType,
      point: p,
    })),
  ];

  return markers;
}

// ─── Static map URL ───────────────────────────────────────────────────────────
function buildStaticMapUrl(
  snapshot: NonNullable<CaseSnapshot["dispatchMapSnapshot"]>,
  markers: ReturnType<typeof buildMarkers>,
  apiKey: string,
) {
  if (!apiKey || markers.length === 0) return "";
  const toColor = (c: string) => (c.startsWith("#") ? `0x${c.slice(1)}` : c);
  const params = markers.slice(0, 30).map((m) => {
    const col = toColor(m.tintColor);
    const labelByType: Record<MarkerType, string> = {
      incident: "I",
      user: "U",
      volunteer: "V",
      contact: "C",
      authority: "A",
    };
    return `markers=color:${encodeURIComponent(col)}|label:${labelByType[m.markerType]}|${m.coordinates.latitude},${m.coordinates.longitude}`;
  });
  const center = `${snapshot.incident.lat},${snapshot.incident.lng}`;
  return (
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?size=1200x760&scale=2&format=png&maptype=roadmap&zoom=14` +
    `&center=${encodeURIComponent(center)}` +
    `&${params.join("&")}` +
    `&key=${apiKey}`
  );
}

// ─── Responder Card ───────────────────────────────────────────────────────────
function ResponderCard({
  point,
  type,
  onCall,
}: {
  point: MapPoint;
  type: MarkerType;
  onCall?: (phone: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const cfg = MARKER_CONFIG[type];

  const toggle = () => {
    setExpanded((e) => {
      Animated.timing(anim, {
        toValue: e ? 0 : 1,
        duration: 220,
        useNativeDriver: false,
      }).start();
      return !e;
    });
  };

  return (
    <Pressable
      onPress={toggle}
      style={{ borderColor: cfg.border, backgroundColor: cfg.bg }}
      className="mt-2 overflow-hidden rounded-2xl border"
    >
      {/* Row */}
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View
          style={{ backgroundColor: cfg.color + "22", borderColor: cfg.border }}
          className="h-10 w-10 items-center justify-center rounded-full border"
        >
          <Text style={{ fontSize: 18 }}>{cfg.emoji}</Text>
        </View>
        <View className="flex-1">
          <Text style={{ color: cfg.text }} className="text-sm font-bold">
            {type === "authority"
              ? (point.authorityType ?? "Authority")
              : (point.name ?? cfg.label)}
          </Text>
          {!!point.phoneNumber && (
            <Text className="text-xs text-gray-500">{point.phoneNumber}</Text>
          )}
          <Text className="text-xs text-gray-400">
            {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
          </Text>
        </View>
        <Text style={{ color: cfg.color }} className="text-lg font-bold">
          {expanded ? "▲" : "▼"}
        </Text>
      </View>

      {/* Expanded */}
      {expanded && (
        <View
          style={{ borderTopColor: cfg.border }}
          className="border-t px-4 pb-4 pt-3"
        >
          {type !== "incident" && type !== "authority" && (
            <View className="mb-2 flex-row flex-wrap gap-2">
              <View
                style={{ backgroundColor: cfg.color + "18" }}
                className="rounded-full px-3 py-1"
              >
                <Text
                  style={{ color: cfg.color }}
                  className="text-xs font-semibold capitalize"
                >
                  {cfg.label}
                </Text>
              </View>
            </View>
          )}

          {!!point.phoneNumber && onCall && (
            <Pressable
              onPress={() => onCall(point.phoneNumber!)}
              style={{ backgroundColor: cfg.color }}
              className="mt-2 items-center rounded-xl px-4 py-2.5"
            >
              <Text className="text-xs font-bold text-white">
                📞 Call{" "}
                {type === "authority"
                  ? (point.authorityType ?? "Authority")
                  : (point.name ?? cfg.label)}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`,
              )
            }
            style={{ borderColor: cfg.border }}
            className="mt-2 items-center rounded-xl border px-4 py-2.5"
          >
            <Text style={{ color: cfg.text }} className="text-xs font-semibold">
              🗺 Open in Maps
            </Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

// ─── Map Section ──────────────────────────────────────────────────────────────
function CaseMap({
  snapshot,
  markers,
  userLocation,
  routeInfo,
}: {
  snapshot: NonNullable<CaseSnapshot["dispatchMapSnapshot"]>;
  markers: ReturnType<typeof buildMarkers>;
  userLocation?: { lat: number; lng: number } | null;
  routeInfo?: RouteInfo | null;
}) {
  const initialRegion = {
    latitude: snapshot.incident.lat,
    longitude: snapshot.incident.lng,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  const openMaps = () =>
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${snapshot.incident.lat},${snapshot.incident.lng}`,
    );

  if (Platform.OS === "android") {
    return (
      <View>
        <View
          style={{ height: MAP_HEIGHT }}
          className="overflow-hidden rounded-2xl border border-border"
        >
          <MapView
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            initialRegion={initialRegion}
            scrollEnabled
            zoomEnabled
            pitchEnabled
            rotateEnabled
            showsCompass
            showsBuildings
            showsScale
            toolbarEnabled={false}
            showsMyLocationButton={false}
          >
            {markers.map((marker) => (
              <Marker
                key={marker.id}
                coordinate={marker.coordinates}
                pinColor={marker.tintColor}
                title={marker.title}
              />
            ))}
            {userLocation && (
              <Marker
                coordinate={{
                  latitude: userLocation.lat,
                  longitude: userLocation.lng,
                }}
                pinColor="#0ea5e9"
                title="You"
              />
            )}
            {routeInfo?.path?.length ? (
              <Polyline
                coordinates={routeInfo.path}
                strokeColor="#0ea5e9"
                strokeWidth={4}
              />
            ) : null}
          </MapView>
        </View>
        <Pressable
          onPress={openMaps}
          className="mt-2 items-center rounded-xl bg-primary px-4 py-2.5"
        >
          <Text className="text-xs font-bold text-primary-foreground">
            🗺 Open Incident in Google Maps
          </Text>
        </Pressable>
      </View>
    );
  }

  const staticUrl = buildStaticMapUrl(snapshot, markers, GOOGLE_MAPS_API_KEY);
  if (staticUrl) {
    return (
      <View>
        <Image
          source={{ uri: staticUrl }}
          style={{ height: MAP_HEIGHT }}
          className="w-full rounded-2xl border border-border"
          resizeMode="cover"
        />
        <Pressable
          onPress={openMaps}
          className="mt-2 items-center rounded-xl bg-primary px-4 py-2.5"
        >
          <Text className="text-xs font-bold text-primary-foreground">
            🗺 Open Incident in Google Maps
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="rounded-2xl border border-border bg-card p-4">
      <Text className="text-xs text-muted-foreground">
        Map preview unavailable — {snapshot.incident.lat.toFixed(5)},{" "}
        {snapshot.incident.lng.toFixed(5)}
      </Text>
      <Pressable
        onPress={openMaps}
        className="mt-3 items-center rounded-xl bg-primary px-4 py-2.5"
      >
        <Text className="text-xs font-bold text-primary-foreground">
          Open in Google Maps
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Severity badge colour ────────────────────────────────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function CaseScreen() {
  const params = useLocalSearchParams<{
    emergencyId?: string;
    autoJoin?: string | string[];
  }>();
  const [snapshot, setSnapshot] = useState<CaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoDrawerVisible, setVideoDrawerVisible] = useState(false);
  const [shouldAutoJoinCall, setShouldAutoJoinCall] = useState(false);
  const [activeTab, setActiveTab] = useState<MarkerType | "all">("all");
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [selfEmergencyContacts, setSelfEmergencyContacts] = useState<
    SelfEmergencyContact[]
  >([]);
  const [selfAppContacts, setSelfAppContacts] = useState<AppContactUser[]>([]);
  const incidentLat =
    snapshot?.dispatchMapSnapshot?.incident?.lat ?? snapshot?.location?.lat;
  const incidentLng =
    snapshot?.dispatchMapSnapshot?.incident?.lng ?? snapshot?.location?.lng;

  const loadCase = useCallback(async () => {
    try {
      setLoading(true);
      const targetEmergencyId = params.emergencyId;
      if (!targetEmergencyId) {
        setSnapshot(null);
        return;
      }

      const response = await getEmergencyById(String(targetEmergencyId));
      const nextIncidentLat = response.emergency.location?.lat;
      const nextIncidentLng = response.emergency.location?.lng;

      const hydratedSnapshot: CaseSnapshot = {
        emergencyId: response.emergency.emergencyId,
        title: response.emergency.title,
        description: response.emergency.description,
        type: response.emergency.type,
        severity: response.emergency.severity,
        relationToVictim: response.emergency.relationToVictim,
        location:
          typeof nextIncidentLat === "number" &&
          typeof nextIncidentLng === "number"
            ? { lat: nextIncidentLat, lng: nextIncidentLng }
            : null,
        victimsCount: response.emergency.victimsCount,
        respondersConnected: response.emergency.respondersConnected,
        participants: response.emergency.participants ?? [],
        media: response.emergency.media ?? [],
        privileges: response.privileges,
        createdAt: response.emergency.createdAt,
        dispatchMapSnapshot:
          typeof nextIncidentLat === "number" &&
          typeof nextIncidentLng === "number"
            ? {
                incident: { lat: nextIncidentLat, lng: nextIncidentLng },
                nearbyUsers: [],
                nearbyVolunteers: [],
                nearbyContacts: [],
                nearbyAuthorities: [],
              }
            : null,
      };

      setSnapshot(hydratedSnapshot);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [params.emergencyId]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  useEffect(() => {
    let mounted = true;

    const loadSelfContacts = async () => {
      try {
        const [profileResponse, appUsersResponse] = await Promise.all([
          getPublicProfile(),
          getAppUsers(),
        ]);

        if (!mounted) return;

        const profile = profileResponse?.profile as
          | {
              contacts?: SelfEmergencyContact[];
              appContacts?: string[];
            }
          | undefined;

        const contacts = Array.isArray(profile?.contacts)
          ? profile.contacts
          : [];
        const appContactIds = Array.isArray(profile?.appContacts)
          ? profile.appContacts.map((id) => String(id))
          : [];
        const appUsers = Array.isArray(appUsersResponse?.users)
          ? appUsersResponse.users
          : [];

        const selectedAppContacts = appUsers
          .filter((user: any) => appContactIds.includes(String(user.userId)))
          .map((user: any) => ({
            userId: String(user.userId),
            name: String(user.name || "Unknown"),
            phoneNumber: String(user.phoneNumber || ""),
          }));

        setSelfEmergencyContacts(contacts);
        setSelfAppContacts(selectedAppContacts);
      } catch {
        if (!mounted) return;
        setSelfEmergencyContacts([]);
        setSelfAppContacts([]);
      }
    };

    void loadSelfContacts();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const rawAutoJoin = params.autoJoin;
    const autoJoinValue = Array.isArray(rawAutoJoin)
      ? rawAutoJoin[0]
      : rawAutoJoin;
    const shouldAutoJoin =
      autoJoinValue === "1" ||
      autoJoinValue === "true" ||
      autoJoinValue === "yes";

    if (shouldAutoJoin && !videoDrawerVisible) {
      setVideoDrawerVisible(true);
      setShouldAutoJoinCall(true);
    }
  }, [params.autoJoin, videoDrawerVisible]);

  useEffect(() => {
    let mounted = true;

    const syncResponderRoute = async () => {
      if (typeof incidentLat !== "number" || typeof incidentLng !== "number")
        return;

      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          return;
        }

        const current = await Location.getCurrentPositionAsync({});
        if (!mounted) return;

        const currentCoords = {
          lat: current.coords.latitude,
          lng: current.coords.longitude,
        };
        setUserLocation(currentCoords);

        if (!GOOGLE_MAPS_API_KEY) {
          return;
        }

        const directionsUrl =
          `https://maps.googleapis.com/maps/api/directions/json` +
          `?origin=${currentCoords.lat},${currentCoords.lng}` +
          `&destination=${incidentLat},${incidentLng}` +
          `&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;
        const matrixUrl =
          `https://maps.googleapis.com/maps/api/distancematrix/json` +
          `?origins=${currentCoords.lat},${currentCoords.lng}` +
          `&destinations=${incidentLat},${incidentLng}` +
          `&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;

        const [directionsRes, matrixRes] = await Promise.all([
          fetch(directionsUrl),
          fetch(matrixUrl),
        ]);

        const directionsData = await directionsRes.json();
        const matrixData = await matrixRes.json();

        const encodedPolyline = directionsData?.routes?.[0]?.overview_polyline
          ?.points as string | undefined;
        const matrixElement = matrixData?.rows?.[0]?.elements?.[0];

        if (!mounted) return;
        setRouteInfo({
          distanceText: matrixElement?.distance?.text,
          durationText: matrixElement?.duration?.text,
          path: encodedPolyline ? decodePolyline(encodedPolyline) : [],
        });
      } catch {
        if (!mounted) return;
        setRouteInfo(null);
      }
    };

    void syncResponderRoute();
    const timer = setInterval(() => {
      void syncResponderRoute();
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [incidentLat, incidentLng]);

  const handleCall = async (phone?: string) => {
    if (!phone) return;
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      Alert.alert("Call unavailable", phone);
    }
  };

  const handleStopCase = () => {
    Alert.alert(
      "Control-center required",
      "Camera/audio emergency stream can only be stopped when the control-center closes this case.",
    );
  };

  const mapSnapshot = snapshot?.dispatchMapSnapshot ?? null;
  const markers = buildMarkers(mapSnapshot);

  // Filtered responder lists
  const allUsers = mapSnapshot?.nearbyUsers ?? [];
  const allVolunteers = mapSnapshot?.nearbyVolunteers ?? [];
  const allContacts = mapSnapshot?.nearbyContacts ?? [];
  const allAuthorities = mapSnapshot?.nearbyAuthorities ?? [];

  const tabs: { key: MarkerType | "all"; label: string; count: number }[] = [
    {
      key: "all",
      label: "All",
      count:
        allUsers.length +
        allVolunteers.length +
        allContacts.length +
        allAuthorities.length,
    },
    { key: "user", label: "👤 Users", count: allUsers.length },
    { key: "volunteer", label: "🦺 Volunteers", count: allVolunteers.length },
    { key: "contact", label: "📞 Contacts", count: allContacts.length },
    { key: "authority", label: "🚔 Authority", count: allAuthorities.length },
  ];

  const emergencyId = snapshot?.emergencyId || params.emergencyId || "—";
  const sevColor = SEVERITY_COLORS[snapshot?.severity ?? ""] ?? "#6b7280";

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 130 }}
        nestedScrollEnabled
      >
        <View className="px-5 pt-16">
          {/* ── Header ── */}
          <Text className="text-xs font-bold uppercase tracking-[0.25em] text-primary">
            Active Case
          </Text>
          <Text className="mt-2 text-3xl font-black text-foreground">
            Ongoing Emergency
          </Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            Monitor responders, contact people nearby, and stop the case when
            resolved.
          </Text>

          {/* ── Case card ── */}
          <View className="mt-5 rounded-3xl border border-border bg-card p-5">
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Emergency ID
                </Text>
                <Text
                  className="mt-1 text-base font-bold text-foreground"
                  numberOfLines={1}
                >
                  {emergencyId}
                </Text>
              </View>
              {!!snapshot?.severity && (
                <View
                  style={{
                    backgroundColor: sevColor + "20",
                    borderColor: sevColor + "60",
                  }}
                  className="ml-3 rounded-full border px-3 py-1"
                >
                  <Text
                    style={{ color: sevColor }}
                    className="text-xs font-bold uppercase"
                  >
                    {snapshot.severity}
                  </Text>
                </View>
              )}
            </View>

            {!!snapshot?.title && (
              <Text className="mt-3 text-base font-bold text-foreground">
                {snapshot.title}
              </Text>
            )}
            {!!snapshot?.description && (
              <Text className="mt-1 text-sm text-muted-foreground">
                {snapshot.description}
              </Text>
            )}

            {!!snapshot?.media?.length && (
              <View className="mt-4">
                <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Incident Media
                </Text>
                <View className="mt-3 gap-3">
                  {snapshot.media.map((item, index) => (
                    <View
                      key={`${item.url}-${index}`}
                      className="overflow-hidden rounded-2xl border border-border bg-background"
                    >
                      {item.type === "image" && item.signedUrl ? (
                        <Image
                          source={{ uri: item.signedUrl }}
                          className="h-48 w-full"
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="flex-row items-center justify-between gap-3 p-4">
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-foreground">
                              {item.type === "video"
                                ? "Video evidence"
                                : "Audio evidence"}
                            </Text>
                            <Text
                              className="mt-1 text-xs text-muted-foreground"
                              numberOfLines={1}
                            >
                              {item.url}
                            </Text>
                          </View>
                          {!!item.signedUrl && (
                            <Pressable
                              onPress={() =>
                                void Linking.openURL(item.signedUrl!)
                              }
                              className="rounded-xl bg-primary px-3 py-2"
                            >
                              <Text className="text-xs font-semibold text-primary-foreground">
                                Open
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View className="mt-3 flex-row flex-wrap gap-2">
              {!!snapshot?.type && (
                <View className="rounded-full bg-primary/10 px-3 py-1">
                  <Text className="text-xs font-semibold capitalize text-primary">
                    {snapshot.type.replace("_", " ")}
                  </Text>
                </View>
              )}
              {!!snapshot?.relationToVictim && (
                <View className="rounded-full bg-muted px-3 py-1">
                  <Text className="text-xs font-semibold capitalize text-foreground">
                    {snapshot.relationToVictim}
                  </Text>
                </View>
              )}
            </View>

            {!!snapshot?.condition && (
              <View className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <Text className="text-xs font-semibold text-amber-800">
                  ⚠️ Condition: {snapshot.condition}
                </Text>
              </View>
            )}

            {!!snapshot?.location && (
              <Text className="mt-3 text-xs text-muted-foreground">
                📍 {snapshot.location.lat.toFixed(5)},{" "}
                {snapshot.location.lng.toFixed(5)}
              </Text>
            )}
            {!!snapshot?.createdAt && (
              <Text className="mt-1 text-xs text-muted-foreground">
                🕐 {new Date(snapshot.createdAt).toLocaleString()}
              </Text>
            )}
            {typeof snapshot?.respondersConnected === "number" && (
              <Text className="mt-1 text-xs text-muted-foreground">
                🧭 Responders connected: {snapshot.respondersConnected}
              </Text>
            )}

            {(routeInfo?.distanceText || routeInfo?.durationText) && (
              <View className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                <Text className="text-xs font-semibold text-sky-800">
                  Directions & ETA
                </Text>
                {!!routeInfo?.distanceText && (
                  <Text className="mt-1 text-xs text-sky-700">
                    Distance: {routeInfo.distanceText}
                  </Text>
                )}
                {!!routeInfo?.durationText && (
                  <Text className="mt-1 text-xs text-sky-700">
                    ETA: {routeInfo.durationText}
                  </Text>
                )}
              </View>
            )}

            <Pressable
              onPress={handleStopCase}
              className="mt-5 items-center rounded-2xl bg-red-600 px-4 py-4"
            >
              <Text className="text-base font-black text-white">
                🛑 Stop Ongoing Case
              </Text>
            </Pressable>

            {!!snapshot?.emergencyId && (
              <Pressable
                onPress={() => setVideoDrawerVisible(true)}
                className="mt-3 items-center rounded-2xl border border-primary bg-primary/10 px-4 py-4"
              >
                <Text className="text-base font-bold text-primary">
                  Open Emergency Video Call
                </Text>
              </Pressable>
            )}
          </View>

          {/* ── Dispatch Summary ── */}
          {snapshot?.dispatchSummary && (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Dispatch Summary
              </Text>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {[
                  {
                    label: "Users",
                    val: snapshot.dispatchSummary.nearbyUsers,
                    emoji: "👤",
                    color: MARKER_CONFIG.user.color,
                  },
                  {
                    label: "Volunteers",
                    val: snapshot.dispatchSummary.nearbyVolunteers,
                    emoji: "🦺",
                    color: MARKER_CONFIG.volunteer.color,
                  },
                  {
                    label: "Authorities",
                    val: snapshot.dispatchSummary.nearbyAuthorities,
                    emoji: "🚔",
                    color: MARKER_CONFIG.authority.color,
                  },
                  {
                    label: "Centers",
                    val: snapshot.dispatchSummary.controllerCenters,
                    emoji: "🏢",
                    color: "#6b7280",
                  },
                  {
                    label: "Contacts",
                    val: snapshot.dispatchSummary.contacts,
                    emoji: "📞",
                    color: MARKER_CONFIG.contact.color,
                  },
                ].map(({ label, val, emoji, color }) => (
                  <View
                    key={label}
                    style={{
                      borderColor: color + "40",
                      backgroundColor: color + "10",
                    }}
                    className="min-w-[90px] flex-1 items-center rounded-2xl border py-3"
                  >
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                    <Text style={{ color }} className="mt-1 text-lg font-black">
                      {val}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {snapshot?.privileges && (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Control Center Access
              </Text>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {[
                  ["Close case", snapshot.privileges.canCloseCase],
                  [
                    "Broadcast updates",
                    snapshot.privileges.canBroadcastUpdates,
                  ],
                  ["Edit case", snapshot.privileges.canEditCase],
                  ["View reporter", snapshot.privileges.canViewReporterDetails],
                ].map(([label, enabled]) => (
                  <View
                    key={String(label)}
                    className={`rounded-full px-3 py-1 ${enabled ? "bg-emerald-100" : "bg-muted"}`}
                  >
                    <Text
                      className={`text-xs font-semibold ${enabled ? "text-emerald-700" : "text-muted-foreground"}`}
                    >
                      {label}: {enabled ? "enabled" : "disabled"}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {snapshot?.participants?.length ? (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Participants
              </Text>
              <View className="mt-3 space-y-2">
                {snapshot.participants.map((participant) => (
                  <View
                    key={`${participant.userId}-${participant.role}`}
                    className="rounded-2xl border border-border bg-background p-4"
                  >
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="text-sm font-semibold text-foreground">
                        {PARTICIPANT_LABELS[participant.role]}
                      </Text>
                      {!!participant.status && (
                        <Text className="text-xs uppercase tracking-widest text-muted-foreground">
                          {participant.status}
                        </Text>
                      )}
                    </View>
                    <Text className="mt-1 text-xs text-muted-foreground">
                      User ID: {participant.userId}
                    </Text>
                    {!!participant.joinedAt && (
                      <Text className="mt-1 text-xs text-muted-foreground">
                        Joined:{" "}
                        {new Date(participant.joinedAt).toLocaleString()}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── Map + Responders ── */}
          {mapSnapshot && markers.length > 0 && (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Responder Map
              </Text>

              {/* Legend */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-3 -mx-1"
              >
                <View className="flex-row gap-2 px-1">
                  {Object.entries(MARKER_CONFIG).map(([key, cfg]) => (
                    <View
                      key={key}
                      style={{
                        backgroundColor: cfg.bg,
                        borderColor: cfg.border,
                      }}
                      className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
                    >
                      <Text style={{ fontSize: 13 }}>{cfg.emoji}</Text>
                      <Text
                        style={{ color: cfg.text }}
                        className="text-xs font-semibold"
                      >
                        {cfg.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>

              {/* Map */}
              <View className="mt-3">
                <CaseMap
                  snapshot={mapSnapshot}
                  markers={markers}
                  userLocation={userLocation}
                  routeInfo={routeInfo}
                />
              </View>

              {/* Tab filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-4 -mx-1"
              >
                <View className="flex-row gap-2 px-1">
                  {tabs
                    .filter((t) => t.count > 0 || t.key === "all")
                    .map((tab) => (
                      <Pressable
                        key={tab.key}
                        onPress={() => setActiveTab(tab.key)}
                        className={`rounded-full px-4 py-2 ${activeTab === tab.key ? "bg-primary" : "border border-border bg-background"}`}
                      >
                        <Text
                          className={`text-xs font-bold ${activeTab === tab.key ? "text-primary-foreground" : "text-foreground"}`}
                        >
                          {tab.label} {tab.count > 0 ? `(${tab.count})` : ""}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </ScrollView>

              {/* Responder cards */}
              <View className="mt-3">
                {(activeTab === "all" || activeTab === "user") &&
                  allUsers.map((p, i) => (
                    <ResponderCard
                      key={`u-${i}`}
                      point={p}
                      type="user"
                      onCall={handleCall}
                    />
                  ))}
                {(activeTab === "all" || activeTab === "volunteer") &&
                  allVolunteers.map((p, i) => (
                    <ResponderCard
                      key={`v-${i}`}
                      point={p}
                      type="volunteer"
                      onCall={handleCall}
                    />
                  ))}
                {(activeTab === "all" || activeTab === "contact") &&
                  allContacts.map((p, i) => (
                    <ResponderCard
                      key={`c-${i}`}
                      point={p}
                      type="contact"
                      onCall={handleCall}
                    />
                  ))}
                {(activeTab === "all" || activeTab === "authority") &&
                  allAuthorities.map((p, i) => (
                    <ResponderCard
                      key={`a-${i}`}
                      point={p}
                      type="authority"
                      onCall={handleCall}
                    />
                  ))}
                {allUsers.length +
                  allVolunteers.length +
                  allContacts.length +
                  allAuthorities.length ===
                  0 && (
                  <Text className="mt-3 text-sm text-muted-foreground">
                    No responders nearby yet.
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* ── Matched Person ── */}
          {snapshot?.matchedUser && (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Matched Victim
              </Text>
              <View className="mt-3 flex-row items-start gap-4">
                <Image
                  source={{
                    uri:
                      snapshot.matchedUser.profileImage ||
                      "https://cdn-icons-png.flaticon.com/512/149/149071.png",
                  }}
                  className="h-16 w-16 rounded-full"
                />
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    {snapshot.matchedUser.name}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {snapshot.matchedUser.phoneNumber}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {snapshot.matchedUser.age
                      ? `${snapshot.matchedUser.age} yrs`
                      : "Age N/A"}{" "}
                    · {snapshot.matchedUser.gender ?? "N/A"}
                  </Text>
                </View>
              </View>

              {/* Medical record */}
              {snapshot.matchedUser.medicalRecord && (
                <View className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-3">
                  <Text className="text-xs font-bold text-red-800">
                    🩺 Medical Info
                  </Text>
                  {!!snapshot.matchedUser.medicalRecord.bloodGroup && (
                    <Text className="mt-1 text-xs text-red-700">
                      Blood: {snapshot.matchedUser.medicalRecord.bloodGroup}
                    </Text>
                  )}
                  {!!snapshot.matchedUser.medicalRecord.allergies?.length && (
                    <Text className="mt-1 text-xs text-red-700">
                      Allergies:{" "}
                      {snapshot.matchedUser.medicalRecord.allergies.join(", ")}
                    </Text>
                  )}
                  {!!snapshot.matchedUser.medicalRecord.medications?.length && (
                    <Text className="mt-1 text-xs text-red-700">
                      Medications:{" "}
                      {snapshot.matchedUser.medicalRecord.medications.join(
                        ", ",
                      )}
                    </Text>
                  )}
                  {!!snapshot.matchedUser.medicalRecord.diseases?.length && (
                    <Text className="mt-1 text-xs text-red-700">
                      Conditions:{" "}
                      {snapshot.matchedUser.medicalRecord.diseases.join(", ")}
                    </Text>
                  )}
                  {!!snapshot.matchedUser.medicalRecord.notes && (
                    <Text className="mt-1 text-xs text-red-700">
                      Notes: {snapshot.matchedUser.medicalRecord.notes}
                    </Text>
                  )}
                </View>
              )}

              {!!snapshot.matchedUser.sosMessage && (
                <View className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <Text className="text-xs text-amber-800">
                    📢 SOS: {snapshot.matchedUser.sosMessage}
                  </Text>
                </View>
              )}

              <Pressable
                onPress={() =>
                  void handleCall(snapshot.matchedUser?.phoneNumber)
                }
                className="mt-4 items-center rounded-2xl border border-primary bg-primary/10 px-4 py-3"
              >
                <Text className="text-sm font-bold text-primary">
                  📞 Call Matched Person
                </Text>
              </Pressable>

              {!!snapshot.matchedUser.contacts?.length && (
                <View className="mt-4">
                  <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Emergency Contacts
                  </Text>
                  {snapshot.matchedUser.contacts.map((c, i) => (
                    <View
                      key={`${c.phoneNumber}-${i}`}
                      style={{
                        borderColor: MARKER_CONFIG.contact.border,
                        backgroundColor: MARKER_CONFIG.contact.bg,
                      }}
                      className="mt-2 rounded-2xl border p-4"
                    >
                      <View className="flex-row items-center gap-2">
                        <Text style={{ fontSize: 18 }}>📞</Text>
                        <View className="flex-1">
                          <Text className="text-sm font-bold text-foreground">
                            {c.name}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {c.phoneNumber}
                          </Text>
                          {!!c.relation && (
                            <Text className="text-xs text-muted-foreground capitalize">
                              {c.relation}
                              {c.isPrimary ? " · Primary" : ""}
                            </Text>
                          )}
                        </View>
                      </View>
                      <Pressable
                        onPress={() => void handleCall(c.phoneNumber)}
                        style={{ backgroundColor: MARKER_CONFIG.contact.color }}
                        className="mt-3 items-center rounded-xl px-4 py-2.5"
                      >
                        <Text className="text-xs font-bold text-white">
                          Call {c.name}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ── My Contacts ── */}
          {(selfEmergencyContacts.length > 0 || selfAppContacts.length > 0) && (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                My Contact Network
              </Text>

              {selfEmergencyContacts.length > 0 && (
                <View className="mt-3">
                  <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Emergency Contacts
                  </Text>
                  {selfEmergencyContacts.map((contact, index) => (
                    <View
                      key={`${contact.phoneNumber}-${index}`}
                      className="mt-2 rounded-2xl border border-border bg-background p-3"
                    >
                      <Text className="text-sm font-semibold text-foreground">
                        {contact.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {contact.phoneNumber}
                      </Text>
                      {!!contact.relation && (
                        <Text className="text-xs text-muted-foreground">
                          {contact.relation}
                        </Text>
                      )}
                      <Pressable
                        onPress={() => void handleCall(contact.phoneNumber)}
                        className="mt-2 items-center rounded-xl bg-primary px-3 py-2"
                      >
                        <Text className="text-xs font-semibold text-primary-foreground">
                          Call
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {selfAppContacts.length > 0 && (
                <View className="mt-4">
                  <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    App Contacts
                  </Text>
                  {selfAppContacts.map((contact) => (
                    <View
                      key={contact.userId}
                      className="mt-2 rounded-2xl border border-border bg-background p-3"
                    >
                      <Text className="text-sm font-semibold text-foreground">
                        {contact.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {contact.phoneNumber}
                      </Text>
                      <Pressable
                        onPress={() => void handleCall(contact.phoneNumber)}
                        className="mt-2 items-center rounded-xl bg-primary px-3 py-2"
                      >
                        <Text className="text-xs font-semibold text-primary-foreground">
                          Call
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ── Activity Feed ── */}
          {!!snapshot?.dispatchFeed?.length && (
            <View className="mt-4 rounded-3xl border border-border bg-card p-5">
              <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Live Feed
              </Text>
              {snapshot.dispatchFeed.slice(0, 12).map((item, i) => (
                <View key={`feed-${i}`} className="mt-3 flex-row gap-3">
                  <View className="mt-1 h-2 w-2 rounded-full bg-primary" />
                  <Text className="flex-1 text-sm text-muted-foreground">
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── No case ── */}
          {!snapshot && !loading && (
            <View className="mt-6 rounded-3xl border border-border bg-card p-5">
              <Text className="text-sm text-muted-foreground">
                No active case on this device right now.
              </Text>
              <Pressable
                onPress={() => router.replace("/(tabs)/emergency")}
                className="mt-4 items-center rounded-2xl bg-primary px-4 py-4"
              >
                <Text className="text-sm font-bold text-primary-foreground">
                  Go to Emergency
                </Text>
              </Pressable>
            </View>
          )}

          {loading && (
            <View className="mt-6 rounded-3xl border border-border bg-card p-5">
              <Text className="text-sm text-muted-foreground">
                Loading case details…
              </Text>
            </View>
          )}
        </View>

        <EmergencyVideoCallDrawer
          emergencyId={String(
            snapshot?.emergencyId || params.emergencyId || "",
          )}
          visible={videoDrawerVisible}
          autoJoin={shouldAutoJoinCall}
          onAutoJoinHandled={() => setShouldAutoJoinCall(false)}
          onClose={() => {
            setVideoDrawerVisible(false);
            setShouldAutoJoinCall(false);
          }}
        />
      </ScrollView>

      <EmergencyChatbotWidget
        emergencyId={String(snapshot?.emergencyId || params.emergencyId || "")}
        bottomOffset={24}
      />
    </View>
  );
}
