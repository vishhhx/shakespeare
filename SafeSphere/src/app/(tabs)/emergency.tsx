import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Alert,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
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

type IncidentAttachment = {
  key: string;
  type: "image" | "video";
  previewUri: string;
  contentType: string;
  name: string;
  uploadedAt: string;
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
  markers: {
    tintColor?: string;
    coordinates: { latitude: number; longitude: number };
  }[],
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
  markers: {
    id: string;
    title: string;
    coordinates: { latitude: number; longitude: number };
    tintColor?: string;
  }[];
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

    await Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    );
  };

  if (Platform.OS === "android") {
    return (
      <View
        className="mt-3 overflow-hidden rounded-xl border border-border"
        style={{ height: MAP_HEIGHT }}
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
        </MapView>
        <Pressable
          onPress={openInGoogleMaps}
          className="mt-2 items-center rounded-lg bg-primary px-3 py-2"
        >
          <Text className="text-xs font-semibold text-primary-foreground">
            Open in Google Maps
          </Text>
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
        <Pressable
          onPress={openInGoogleMaps}
          className="mt-2 items-center rounded-lg bg-primary px-3 py-2"
        >
          <Text className="text-xs font-semibold text-primary-foreground">
            Open in Google Maps
          </Text>
        </Pressable>
      </View>
    );
  }

  // Last resort — text + deep-link
  return (
    <View className="mt-3 rounded-xl border border-border bg-card p-3">
      <Text className="text-xs text-muted-foreground">
        Map preview unavailable. Incident at {snapshot.incident.lat.toFixed(5)},{" "}
        {snapshot.incident.lng.toFixed(5)}.
      </Text>
      <Pressable
        onPress={openInGoogleMaps}
        className="mt-3 items-center rounded-lg bg-primary px-3 py-2"
      >
        <Text className="text-xs font-semibold text-primary-foreground">
          Open Incident in Google Maps
        </Text>
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
  const [type, setType] = useState<
    "medical" | "fire" | "crime" | "accident" | "missing_child" | "other"
  >("medical");
  const [severity, setSeverity] = useState<
    "low" | "medium" | "high" | "critical"
  >("high");
  const [relationToVictim, setRelationToVictim] = useState<
    "self" | "family" | "bystander" | "authority"
  >("self");
  const [isForSelf, setIsForSelf] = useState(true);
  const [victimsCount, setVictimsCount] = useState("1");
  const [condition, setCondition] = useState("");

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [isLocating, setIsLocating] = useState(false);

  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(null);
  const [strangerFaceKey, setStrangerFaceKey] = useState("");
  const [faceEmbeddingId, setFaceEmbeddingId] = useState("");
  const [matchedUser, setMatchedUser] = useState<MatchUser | null>(null);
  const [matchSimilarity, setMatchSimilarity] =
    useState<MatchSimilarity | null>(null);
  const [useMatchedUser, setUseMatchedUser] = useState(true);

  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [countdownActive, setCountdownActive] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [showTriggerActions, setShowTriggerActions] = useState(false);
  const [dispatchSummary, setDispatchSummary] =
    useState<DispatchSummary | null>(null);
  const [dispatchMapSnapshot, setDispatchMapSnapshot] =
    useState<DispatchMapSnapshot | null>(null);
  const [dispatchFeed, setDispatchFeed] = useState<string[]>([]);
  const [incidentAttachments, setIncidentAttachments] = useState<
    IncidentAttachment[]
  >([]);
  const [activeEmergencyId, setActiveEmergencyId] = useState("");
  const [nearbyOngoing, setNearbyOngoing] = useState<OngoingEmergency[]>([]);

  // ── Location on mount ──
  useEffect(() => {
    void (async () => {
      try {
        setIsLocating(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setError("Location permission is required to initiate emergency.");
          return;
        }
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
        setDispatchMapSnapshot({
          ...payload.mapSnapshot,
          nearbyContacts: payload.mapSnapshot.nearbyContacts ?? [],
        });
      }
      if (Array.isArray(payload.feed))
        setDispatchFeed((prev) => [...payload.feed!, ...prev].slice(0, 20));
      if (payload.message)
        setDispatchFeed((prev) => [payload.message!, ...prev].slice(0, 20));
    };
    const handleAlert = (payload: DispatchUpdatePayload) => {
      setDispatchFeed((prev) =>
        [payload?.message ?? "Emergency alert received.", ...prev].slice(0, 20),
      );
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
      {
        id: "incident",
        title: "Incident",
        coordinates: {
          latitude: dispatchMapSnapshot.incident.lat,
          longitude: dispatchMapSnapshot.incident.lng,
        },
        tintColor: MARKER_COLORS.incident,
      },
      ...dispatchMapSnapshot.nearbyUsers.map((p, i) => ({
        id: `user-${p.userId ?? i}`,
        title: p.name ?? "Nearby User",
        coordinates: { latitude: p.lat, longitude: p.lng },
        tintColor: MARKER_COLORS.user,
      })),
      ...dispatchMapSnapshot.nearbyVolunteers.map((p, i) => ({
        id: `volunteer-${p.userId ?? i}`,
        title: p.name ?? "Nearby Volunteer",
        coordinates: { latitude: p.lat, longitude: p.lng },
        tintColor: MARKER_COLORS.volunteer,
      })),
      ...dispatchMapSnapshot.nearbyContacts.map((p, i) => ({
        id: `contact-${p.userId ?? i}`,
        title: p.name ?? "Nearby Contact",
        coordinates: { latitude: p.lat, longitude: p.lng },
        tintColor: MARKER_COLORS.contact,
      })),
      ...dispatchMapSnapshot.nearbyAuthorities.map((p, i) => ({
        id: `authority-${p.authorityProfileId ?? i}`,
        title: p.authorityType ?? "Nearby Authority",
        coordinates: { latitude: p.lat, longitude: p.lng },
        tintColor: MARKER_COLORS.authority,
      })),
    ];
  }, [dispatchMapSnapshot]);

  const canStartCountdown = useMemo(
    () => !!title.trim() && !!location && (isForSelf || !!strangerFaceKey),
    [title, location, isForSelf, strangerFaceKey],
  );

  const handleCallPhoneNumber = async (phoneNumber?: string) => {
    if (!phoneNumber) return;
    try {
      await Linking.openURL(`tel:${phoneNumber}`);
    } catch {
      Alert.alert("Call unavailable", phoneNumber);
    }
  };

  const uploadIncidentMedia = async (mediaType: "image" | "video") => {
    try {
      setError("");
      if (!userDetails?.userId) {
        setError("Session expired. Please login again.");
        return;
      }

      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Media library permission is required.");
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          mediaType === "image"
            ? ImagePicker.MediaTypeOptions.Images
            : ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: mediaType === "image",
        quality: 0.85,
      });

      if (pickerResult.canceled || !pickerResult.assets[0]?.uri) {
        return;
      }

      const asset = pickerResult.assets[0];
      const previewUri = asset.uri;
      const contentType =
        asset.mimeType || (mediaType === "image" ? "image/jpeg" : "video/mp4");
      const extension =
        contentType.split("/")[1]?.split(";")[0] ||
        (mediaType === "image" ? "jpg" : "mp4");
      const key = `emergency/media/${String(userDetails.userId)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

      const { url } = await getS3UploadUrl({
        key,
        contentType,
        bucket: "profile",
      });
      const blob = await (await fetch(previewUri)).blob();
      const upload = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
      });

      if (!upload.ok) {
        throw new Error(`Failed to upload ${mediaType}`);
      }

      setIncidentAttachments((prev) => [
        ...prev,
        {
          key,
          type: mediaType,
          previewUri,
          contentType,
          name: asset.fileName || `${mediaType}.${extension}`,
          uploadedAt: new Date().toISOString(),
        },
      ]);
    } catch (uploadErr: any) {
      setError(
        uploadErr?.response?.data?.error ||
          uploadErr?.message ||
          `Failed to upload ${mediaType}`,
      );
    }
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
      Alert.alert(
        "Accepted",
        response.trackingNotice ||
          "Your location activity will be tracked for this emergency response.",
      );
      router.push({
        pathname: "/case",
        params: { emergencyId, autoJoin: "1" },
      });
    } catch (err: any) {
      Alert.alert(
        "Unable to accept",
        err?.response?.data?.error ||
          err?.message ||
          "Failed to accept emergency response",
      );
    }
  };

  // ── Photo capture ──
  const uploadAndProcessStrangerPhoto = async () => {
    try {
      setError("");
      setProcessingPhoto(true);
      if (!userDetails?.userId) {
        setError("Session expired. Please login again.");
        return;
      }
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError("Camera permission is required.");
        return;
      }
      const photo = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.85,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
      if (photo.canceled || !photo.assets[0]?.uri) return;
      const uri = photo.assets[0].uri;
      setPhotoPreviewUri(uri);
      const key = `emergency/stranger/${String(userDetails.userId)}/${Date.now()}.jpg`;
      const { url } = await getS3UploadUrl({
        key,
        contentType: "image/jpeg",
        bucket: "profile",
      });
      const blob = await (await fetch(uri)).blob();
      const upload = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!upload.ok) throw new Error("Failed to upload stranger image");
      setStrangerFaceKey(key);
      const processResponse = await processEmergencyStrangerPhoto(key);
      setFaceEmbeddingId(processResponse.embeddingId);
      setMatchedUser(processResponse.matchedUser);
      setMatchSimilarity(processResponse.similarity ?? null);
      setUseMatchedUser(true);
    } catch (err: any) {
      setError(
        err?.response?.data?.error ??
          err?.message ??
          "Failed to process stranger photo",
      );
      setStrangerFaceKey("");
      setFaceEmbeddingId("");
      setMatchedUser(null);
      setMatchSimilarity(null);
    } finally {
      setProcessingPhoto(false);
    }
  };

  const startCountdown = () => {
    setError("");
    if (!canStartCountdown) {
      setError("Fill required details and add victim photo for stranger case.");
      return;
    }
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
      setSubmitting(true);
      setCountdownActive(false);
      if (!location) {
        setError("Location is missing.");
        return;
      }

      const response = await initiateEmergency({
        title: title.trim(),
        description: description.trim(),
        type,
        severity,
        relationToVictim: isForSelf ? "self" : relationToVictim,
        isForSelf,
        location,
        victimsCount: Number(victimsCount) || 1,
        condition: condition.trim(),
        strangerFaceKey: isForSelf ? undefined : strangerFaceKey,
        faceEmbeddingId: isForSelf ? undefined : faceEmbeddingId,
        identifiedUserId:
          !isForSelf && useMatchedUser ? matchedUser?.userId : undefined,
        incidentMedia: incidentAttachments.map((item) => ({
          key: item.key,
          type: item.type,
        })),
      });

      setActiveEmergencyId(response.emergencyId ?? "");
      if (response.dispatch?.summary)
        setDispatchSummary(response.dispatch.summary);
      if (response.dispatch?.mapSnapshot)
        setDispatchMapSnapshot(response.dispatch.mapSnapshot);
      const feedItems = [
        "Emergency initiated and dispatch workflow started.",
        ...(response.dispatch?.timelineEvent
          ? [response.dispatch.timelineEvent]
          : []),
      ];
      setDispatchFeed(feedItems);

      await AsyncStorage.setItem(
        ACTIVE_CASE_STORAGE_KEY,
        JSON.stringify({
          emergencyId: response.emergencyId,
          title: title.trim(),
          description: description.trim(),
          type,
          severity,
          relationToVictim: isForSelf ? "self" : relationToVictim,
          isForSelf,
          location,
          condition: condition.trim(),
          matchedUser,
          incidentMedia: incidentAttachments,
          dispatchSummary: response.dispatch?.summary ?? null,
          dispatchMapSnapshot: response.dispatch?.mapSnapshot ?? null,
          dispatchFeed: feedItems,
          createdAt: new Date().toISOString(),
        }),
      );

      setCountdown(30);
      setCountdownActive(false);
      setDescription("");
      setCondition("");
      if (!isForSelf) {
        setPhotoPreviewUri(null);
        setStrangerFaceKey("");
        setFaceEmbeddingId("");
        setMatchedUser(null);
        setMatchSimilarity(null);
      }
      setIncidentAttachments([]);
      setShowTriggerActions(false);

      if (response.emergencyId) {
        router.push({
          pathname: "/case",
          params: { emergencyId: response.emergencyId },
        });
      }
      Alert.alert(
        "Emergency Triggered",
        `Emergency created. ID: ${response.emergencyId}`,
      );
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.emergencyId) {
        const existingEmergencyId = String(err.response.data.emergencyId);
        Alert.alert(
          "Emergency Already Active",
          "You already have an ongoing emergency. Opening your active case.",
        );
        router.replace({
          pathname: "/case",
          params: { emergencyId: existingEmergencyId },
        });
      }
      setError(
        err?.response?.data?.error ??
          err?.message ??
          "Failed to initiate emergency",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    location,
    title,
    description,
    type,
    severity,
    relationToVictim,
    isForSelf,
    victimsCount,
    condition,
    strangerFaceKey,
    faceEmbeddingId,
    matchedUser,
    router,
    useMatchedUser,
    incidentAttachments,
  ]);

  // ── Countdown timer ──
  useEffect(() => {
    if (!countdownActive) return;
    if (countdown <= 0) {
      void handleEmergencyTrigger();
      return;
    }
    const t = setTimeout(() => setCountdown((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [countdownActive, countdown, handleEmergencyTrigger]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-background">
      {/* Compact header */}
      <View className="border-b border-border bg-background px-5 pb-4 pt-14">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-2xl font-bold text-foreground">
              Emergency assistance
            </Text>
            <Text className="mt-1 text-sm leading-5 text-muted-foreground">
              Tell us what is happening and we’ll get help to you.
            </Text>
          </View>
          <View
            className={`rounded-full px-3 py-1.5 ${isConnected ? "bg-green-500/10" : "bg-red-500/10"}`}
          >
            <View className="flex-row items-center gap-1.5">
              <View
                className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
              />
              <Text
                className={`text-xs font-semibold ${isConnected ? "text-green-700" : "text-red-700"}`}
              >
                {isConnected ? "Ready" : "Offline"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 170 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View className="px-5 pt-5">
          {/* What happened */}
          <View>
            <Text className="text-base font-bold text-foreground">
              What happened?
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Choose the situation that best matches.
            </Text>

            <View className="mt-3 flex-row flex-wrap gap-2">
              {(
                [
                  ["medical", "Medical"],
                  ["accident", "Accident"],
                  ["fire", "Fire"],
                  ["crime", "Crime"],
                  ["missing_child", "Missing child"],
                  ["other", "Other"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => setType(value)}
                  className={`rounded-xl px-4 py-3 ${
                    type === value
                      ? "bg-primary"
                      : "border border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${type === value ? "text-primary-foreground" : "text-foreground"}`}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Severity */}
          <View className="mt-7">
            <Text className="text-base font-bold text-foreground">
              How serious is it?
            </Text>
            <View className="mt-3 flex-row overflow-hidden rounded-xl border border-border bg-card">
              {(["low", "medium", "high", "critical"] as const).map(
                (value, index) => (
                  <Pressable
                    key={value}
                    onPress={() => setSeverity(value)}
                    className={`flex-1 px-2 py-3 ${index > 0 ? "border-l border-border" : ""} ${severity === value ? "bg-foreground" : "bg-card"}`}
                  >
                    <Text
                      className={`text-center text-xs font-bold capitalize ${severity === value ? "text-background" : "text-foreground"}`}
                    >
                      {value}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>
          </View>

          {/* Who needs help */}
          <View className="mt-7">
            <Text className="text-base font-bold text-foreground">
              Who needs help?
            </Text>
            <View className="mt-3 flex-row gap-3">
              <Pressable
                onPress={() => {
                  setIsForSelf(true);
                  setRelationToVictim("self");
                }}
                className={`flex-1 rounded-xl border px-4 py-4 ${isForSelf ? "border-primary bg-primary/10" : "border-border bg-card"}`}
              >
                <Text
                  className={`text-sm font-bold ${isForSelf ? "text-primary" : "text-foreground"}`}
                >
                  Me
                </Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  I need assistance
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsForSelf(false);
                  setRelationToVictim("bystander");
                }}
                className={`flex-1 rounded-xl border px-4 py-4 ${!isForSelf ? "border-primary bg-primary/10" : "border-border bg-card"}`}
              >
                <Text
                  className={`text-sm font-bold ${!isForSelf ? "text-primary" : "text-foreground"}`}
                >
                  Someone else
                </Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  I’m helping another person
                </Text>
              </Pressable>
            </View>
          </View>

          {!isForSelf && (
            <View className="mt-4 rounded-2xl border border-border bg-card p-4">
              <Text className="text-sm font-bold text-foreground">
                Your relationship
              </Text>
              <View className="mt-3 flex-row gap-2">
                {(["family", "bystander", "authority"] as const).map(
                  (value) => (
                    <Pressable
                      key={value}
                      onPress={() => setRelationToVictim(value)}
                      className={`flex-1 rounded-lg px-3 py-2.5 ${relationToVictim === value ? "bg-primary" : "bg-background border border-border"}`}
                    >
                      <Text
                        className={`text-center text-xs font-semibold capitalize ${relationToVictim === value ? "text-primary-foreground" : "text-foreground"}`}
                      >
                        {value}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>

              <Pressable
                onPress={() => void uploadAndProcessStrangerPhoto()}
                disabled={processingPhoto}
                className="mt-4 flex-row items-center justify-between rounded-xl border border-dashed border-primary/50 bg-primary/5 px-4 py-3.5"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-semibold text-foreground">
                    Identify the person
                  </Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground">
                    Capture a face photo if identification is needed.
                  </Text>
                </View>
                <Text className="text-xs font-bold text-primary">
                  {processingPhoto ? "Processing…" : "Capture"}
                </Text>
              </Pressable>

              {photoPreviewUri && (
                <Image
                  source={{ uri: photoPreviewUri }}
                  className="mt-3 h-48 w-full rounded-xl"
                />
              )}
              {!!faceEmbeddingId && (
                <Text className="mt-2 text-xs text-muted-foreground">
                  Face processed successfully.
                </Text>
              )}

              {matchedUser && (
                <View className="mt-4 border-t border-border pt-4">
                  <Text className="text-xs font-semibold text-muted-foreground">
                    MATCH FOUND
                  </Text>
                  <View className="mt-2 flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="text-base font-bold text-foreground">
                        {matchedUser.name}
                      </Text>
                      <Text className="mt-0.5 text-xs text-muted-foreground">
                        {matchedUser.phoneNumber}
                      </Text>
                      <Text className="mt-0.5 text-xs text-muted-foreground">
                        {matchedUser.age
                          ? `${matchedUser.age} years`
                          : "Age N/A"}{" "}
                        · {matchedUser.gender ?? "Gender N/A"}
                      </Text>
                    </View>
                    {typeof matchSimilarity?.matchedScore === "number" && (
                      <View className="rounded-lg bg-green-500/10 px-2.5 py-1.5">
                        <Text className="text-xs font-bold text-green-700">
                          {(matchSimilarity.matchedScore * 100).toFixed(0)}%
                          match
                        </Text>
                      </View>
                    )}
                  </View>

                  {!!matchedUser.medicalRecord?.bloodGroup && (
                    <Text className="mt-3 text-xs text-muted-foreground">
                      Blood group: {matchedUser.medicalRecord.bloodGroup}
                    </Text>
                  )}
                  {!!matchedUser.sosMessage && (
                    <Text className="mt-1 text-xs text-muted-foreground">
                      SOS: {matchedUser.sosMessage}
                    </Text>
                  )}

                  <View className="mt-3 flex-row gap-2">
                    <Pressable
                      onPress={() => setUseMatchedUser(true)}
                      className={`flex-1 rounded-lg px-3 py-2.5 ${useMatchedUser ? "bg-primary" : "border border-border bg-background"}`}
                    >
                      <Text
                        className={`text-center text-xs font-semibold ${useMatchedUser ? "text-primary-foreground" : "text-foreground"}`}
                      >
                        Use match
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setUseMatchedUser(false)}
                      className={`flex-1 rounded-lg px-3 py-2.5 ${!useMatchedUser ? "bg-primary" : "border border-border bg-background"}`}
                    >
                      <Text
                        className={`text-center text-xs font-semibold ${!useMatchedUser ? "text-primary-foreground" : "text-foreground"}`}
                      >
                        Ignore
                      </Text>
                    </Pressable>
                  </View>

                  <Pressable
                    onPress={() =>
                      void handleCallPhoneNumber(matchedUser.phoneNumber)
                    }
                    className="mt-2 items-center rounded-lg border border-border bg-background px-3 py-2.5"
                  >
                    <Text className="text-xs font-semibold text-foreground">
                      Call {matchedUser.name}
                    </Text>
                  </Pressable>

                  {!!matchedUser.contacts?.length && (
                    <View className="mt-4">
                      <Text className="text-xs font-semibold text-muted-foreground">
                        EMERGENCY CONTACTS
                      </Text>
                      {matchedUser.contacts.map((contact, index) => (
                        <View
                          key={`${contact.phoneNumber}-${index}`}
                          className="mt-2 flex-row items-center justify-between border-b border-border py-2"
                        >
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-foreground">
                              {contact.name}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              {contact.relation || contact.phoneNumber}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() =>
                              void handleCallPhoneNumber(contact.phoneNumber)
                            }
                            className="rounded-lg bg-primary/10 px-3 py-2"
                          >
                            <Text className="text-xs font-bold text-primary">
                              Call
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Details */}
          <View className="mt-7">
            <Text className="text-base font-bold text-foreground">
              A few details
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Add anything that could help responders.
            </Text>

            <View className="mt-4">
              <Text className="mb-2 text-sm font-semibold text-foreground">
                Short title
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Person injured on road"
                placeholderTextColor="#94a3b8"
                className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-foreground"
              />
            </View>

            <View className="mt-4">
              <Text className="mb-2 text-sm font-semibold text-foreground">
                What happened?{" "}
                <Text className="font-normal text-muted-foreground">
                  Optional
                </Text>
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Briefly describe the situation"
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="min-h-28 rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-foreground"
              />
            </View>

            <View className="mt-4 flex-row gap-3">
              <View className="flex-1">
                <Text className="mb-2 text-sm font-semibold text-foreground">
                  People affected
                </Text>
                <TextInput
                  value={victimsCount}
                  onChangeText={setVictimsCount}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor="#94a3b8"
                  className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-foreground"
                />
              </View>
              <View className="flex-1">
                <Text className="mb-2 text-sm font-semibold text-foreground">
                  Condition
                </Text>
                <TextInput
                  value={condition}
                  onChangeText={setCondition}
                  placeholder="e.g. bleeding"
                  placeholderTextColor="#94a3b8"
                  className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-foreground"
                />
              </View>
            </View>
          </View>

          {/* Location */}
          <View className="mt-7 rounded-2xl border border-border bg-card p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-sm font-bold text-foreground">
                  Your location
                </Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  {isLocating
                    ? "Getting your current location…"
                    : location
                      ? "Location detected and ready"
                      : "Location unavailable"}
                </Text>
              </View>
              <View
                className={`h-9 w-9 items-center justify-center rounded-full ${location ? "bg-green-500/10" : "bg-red-500/10"}`}
              >
                <Text className="text-base">{location ? "✓" : "!"}</Text>
              </View>
            </View>
            {location && (
              <Text className="mt-3 text-xs text-muted-foreground">
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </Text>
            )}
          </View>

          {/* Evidence */}
          <View className="mt-7">
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-base font-bold text-foreground">
                  Add evidence
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Photos or video can help responders.
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground">Optional</Text>
            </View>

            <View className="mt-3 flex-row gap-3">
              <Pressable
                onPress={() => void uploadIncidentMedia("image")}
                className="flex-1 items-center rounded-xl border border-border bg-card px-3 py-3.5"
              >
                <Text className="text-sm font-semibold text-foreground">
                  + Photo
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void uploadIncidentMedia("video")}
                className="flex-1 items-center rounded-xl border border-border bg-card px-3 py-3.5"
              >
                <Text className="text-sm font-semibold text-foreground">
                  + Video
                </Text>
              </Pressable>
            </View>

            {incidentAttachments.length > 0 && (
              <View className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
                {incidentAttachments.map((attachment, index) => (
                  <View
                    key={`${attachment.key}-${index}`}
                    className={`flex-row items-center gap-3 p-3 ${index > 0 ? "border-t border-border" : ""}`}
                  >
                    {attachment.type === "image" ? (
                      <Image
                        source={{ uri: attachment.previewUri }}
                        className="h-12 w-12 rounded-lg"
                      />
                    ) : (
                      <View className="h-12 w-12 items-center justify-center rounded-lg bg-muted">
                        <Text className="text-xs font-bold text-muted-foreground">
                          VIDEO
                        </Text>
                      </View>
                    )}
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">
                        {attachment.type === "image"
                          ? "Photo added"
                          : "Video added"}
                      </Text>
                      <Text
                        className="mt-0.5 text-xs text-muted-foreground"
                        numberOfLines={1}
                      >
                        {attachment.name}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {!!error && (
            <View className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          )}

          {/* Trigger */}
          <View className="mt-8">
            {showTriggerActions ? (
              <View className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <View className="items-center">
                  <Text className="text-xs font-bold uppercase tracking-wider text-red-700">
                    Emergency is armed
                  </Text>
                  <Text className="mt-1 text-4xl font-black text-red-700">
                    {countdown}s
                  </Text>
                  <Text className="mt-1 text-center text-xs leading-5 text-red-700/70">
                    You can stop this before the emergency is sent.
                  </Text>
                </View>
                <View className="mt-4 flex-row gap-3">
                  <Pressable
                    onPress={() => void handleEmergencyTrigger()}
                    disabled={
                      !canStartCountdown || submitting || processingPhoto
                    }
                    className={`flex-1 items-center rounded-xl py-4 ${!canStartCountdown || submitting || processingPhoto ? "bg-red-300" : "bg-red-600"}`}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text className="text-sm font-bold text-white">
                        Send now
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={cancelCountdown}
                    disabled={submitting}
                    className="flex-1 items-center rounded-xl border border-border bg-background py-4"
                  >
                    <Text className="text-sm font-bold text-foreground">
                      Stop
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View>
                <Pressable
                  onPress={startCountdown}
                  disabled={!canStartCountdown || submitting || processingPhoto}
                  className={`items-center rounded-2xl py-4 ${!canStartCountdown || submitting || processingPhoto ? "bg-muted" : "bg-red-600"}`}
                >
                  <Text
                    className={`text-base font-bold ${!canStartCountdown || submitting || processingPhoto ? "text-muted-foreground" : "text-white"}`}
                  >
                    Trigger emergency
                  </Text>
                </Pressable>
                <Text className="mt-2 text-center text-xs text-muted-foreground">
                  30-second confirmation before dispatch
                </Text>
              </View>
            )}
          </View>

          {/* Nearby activity — intentionally quieter than the emergency form */}
          <View className="mt-10 border-t border-border pt-6">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-base font-bold text-foreground">
                  Nearby emergencies
                </Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  People around you who may need help.
                </Text>
              </View>
              <Text className="text-xs font-semibold text-muted-foreground">
                {nearbyOngoing.length}
              </Text>
            </View>

            {nearbyOngoing.length === 0 ? (
              <Text className="mt-4 text-sm text-muted-foreground">
                Nothing nearby right now.
              </Text>
            ) : (
              <View className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
                {nearbyOngoing.slice(0, 8).map((item, index) => (
                  <View
                    key={item.emergencyId}
                    className={`p-4 ${index > 0 ? "border-t border-border" : ""}`}
                  >
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-foreground">
                          {item.title}
                        </Text>
                        {!!item.description && (
                          <Text className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.description}
                          </Text>
                        )}
                      </View>
                      <Text className="text-[10px] font-bold uppercase text-muted-foreground">
                        {item.severity}
                      </Text>
                    </View>
                    <Text className="mt-2 text-xs text-muted-foreground">
                      {item.respondersCount} responder
                      {item.respondersCount === 1 ? "" : "s"}
                    </Text>
                    <View className="mt-3 flex-row gap-2">
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: "/case",
                            params: { emergencyId: item.emergencyId },
                          })
                        }
                        className="rounded-lg border border-border px-4 py-2.5"
                      >
                        <Text className="text-xs font-semibold text-foreground">
                          View
                        </Text>
                      </Pressable>
                      {(userDetails?.role === "public" ||
                        userDetails?.role === "volunteer") && (
                        <Pressable
                          onPress={() =>
                            void handleAcceptFromNearby(item.emergencyId)
                          }
                          className="rounded-lg bg-primary px-4 py-2.5"
                        >
                          <Text className="text-xs font-semibold text-primary-foreground">
                            Help
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Live dispatch is a post-trigger operational view */}
          {(activeEmergencyId ||
            dispatchSummary ||
            dispatchMapSnapshot ||
            dispatchFeed.length > 0) && (
            <View className="mt-10 border-t border-border pt-6">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-base font-bold text-foreground">
                    Live response
                  </Text>
                  <Text className="mt-1 text-xs text-muted-foreground">
                    Updates from the emergency network.
                  </Text>
                </View>
                <View
                  className={`rounded-full px-2.5 py-1 ${isConnected ? "bg-green-500/10" : "bg-red-500/10"}`}
                >
                  <Text
                    className={`text-[10px] font-bold ${isConnected ? "text-green-700" : "text-red-700"}`}
                  >
                    {isConnected ? "LIVE" : "OFFLINE"}
                  </Text>
                </View>
              </View>

              {!!activeEmergencyId && (
                <View className="mt-3 rounded-xl bg-card px-4 py-3">
                  <Text className="text-xs text-muted-foreground">
                    Emergency ID
                  </Text>
                  <Text className="mt-1 text-sm font-semibold text-foreground">
                    {activeEmergencyId}
                  </Text>
                </View>
              )}

              {dispatchSummary && (
                <View className="mt-3 rounded-xl border border-border bg-card p-4">
                  <Text className="text-sm font-bold text-foreground">
                    Help notified
                  </Text>
                  <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-3">
                    {[
                      ["Users", dispatchSummary.nearbyUsers],
                      ["Volunteers", dispatchSummary.nearbyVolunteers],
                      ["Authorities", dispatchSummary.nearbyAuthorities],
                      ["Controllers", dispatchSummary.controllerCenters],
                      ["Contacts", dispatchSummary.contacts],
                    ].map(([label, value]) => (
                      <View key={String(label)}>
                        <Text className="text-lg font-bold text-foreground">
                          {value}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          {label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {dispatchMapSnapshot && mapMarkers.length > 0 && (
                <View className="mt-3 rounded-xl border border-border bg-card p-3">
                  <View className="px-1">
                    <Text className="text-sm font-bold text-foreground">
                      Responder map
                    </Text>
                    <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
                      {[
                        { label: "Incident", color: MARKER_COLORS.incident },
                        { label: "Users", color: MARKER_COLORS.user },
                        { label: "Volunteers", color: MARKER_COLORS.volunteer },
                        { label: "Contacts", color: MARKER_COLORS.contact },
                        {
                          label: "Authorities",
                          color: MARKER_COLORS.authority,
                        },
                      ].map(({ label, color }) => (
                        <View
                          key={label}
                          className="flex-row items-center gap-1"
                        >
                          <View
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 4,
                              backgroundColor: color,
                            }}
                          />
                          <Text className="text-[10px] text-muted-foreground">
                            {label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <DispatchMap
                    snapshot={dispatchMapSnapshot}
                    markers={mapMarkers}
                  />
                </View>
              )}

              <View className="mt-3 rounded-xl border border-border bg-card p-4">
                <Text className="text-sm font-bold text-foreground">
                  Activity
                </Text>
                {dispatchFeed.length === 0 ? (
                  <Text className="mt-2 text-xs text-muted-foreground">
                    Waiting for dispatch updates…
                  </Text>
                ) : (
                  dispatchFeed.slice(0, 8).map((item, index) => (
                    <View key={`feed-${index}`} className="mt-3 flex-row gap-2">
                      <View className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                      <Text className="flex-1 text-xs leading-5 text-muted-foreground">
                        {item}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
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
          setDispatchFeed((prev) =>
            [summaryLine, transcriptLine, ...prev].slice(0, 20),
          );
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
