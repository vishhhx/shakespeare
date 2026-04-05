import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Alert, ScrollView, TextInput, ActivityIndicator, Image, Platform } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

import { AuthContext } from "../../context/authContext";
import { SocketContext } from "../../context/socketContext";
import {
  acceptEmergencyResponse,
  getNearbyOngoingEmergencies,
  getS3UploadUrl,
  initiateEmergency,
  processEmergencyStrangerPhoto,
} from "../../lib/api";
import FloatingVoiceEmergencyButton from "../../components/floating-voice-emergency-button";
import EmergencyChatbotWidget from "../../components/emergency-chatbot-widget";

const MAP_HEIGHT = 340;
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────
type MatchUser = {
  userId: string;
  name: string;
  phoneNumber: string;
  age?: number;
  gender?: "male" | "female" | "other";
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
};

type MatchSimilarity = {
  qdrantUsed?: boolean;
  reason?: string;
  collection?: string;
  matchedScore?: number;
  candidates?: string[];
};

type DispatchSummary = {
  nearbyUsers: number;
  nearbyVolunteers: number;
  nearbyAuthorities: number;
  controllerCenters: number;
  contacts: number;
};

type MapPoint = {
  lat: number;
  lng: number;
  userId?: string;
  authorityProfileId?: string;
  authorityType?: string;
  role?: string;
  name?: string;
  phoneNumber?: string;
  profileImage?: string | null;
};

type DispatchMapSnapshot = {
  incident: { lat: number; lng: number };
  nearbyUsers: MapPoint[];
  nearbyVolunteers: MapPoint[];
  nearbyContacts: MapPoint[];
  nearbyAuthorities: MapPoint[];
};

type DispatchUpdatePayload = {
  emergencyId: string;
  message?: string;
  summary?: DispatchSummary;
  mapSnapshot?: DispatchMapSnapshot;
  feed?: string[];
};

type OngoingEmergency = {
  emergencyId: string;
  title: string;
  description?: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "reported" | "verified" | "in_progress" | "resolved" | "closed";
  location?: { lat?: number; lng?: number; address?: string };
  respondersCount: number;
  createdAt?: string;
};

// ─── Marker colours ───────────────────────────────────────────────────────────
const MARKER_COLORS = {
  incident: "#dc2626",
  user: "#2563eb",
  volunteer: "#16a34a",
  contact: "#9333ea",
  authority: "#f59e0b",
} as const;

const ACTIVE_CASE_STORAGE_KEY = "activeEmergencyCase";

const toStaticMapColor = (color: string) =>
  color.startsWith("#") ? `0x${color.slice(1)}` : color;

// ─── Static map URL ───────────────────────────────────────────────────────────
function buildStaticMapUrl(
  snapshot: DispatchMapSnapshot,
  markers: { tintColor?: string; coordinates: { latitude: number; longitude: number } }[],
  apiKey: string,
): string {
  if (!apiKey || markers.length === 0) return "";
  const markerParams = markers.slice(0, 30).map((m) => {
    const color = toStaticMapColor(m.tintColor ?? "red");
    return `markers=color:${encodeURIComponent(color)}|${m.coordinates.latitude},${m.coordinates.longitude}`;
  });
  const center = `${snapshot.incident.lat},${snapshot.incident.lng}`;
  return (
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?size=1200x640&scale=2&format=png&maptype=roadmap&zoom=13` +
    `&center=${encodeURIComponent(center)}` +
    `&${markerParams.join("&")}` +
    `&key=${apiKey}`
  );
}

// ─── DispatchMap component ────────────────────────────────────────────────────
function DispatchMap({
  snapshot,
  markers,
}: {
  snapshot: DispatchMapSnapshot;
  markers: { id: string; title: string; coordinates: { latitude: number; longitude: number }; tintColor?: string }[];
}) {
  const initialRegion = {
    latitude: snapshot.incident.lat,
    longitude: snapshot.incident.lng,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  };

  const openInGoogleMaps = async () => {
    const { lat, lng } = snapshot.incident;
    if (Platform.OS === "android") {
      await Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}`);
      return;
    }

    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  }

  if (Platform.OS === "android") {
    return (
      <View className="mt-3 overflow-hidden rounded-xl border border-border" style={{ height: MAP_HEIGHT }}>
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
        </MapView>
        <Pressable onPress={openInGoogleMaps} className="mt-2 items-center rounded-lg bg-primary px-3 py-2">
          <Text className="text-xs font-semibold text-primary-foreground">Open in Google Maps</Text>
        </Pressable>
      </View>
    );
  }

  const staticUrl = buildStaticMapUrl(snapshot, markers, GOOGLE_MAPS_API_KEY);
  if (staticUrl) {
    return (
      <View className="mt-3">
        <Image
          source={{ uri: staticUrl }}
          className="w-full rounded-xl border border-border"
          style={{ height: MAP_HEIGHT }}
          resizeMode="cover"
        />
        <Pressable onPress={openInGoogleMaps} className="mt-2 items-center rounded-lg bg-primary px-3 py-2">
          <Text className="text-xs font-semibold text-primary-foreground">Open in Google Maps</Text>
        </Pressable>
      </View>
    );
  }

  // Last resort — text + deep-link
  return (
    <View className="mt-3 rounded-xl border border-border bg-card p-3">
      <Text className="text-xs text-muted-foreground">
        Map preview unavailable. Incident at {snapshot.incident.lat.toFixed(5)}, {snapshot.incident.lng.toFixed(5)}.
      </Text>
      <Pressable onPress={openInGoogleMaps} className="mt-3 items-center rounded-lg bg-primary px-3 py-2">
        <Text className="text-xs font-semibold text-primary-foreground">Open Incident in Google Maps</Text>
      </Pressable>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function EmergencyTab() {
  const router = useRouter();
  const { userDetails } = useContext(AuthContext);
  const { on, off, isConnected } = useContext(SocketContext);

  const [title, setTitle] = useState("Emergency Assistance Needed");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"medical" | "fire" | "crime" | "accident" | "missing_child" | "other">("medical");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("high");
  const [relationToVictim, setRelationToVictim] = useState<"self" | "family" | "bystander" | "authority">("self");
  const [isForSelf, setIsForSelf] = useState(true);
  const [victimsCount, setVictimsCount] = useState("1");
  const [condition, setCondition] = useState("");

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(null);
  const [strangerFaceKey, setStrangerFaceKey] = useState("");
  const [faceEmbeddingId, setFaceEmbeddingId] = useState("");
  const [matchedUser, setMatchedUser] = useState<MatchUser | null>(null);
  const [matchSimilarity, setMatchSimilarity] = useState<MatchSimilarity | null>(null);
  const [useMatchedUser, setUseMatchedUser] = useState(true);

  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [countdownActive, setCountdownActive] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [showTriggerActions, setShowTriggerActions] = useState(false);
  const [dispatchSummary, setDispatchSummary] = useState<DispatchSummary | null>(null);
  const [dispatchMapSnapshot, setDispatchMapSnapshot] = useState<DispatchMapSnapshot | null>(null);
  const [dispatchFeed, setDispatchFeed] = useState<string[]>([]);
  const [activeEmergencyId, setActiveEmergencyId] = useState("");
  const [nearbyOngoing, setNearbyOngoing] = useState<OngoingEmergency[]>([]);

  // ── Location on mount ──
  useEffect(() => {
    void (async () => {
      try {
        setIsLocating(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") { setError("Location permission is required to initiate emergency."); return; }
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        setError("Unable to fetch current location.");
      } finally {
        setIsLocating(false);
      }
    })();
  }, []);

  // ── Socket listeners ──
  useEffect(() => {
    const handleDispatch = (payload: DispatchUpdatePayload) => {
      if (!payload) return;
      if (payload.emergencyId) setActiveEmergencyId(payload.emergencyId);
      if (payload.summary) setDispatchSummary(payload.summary);
      if (payload.mapSnapshot) {
        setDispatchMapSnapshot({ ...payload.mapSnapshot, nearbyContacts: payload.mapSnapshot.nearbyContacts ?? [] });
      }
      if (Array.isArray(payload.feed)) setDispatchFeed((prev) => [...payload.feed!, ...prev].slice(0, 20));
      if (payload.message) setDispatchFeed((prev) => [payload.message!, ...prev].slice(0, 20));
    };
    const handleAlert = (payload: DispatchUpdatePayload) => {
      setDispatchFeed((prev) => [payload?.message ?? "Emergency alert received.", ...prev].slice(0, 20));
    };

    on("emergency-dispatch-update", handleDispatch);
    on("emergency-nearby-alert", handleAlert);
    on("emergency-contact-alert", handleAlert);
    on("emergency-authority-alert", handleAlert);
    on("emergency-controller-alert", handleAlert);
    return () => {
      off("emergency-dispatch-update", handleDispatch);
      off("emergency-nearby-alert", handleAlert);
      off("emergency-contact-alert", handleAlert);
      off("emergency-authority-alert", handleAlert);
      off("emergency-controller-alert", handleAlert);
    };
  }, [on, off]);

  // ── Map markers ──
  const mapMarkers = useMemo(() => {
    if (!dispatchMapSnapshot) return [];
    return [
      { id: "incident", title: "Incident", coordinates: { latitude: dispatchMapSnapshot.incident.lat, longitude: dispatchMapSnapshot.incident.lng }, tintColor: MARKER_COLORS.incident },
      ...dispatchMapSnapshot.nearbyUsers.map((p, i) => ({ id: `user-${p.userId ?? i}`, title: p.name ?? "Nearby User", coordinates: { latitude: p.lat, longitude: p.lng }, tintColor: MARKER_COLORS.user })),
      ...dispatchMapSnapshot.nearbyVolunteers.map((p, i) => ({ id: `volunteer-${p.userId ?? i}`, title: p.name ?? "Nearby Volunteer", coordinates: { latitude: p.lat, longitude: p.lng }, tintColor: MARKER_COLORS.volunteer })),
      ...dispatchMapSnapshot.nearbyContacts.map((p, i) => ({ id: `contact-${p.userId ?? i}`, title: p.name ?? "Nearby Contact", coordinates: { latitude: p.lat, longitude: p.lng }, tintColor: MARKER_COLORS.contact })),
      ...dispatchMapSnapshot.nearbyAuthorities.map((p, i) => ({ id: `authority-${p.authorityProfileId ?? i}`, title: p.authorityType ?? "Nearby Authority", coordinates: { latitude: p.lat, longitude: p.lng }, tintColor: MARKER_COLORS.authority })),
    ];
  }, [dispatchMapSnapshot]);

  const canStartCountdown = useMemo(
    () => !!title.trim() && !!location && (isForSelf || !!strangerFaceKey),
    [title, location, isForSelf, strangerFaceKey],
  );

  const handleCallPhoneNumber = async (phoneNumber?: string) => {
    if (!phoneNumber) return;
    try { await Linking.openURL(`tel:${phoneNumber}`); } catch { Alert.alert("Call unavailable", phoneNumber); }
  };

  useEffect(() => {
    let mounted = true;

    const syncNearbyOngoing = async () => {
      if (!location) return;
      try {
        const response = await getNearbyOngoingEmergencies({
          lat: location.lat,
          lng: location.lng,
          radiusKm: 10,
        });
        if (mounted) {
          setNearbyOngoing(response.emergencies ?? []);
        }
      } catch {
        // Keep existing list on transient failures.
      }
    };

    void syncNearbyOngoing();
    const timer = setInterval(() => {
      void syncNearbyOngoing();
    }, 20000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [location]);

  const handleAcceptFromNearby = async (emergencyId: string) => {
    try {
      const response = await acceptEmergencyResponse(emergencyId);
      Alert.alert("Accepted", response.trackingNotice || "Your location activity will be tracked for this emergency response.");
      router.push({ pathname: "/case", params: { emergencyId, autoJoin: "1" } });
    } catch (err: any) {
      Alert.alert("Unable to accept", err?.response?.data?.error || err?.message || "Failed to accept emergency response");
    }
  };

  // ── Photo capture ──
  const uploadAndProcessStrangerPhoto = async () => {
    try {
      setError(""); setProcessingPhoto(true);
      if (!userDetails?.userId) { setError("Session expired. Please login again."); return; }
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setError("Camera permission is required."); return; }
      const photo = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.85, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (photo.canceled || !photo.assets[0]?.uri) return;
      const uri = photo.assets[0].uri;
      setPhotoPreviewUri(uri);
      const key = `emergency/stranger/${String(userDetails.userId)}/${Date.now()}.jpg`;
      const { url } = await getS3UploadUrl({ key, contentType: "image/jpeg", bucket: "profile" });
      const blob = await (await fetch(uri)).blob();
      const upload = await fetch(url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!upload.ok) throw new Error("Failed to upload stranger image");
      setStrangerFaceKey(key);
      const processResponse = await processEmergencyStrangerPhoto(key);
      setFaceEmbeddingId(processResponse.embeddingId);
      setMatchedUser(processResponse.matchedUser);
      setMatchSimilarity(processResponse.similarity ?? null);
      setUseMatchedUser(true);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to process stranger photo");
      setStrangerFaceKey(""); setFaceEmbeddingId(""); setMatchedUser(null); setMatchSimilarity(null);
    } finally {
      setProcessingPhoto(false);
    }
  };

  const startCountdown = () => {
    setError("");
    if (!canStartCountdown) { setError("Fill required details and add victim photo for stranger case."); return; }
    setShowTriggerActions(true);
    setCountdown(30);
    setCountdownActive(true);
  };
  const cancelCountdown = () => {
    setCountdownActive(false);
    setShowTriggerActions(false);
    setCountdown(30);
  };

  // ── Emergency trigger ──
  const handleEmergencyTrigger = useCallback(async () => {
    try {
      setSubmitting(true); setCountdownActive(false);
      if (!location) { setError("Location is missing."); return; }

      const response = await initiateEmergency({
        title: title.trim(), description: description.trim(), type, severity,
        relationToVictim: isForSelf ? "self" : relationToVictim, isForSelf, location,
        victimsCount: Number(victimsCount) || 1, condition: condition.trim(),
        strangerFaceKey: isForSelf ? undefined : strangerFaceKey,
        faceEmbeddingId: isForSelf ? undefined : faceEmbeddingId,
        identifiedUserId: !isForSelf && useMatchedUser ? matchedUser?.userId : undefined,
      });

      setActiveEmergencyId(response.emergencyId ?? "");
      if (response.dispatch?.summary) setDispatchSummary(response.dispatch.summary);
      if (response.dispatch?.mapSnapshot) setDispatchMapSnapshot(response.dispatch.mapSnapshot);
      const feedItems = [
        "Emergency initiated and dispatch workflow started.",
        ...(response.dispatch?.timelineEvent ? [response.dispatch.timelineEvent] : []),
      ];
      setDispatchFeed(feedItems);

      await AsyncStorage.setItem(ACTIVE_CASE_STORAGE_KEY, JSON.stringify({
        emergencyId: response.emergencyId, title: title.trim(), description: description.trim(),
        type, severity, relationToVictim: isForSelf ? "self" : relationToVictim, isForSelf,
        location, condition: condition.trim(), matchedUser,
        dispatchSummary: response.dispatch?.summary ?? null,
        dispatchMapSnapshot: response.dispatch?.mapSnapshot ?? null,
        dispatchFeed: feedItems, createdAt: new Date().toISOString(),
      }));

      setCountdown(30); setCountdownActive(false); setDescription(""); setCondition("");
      if (!isForSelf) {
        setPhotoPreviewUri(null);
        setStrangerFaceKey(""); setFaceEmbeddingId(""); setMatchedUser(null); setMatchSimilarity(null);
      }
      setShowTriggerActions(false);

      if (response.emergencyId) {
        router.push({ pathname: "/case", params: { emergencyId: response.emergencyId } });
      }
      Alert.alert("Emergency Triggered", `Emergency created. ID: ${response.emergencyId}`);
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.emergencyId) {
        const existingEmergencyId = String(err.response.data.emergencyId);
        Alert.alert("Emergency Already Active", "You already have an ongoing emergency. Opening your active case.");
        router.replace({ pathname: "/case", params: { emergencyId: existingEmergencyId } });
      }
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to initiate emergency");
    } finally {
      setSubmitting(false);
    }
  }, [location, title, description, type, severity, relationToVictim, isForSelf, victimsCount, condition, strangerFaceKey, faceEmbeddingId, matchedUser, router, useMatchedUser]);

  // ── Countdown timer ──
  useEffect(() => {
    if (!countdownActive) return;
    if (countdown <= 0) { void handleEmergencyTrigger(); return; }
    const t = setTimeout(() => setCountdown((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [countdownActive, countdown, handleEmergencyTrigger]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-background">
      <View className="absolute left-0 right-0 top-12 z-20">
        <View className="border-b border-border bg-card/95 px-6 py-3">
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Emergency</Text>
          <Text className="mt-2 text-3xl font-black text-foreground">Initiate Emergency</Text>
          <Text className="mt-1 text-sm leading-6 text-muted-foreground">
            Fill details, identify victim (self/stranger), and confirm trigger after 30 seconds.
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 170, paddingBottom: 200 }} nestedScrollEnabled>
        <View className="px-6 pt-6">

        {/* Form card */}
        <View className="mt-6 rounded-3xl border border-border bg-card p-5">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Emergency Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="Enter short emergency title" className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground" />

          <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Description</Text>
          <TextInput value={description} onChangeText={setDescription} placeholder="Describe what happened" multiline numberOfLines={3} className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground" />

          <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Emergency Type</Text>
          <View className="flex-row flex-wrap gap-2">
            {(["medical", "fire", "crime", "accident", "missing_child", "other"] as const).map((v) => (
              <Pressable key={v} onPress={() => setType(v)} className={`rounded-full px-3 py-2 ${type === v ? "bg-primary" : "border border-border bg-background"}`}>
                <Text className={`text-xs font-semibold capitalize ${type === v ? "text-primary-foreground" : "text-foreground"}`}>{v.replace("_", " ")}</Text>
              </Pressable>
            ))}
          </View>

          <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Severity</Text>
          <View className="flex-row gap-2">
            {(["low", "medium", "high", "critical"] as const).map((v) => (
              <Pressable key={v} onPress={() => setSeverity(v)} className={`flex-1 rounded-xl px-3 py-3 ${severity === v ? "bg-primary" : "border border-border bg-background"}`}>
                <Text className={`text-center text-xs font-semibold capitalize ${severity === v ? "text-primary-foreground" : "text-foreground"}`}>{v}</Text>
              </Pressable>
            ))}
          </View>

          <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Emergency Is For</Text>
          <View className="flex-row gap-2">
            <Pressable onPress={() => { setIsForSelf(true); setRelationToVictim("self"); }} className={`flex-1 rounded-xl px-3 py-3 ${isForSelf ? "bg-primary" : "border border-border bg-background"}`}>
              <Text className={`text-center text-xs font-semibold ${isForSelf ? "text-primary-foreground" : "text-foreground"}`}>Myself</Text>
            </Pressable>
            <Pressable onPress={() => { setIsForSelf(false); setRelationToVictim("bystander"); }} className={`flex-1 rounded-xl px-3 py-3 ${!isForSelf ? "bg-primary" : "border border-border bg-background"}`}>
              <Text className={`text-center text-xs font-semibold ${!isForSelf ? "text-primary-foreground" : "text-foreground"}`}>Stranger / Other</Text>
            </Pressable>
          </View>

          {!isForSelf && (
            <>
              <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Relation To Victim</Text>
              <View className="flex-row gap-2">
                {(["family", "bystander", "authority"] as const).map((v) => (
                  <Pressable key={v} onPress={() => setRelationToVictim(v)} className={`flex-1 rounded-xl px-3 py-3 ${relationToVictim === v ? "bg-primary" : "border border-border bg-background"}`}>
                    <Text className={`text-center text-xs font-semibold capitalize ${relationToVictim === v ? "text-primary-foreground" : "text-foreground"}`}>{v}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => void uploadAndProcessStrangerPhoto()} disabled={processingPhoto} className="mt-4 items-center rounded-2xl border border-dashed border-primary bg-primary/5 px-4 py-4">
                <Text className="text-sm font-semibold text-primary">{processingPhoto ? "Processing face photo..." : "Capture Stranger Face Photo"}</Text>
              </Pressable>

              {photoPreviewUri && <Image source={{ uri: photoPreviewUri }} className="mt-3 h-44 w-full rounded-2xl" />}
              {!!faceEmbeddingId && <Text className="mt-2 text-xs text-muted-foreground">Embedding ID: {faceEmbeddingId}</Text>}

              {matchedUser && (
                <View className="mt-3 rounded-2xl border border-border bg-background p-4">
                  <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Matched Person</Text>
                  <Text className="mt-2 text-sm font-semibold text-foreground">{matchedUser.name}</Text>
                  <Text className="text-xs text-muted-foreground">{matchedUser.phoneNumber}</Text>
                  <Text className="text-xs text-muted-foreground">{matchedUser.age ? `${matchedUser.age} years` : "Age N/A"} · {matchedUser.gender ?? "Gender N/A"}</Text>
                  {typeof matchSimilarity?.matchedScore === "number" && (
                    <Text className="mt-1 text-xs text-muted-foreground">Similarity: {(matchSimilarity.matchedScore * 100).toFixed(1)}%</Text>
                  )}
                  {!!matchedUser.medicalRecord?.bloodGroup && <Text className="mt-1 text-xs text-muted-foreground">Blood Group: {matchedUser.medicalRecord.bloodGroup}</Text>}
                  {!!matchedUser.sosMessage && <Text className="mt-1 text-xs text-muted-foreground">SOS: {matchedUser.sosMessage}</Text>}

                  <View className="mt-3 flex-row gap-2">
                    <Pressable onPress={() => setUseMatchedUser(true)} className={`flex-1 rounded-xl px-3 py-3 ${useMatchedUser ? "bg-primary" : "border border-border bg-card"}`}>
                      <Text className={`text-center text-xs font-semibold ${useMatchedUser ? "text-primary-foreground" : "text-foreground"}`}>Use This Person</Text>
                    </Pressable>
                    <Pressable onPress={() => setUseMatchedUser(false)} className={`flex-1 rounded-xl px-3 py-3 ${!useMatchedUser ? "bg-primary" : "border border-border bg-card"}`}>
                      <Text className={`text-center text-xs font-semibold ${!useMatchedUser ? "text-primary-foreground" : "text-foreground"}`}>No Match</Text>
                    </Pressable>
                  </View>

                  <Pressable onPress={() => void handleCallPhoneNumber(matchedUser.phoneNumber)} className="mt-2 items-center rounded-xl border border-primary bg-primary/10 px-3 py-3">
                    <Text className="text-center text-xs font-semibold text-primary">Call Matched Person</Text>
                  </Pressable>

                  {!!matchedUser.contacts?.length && (
                    <View className="mt-3">
                      <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Emergency Contacts</Text>
                      {matchedUser.contacts.map((contact, index) => (
                        <View key={`${contact.phoneNumber}-${index}`} className="mt-2 rounded-xl border border-border bg-card p-3">
                          <Text className="text-sm font-semibold text-foreground">{contact.name}</Text>
                          <Text className="text-xs text-muted-foreground">{contact.phoneNumber}</Text>
                          {!!contact.relation && <Text className="text-xs text-muted-foreground">{contact.relation}</Text>}
                          <Pressable onPress={() => void handleCallPhoneNumber(contact.phoneNumber)} className="mt-2 items-center rounded-lg bg-primary px-3 py-2">
                            <Text className="text-xs font-semibold text-primary-foreground">Call Contact</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Victim Count</Text>
          <TextInput value={victimsCount} onChangeText={setVictimsCount} keyboardType="number-pad" placeholder="1" className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground" />

          <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Victim Condition</Text>
          <TextInput value={condition} onChangeText={setCondition} placeholder="e.g. Unconscious, bleeding" className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground" />

          <View className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
            <Text className="text-xs text-muted-foreground">
              {isLocating ? "Fetching current location…" : location ? `📍 ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : "Location unavailable"}
            </Text>
          </View>
        </View>

        {!!error && <Text className="mt-4 text-sm text-destructive">{error}</Text>}

        <View className="mt-6 rounded-2xl border border-border bg-card p-4">
          {showTriggerActions ? (
            <>
              <Text className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Emergency Trigger Armed</Text>
              <Text className="mt-1 text-center text-3xl font-black text-red-700">{countdown}s</Text>
              <View className="mt-3 flex-row gap-3">
                <Pressable
                  onPress={() => void handleEmergencyTrigger()}
                  disabled={!canStartCountdown || submitting || processingPhoto}
                  className={`flex-1 items-center rounded-2xl py-4 ${!canStartCountdown || submitting || processingPhoto ? "bg-muted" : "bg-red-600"}`}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text className="text-base font-black text-white">Trigger Now</Text>}
                </Pressable>
                <Pressable
                  onPress={cancelCountdown}
                  disabled={submitting}
                  className={`flex-1 items-center rounded-2xl border py-4 ${submitting ? "border-muted bg-muted" : "border-border bg-background"}`}
                >
                  <Text className="text-base font-black text-foreground">Stop</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              onPress={startCountdown}
              disabled={!canStartCountdown || submitting || processingPhoto}
              className={`items-center rounded-2xl py-4 ${!canStartCountdown || submitting || processingPhoto ? "bg-muted" : "bg-red-600"}`}
            >
              <Text className="text-base font-black text-white">Trigger Emergency</Text>
            </Pressable>
          )}
        </View>

        {/* Nearby ongoing emergencies (shown even if user rejects invite ping) */}
        <View className="mt-6 rounded-3xl border border-border bg-card p-5">
          <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Nearby Ongoing Emergencies</Text>
          {nearbyOngoing.length === 0 ? (
            <Text className="mt-2 text-xs text-muted-foreground">No nearby ongoing emergencies right now.</Text>
          ) : (
            nearbyOngoing.slice(0, 8).map((item) => (
              <View key={item.emergencyId} className="mt-3 rounded-2xl border border-border bg-background p-3">
                <Text className="text-sm font-semibold text-foreground">{item.title}</Text>
                {!!item.description && <Text className="mt-1 text-xs text-muted-foreground">{item.description}</Text>}
                <Text className="mt-1 text-xs text-muted-foreground">{item.severity.toUpperCase()} · {item.status}</Text>
                {!!item.location?.lat && !!item.location?.lng && (
                  <Text className="mt-1 text-xs text-muted-foreground">📍 {item.location.lat.toFixed(5)}, {item.location.lng.toFixed(5)}</Text>
                )}
                <Text className="mt-1 text-xs text-muted-foreground">Responders: {item.respondersCount}</Text>
                <View className="mt-3 flex-row gap-2">
                  <Pressable
                    onPress={() => router.push({ pathname: "/case", params: { emergencyId: item.emergencyId } })}
                    className="flex-1 items-center rounded-xl border border-border px-3 py-2"
                  >
                    <Text className="text-xs font-semibold text-foreground">View</Text>
                  </Pressable>
                  {(userDetails?.role === "public" || userDetails?.role === "volunteer") && (
                    <Pressable
                      onPress={() => void handleAcceptFromNearby(item.emergencyId)}
                      className="flex-1 items-center rounded-xl bg-primary px-3 py-2"
                    >
                      <Text className="text-xs font-semibold text-primary-foreground">Accept</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))
          )}
        </View>

        {/* Live dispatch */}
        <View className="mt-6 rounded-3xl border border-border bg-card p-5">
          <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Live Dispatch</Text>
          <View className="mt-2 flex-row items-center gap-2">
            <View className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
            <Text className="text-sm text-foreground">{isConnected ? "Connected" : "Disconnected"}</Text>
          </View>
          {!!activeEmergencyId && <Text className="mt-1 text-xs text-muted-foreground">Emergency ID: {activeEmergencyId}</Text>}

          {dispatchSummary && (
            <View className="mt-3 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs font-semibold text-foreground">Notified Recipients</Text>
              {[["Nearby users", dispatchSummary.nearbyUsers], ["Nearby volunteers", dispatchSummary.nearbyVolunteers], ["Nearby authorities", dispatchSummary.nearbyAuthorities], ["Controller centers", dispatchSummary.controllerCenters], ["Emergency contacts", dispatchSummary.contacts]].map(([label, val]) => (
                <Text key={String(label)} className="mt-1 text-xs text-muted-foreground">{label}: {val}</Text>
              ))}
            </View>
          )}

          {dispatchMapSnapshot && mapMarkers.length > 0 && (
            <View className="mt-3 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs font-semibold text-foreground">Responder Map</Text>
              <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
                {[{ label: "Incident", color: MARKER_COLORS.incident }, { label: "Users", color: MARKER_COLORS.user }, { label: "Volunteers", color: MARKER_COLORS.volunteer }, { label: "Contacts", color: MARKER_COLORS.contact }, { label: "Authorities", color: MARKER_COLORS.authority }].map(({ label, color }) => (
                  <View key={label} className="flex-row items-center gap-1">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                    <Text className="text-xs text-muted-foreground">{label}</Text>
                  </View>
                ))}
              </View>
              <DispatchMap snapshot={dispatchMapSnapshot} markers={mapMarkers} />

              <Text className="mt-4 text-xs text-muted-foreground">Public nearby: {dispatchMapSnapshot.nearbyUsers.length}</Text>
              {dispatchMapSnapshot.nearbyUsers.map((p, i) => (
                <View key={`pu-${i}`} className="mt-2 rounded-xl border border-border bg-card p-3">
                  <Text className="text-xs font-semibold text-foreground">{p.name ?? "User"}</Text>
                  {!!p.phoneNumber && <Text className="text-xs text-muted-foreground">{p.phoneNumber}</Text>}
                  <Text className="text-xs text-muted-foreground">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Text>
                </View>
              ))}

              <Text className="mt-2 text-xs text-muted-foreground">Volunteers nearby: {dispatchMapSnapshot.nearbyVolunteers.length}</Text>
              {dispatchMapSnapshot.nearbyVolunteers.map((p, i) => (
                <View key={`pv-${i}`} className="mt-2 rounded-xl border border-border bg-card p-3">
                  <Text className="text-xs font-semibold text-foreground">{p.name ?? "Volunteer"}</Text>
                  {!!p.phoneNumber && <Text className="text-xs text-muted-foreground">{p.phoneNumber}</Text>}
                  <Text className="text-xs text-muted-foreground">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Text>
                </View>
              ))}

              <Text className="mt-2 text-xs text-muted-foreground">Contacts nearby: {dispatchMapSnapshot.nearbyContacts.length}</Text>
              {dispatchMapSnapshot.nearbyContacts.map((p, i) => (
                <View key={`pc-${i}`} className="mt-2 rounded-xl border border-border bg-card p-3">
                  <Text className="text-xs font-semibold text-foreground">{p.name ?? "Contact"}</Text>
                  {!!p.phoneNumber && <Text className="text-xs text-muted-foreground">{p.phoneNumber}</Text>}
                  <Text className="text-xs text-muted-foreground">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Text>
                  {!!p.phoneNumber && (
                    <Pressable onPress={() => void handleCallPhoneNumber(p.phoneNumber)} className="mt-2 items-center rounded-lg bg-primary px-3 py-2">
                      <Text className="text-xs font-semibold text-primary-foreground">Call</Text>
                    </Pressable>
                  )}
                </View>
              ))}

              <Text className="mt-2 text-xs text-muted-foreground">Authorities nearby: {dispatchMapSnapshot.nearbyAuthorities.length}</Text>
              {dispatchMapSnapshot.nearbyAuthorities.map((p, i) => (
                <Text key={`pa-${i}`} className="mt-1 text-xs text-muted-foreground">{p.authorityType ?? "authority"}: {p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Text>
              ))}
            </View>
          )}

          <View className="mt-3 rounded-2xl border border-border bg-background p-4">
            <Text className="text-xs font-semibold text-foreground">Live Activity Feed</Text>
            {dispatchFeed.length === 0 ? (
              <Text className="mt-2 text-xs text-muted-foreground">No dispatch updates yet.</Text>
            ) : (
              dispatchFeed.slice(0, 8).map((item, i) => (
                <Text key={`feed-${i}`} className="mt-2 text-xs text-muted-foreground">{i + 1}. {item}</Text>
              ))
            )}
          </View>
        </View>
        </View>
      </ScrollView>

      <FloatingVoiceEmergencyButton
        onEmergencyCreated={({ emergencyId, analysis }) => {
          setActiveEmergencyId(emergencyId);
          const summaryLine = analysis?.analysis?.severity
            ? `Voice AI severity: ${analysis.analysis.severity}`
            : "Voice AI emergency created";
          const transcriptLine = analysis?.transcribedText
            ? `Transcript: ${analysis.transcribedText}`
            : "Transcript unavailable";
          setDispatchFeed((prev) => [summaryLine, transcriptLine, ...prev].slice(0, 20));
        }}
      />
      <EmergencyChatbotWidget
        emergencyId={activeEmergencyId || undefined}
        side="right"
        bottomOffset={212}
        horizontalOffset={18}
      />
    </View>
  );
}