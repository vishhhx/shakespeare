import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronDown, ChevronUp, ImagePlus, Phone, ShieldAlert, Smartphone, Users, Video } from "lucide-react-native";

import { AuthContext } from "../../context/authContext";
import { SocketContext, useSocketEvent } from "../../context/socketContext";
import { useActiveCase } from "../../context/activeCase";
import { useCurrentLocation } from "../../hooks/useCurrentLocation";
import {
  acceptEmergencyResponse,
  getApiErrorMessage,
  getNearbyOngoingEmergencies,
  getPublicProfile,
  getS3UploadUrl,
  initiateEmergency,
  newClientRequestId,
  processEmergencyStrangerPhoto,
  uploadImage,
} from "../../lib/api";
import {
  EMERGENCY_TYPE_LABELS,
  type EmergencyCard,
  type EmergencySeverity,
  type EmergencyType,
} from "../../lib/emergencyTypes";
import { radius, space, type as typeScale, useTheme } from "../../theme";
import { AppText, Banner, Button, Card, Chip, Screen } from "../../components/ui";
import { SosButton } from "../../components/emergency/SosButton";
import { LocationStatusCard } from "../../components/emergency/LocationStatusCard";
import { SeverityBadge, StatusPill } from "../../components/emergency/badges";
import VoiceSosButton from "../../components/floating-voice-emergency-button";
import EmergencyChatbotWidget from "../../components/emergency-chatbot-widget";

// Short enough not to slow a real emergency, long enough to cancel a pocket tap.
const SOS_COUNTDOWN_SECONDS = 5;
const NATIONAL_EMERGENCY_NUMBER = "112";

type StrangerMatch = Awaited<ReturnType<typeof processEmergencyStrangerPhoto>>;
type Attachment = { key: string; type: "image" | "video"; previewUri: string };
type NearbyCase = EmergencyCard & { isMine: boolean; amResponding: boolean; distanceKm: number };

const TYPES: EmergencyType[] = ["medical", "accident", "fire", "crime", "missing_child", "other"];
const SEVERITIES: EmergencySeverity[] = ["low", "medium", "high", "critical"];

export default function EmergencyTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { userDetails } = useContext(AuthContext);
  const { isConnected } = useContext(SocketContext);
  const { active, refresh: refreshActiveCase } = useActiveCase();
  const location = useCurrentLocation();

  // What happened (all optional; defaults let someone send with one tap).
  const [type, setType] = useState<EmergencyType>("medical");
  const [severity, setSeverity] = useState<EmergencySeverity>("high");
  const [isForSelf, setIsForSelf] = useState(true);
  const [relation, setRelation] = useState<"family" | "bystander">("bystander");
  const [showDetails, setShowDetails] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [condition, setCondition] = useState("");
  const [victimsCount, setVictimsCount] = useState("1");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Someone else: optional face photo to look for a registered person.
  const [strangerPhoto, setStrangerPhoto] = useState<string | null>(null);
  const [strangerKey, setStrangerKey] = useState("");
  const [match, setMatch] = useState<StrangerMatch | null>(null);
  const [confirmedMatch, setConfirmedMatch] = useState(false);
  const [identifying, setIdentifying] = useState(false);

  // Sending.
  const [phase, setPhase] = useState<"idle" | "counting" | "sending">("idle");
  const [secondsLeft, setSecondsLeft] = useState(SOS_COUNTDOWN_SECONDS);
  const [error, setError] = useState("");
  const requestIdRef = useRef("");
  const sendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [nearby, setNearby] = useState<NearbyCase[]>([]);
  const [contacts, setContacts] = useState<{ name: string; phoneNumber: string; relation?: string }[]>([]);

  const myOpenCase = active?.asReporter ?? null;
  const helpingCases = active?.asResponder ?? [];

  useEffect(() => {
    void getPublicProfile()
      .then((response) => setContacts(response?.profile?.contacts ?? []))
      .catch(() => undefined);
  }, []);

  const loadNearby = useCallback(async () => {
    if (!location.coords) return;
    try {
      const response = await getNearbyOngoingEmergencies({ ...location.coords, radiusKm: 10 });
      setNearby(response.emergencies.filter((item) => !item.isMine));
    } catch {
      // keep the last list on transient failures
    }
  }, [location.coords]);

  useEffect(() => {
    void loadNearby();
    const timer = setInterval(() => void loadNearby(), 30000);
    return () => clearInterval(timer);
  }, [loadNearby]);

  useSocketEvent("emergency-nearby-alert", () => void loadNearby());
  useSocketEvent("emergency-case-updated", () => void loadNearby());

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => clearTimer, []);

  const send = useCallback(async () => {
    if (sendingRef.current) return; // one request per SOS, however many taps
    sendingRef.current = true;
    clearTimer();
    setPhase("sending");
    setError("");
    try {
      const coords = location.coords ?? (await location.refresh());
      if (!coords) {
        setError(
          location.status === "denied"
            ? "SafeSphere needs your location to send help. Allow location, or call 112."
            : "We couldn't get your location. Try again, or call 112.",
        );
        setPhase("idle");
        return;
      }

      const result = await initiateEmergency({
        title: title.trim() || `${EMERGENCY_TYPE_LABELS[type]} emergency`,
        description: description.trim() || undefined,
        type,
        severity,
        relationToVictim: isForSelf ? "self" : relation,
        isForSelf,
        location: coords,
        victimsCount: Number(victimsCount) || 1,
        condition: condition.trim() || undefined,
        strangerFaceKey: !isForSelf && strangerKey ? strangerKey : undefined,
        faceEmbeddingId: !isForSelf ? match?.embeddingId : undefined,
        identifiedUserId: !isForSelf && confirmedMatch ? match?.matchedUser?.userId : undefined,
        incidentMedia: attachments.map(({ key, type: mediaType }) => ({ key, type: mediaType })),
        clientRequestId: requestIdRef.current,
      });

      setPhase("idle");
      setAttachments([]);
      setTitle("");
      setDescription("");
      setCondition("");
      void refreshActiveCase();
      router.push({ pathname: "/case", params: { emergencyId: result.emergencyId, justSent: result.kind === "created" ? "1" : "0" } });
    } catch (sendError) {
      // Keep the same request id: "Try again" must not create a second case.
      setError(getApiErrorMessage(sendError, "Your SOS was not sent. Try again, or call 112."));
      setPhase("idle");
    } finally {
      sendingRef.current = false;
    }
  }, [attachments, condition, confirmedMatch, description, isForSelf, location, match, refreshActiveCase, relation, router, severity, strangerKey, title, type, victimsCount]);

  const sendRef = useRef(send);
  sendRef.current = send;

  const startCountdown = () => {
    if (myOpenCase) {
      router.push({ pathname: "/case", params: { emergencyId: myOpenCase.emergencyId } });
      return;
    }
    if (!error) requestIdRef.current = newClientRequestId();
    setError("");
    let seconds = SOS_COUNTDOWN_SECONDS;
    setSecondsLeft(seconds);
    setPhase("counting");
    // Start finding a fresh fix while the countdown runs.
    if (location.status !== "ready") void location.refresh();
    clearTimer();
    timerRef.current = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        void sendRef.current();
        return;
      }
      setSecondsLeft(seconds);
    }, 1000);
  };

  const cancelCountdown = () => {
    clearTimer();
    setPhase("idle");
    requestIdRef.current = "";
  };

  const identifyPerson = async () => {
    if (!userDetails?.userId) return;
    setError("");
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is needed to photograph the person. You can still send the SOS without it.");
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.7 });
    if (shot.canceled || !shot.assets[0]?.uri) return;

    setStrangerPhoto(shot.assets[0].uri);
    setMatch(null);
    setConfirmedMatch(false);
    setIdentifying(true);
    try {
      // The server requires this exact folder and a timestamp file name.
      const key = await uploadImage({
        uri: shot.assets[0].uri,
        bucket: "profile",
        key: `emergency/stranger/${userDetails.userId}/${Date.now()}.jpg`,
      });
      setStrangerKey(key);
      setMatch(await processEmergencyStrangerPhoto(key));
    } catch (identifyError) {
      setStrangerKey("");
      setError(`${getApiErrorMessage(identifyError, "Identification failed.")} You can still send the SOS.`);
    } finally {
      setIdentifying(false);
    }
  };

  const addMedia = async (mediaType: "image" | "video") => {
    if (!userDetails?.userId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to attach evidence.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [mediaType === "image" ? "images" : "videos"],
      quality: 0.7,
    });
    if (picked.canceled || !picked.assets[0]?.uri) return;
    const asset = picked.assets[0];
    setUploadingMedia(true);
    try {
      const contentType = asset.mimeType || (mediaType === "image" ? "image/jpeg" : "video/mp4");
      const extension = contentType.split("/")[1]?.split(";")[0] || (mediaType === "image" ? "jpg" : "mp4");
      const key = `emergency/media/${userDetails.userId}/${Date.now()}.${extension}`;
      const { url, key: serverKey } = await getS3UploadUrl({ key, contentType, bucket: "profile" });
      const body = await (await fetch(asset.uri)).blob();
      const upload = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });
      if (!upload.ok) throw new Error("Upload failed. Try again.");
      setAttachments((previous) => [...previous, { key: serverKey ?? key, type: mediaType, previewUri: asset.uri }]);
    } catch (mediaError) {
      setError(getApiErrorMessage(mediaError, "Couldn't attach that file."));
    } finally {
      setUploadingMedia(false);
    }
  };

  const offerHelp = async (item: NearbyCase) => {
    try {
      await acceptEmergencyResponse(item.emergencyId, location.coords);
      void refreshActiveCase();
      router.push({ pathname: "/case", params: { emergencyId: item.emergencyId } });
    } catch (helpError) {
      Alert.alert("Couldn't join", getApiErrorMessage(helpError));
    }
  };

  const call = (phoneNumber: string) => void Linking.openURL(`tel:${phoneNumber}`).catch(() => Alert.alert("Can't place calls", phoneNumber));

  const sosDisabled = phase === "idle" && location.status === "denied" && !location.canAskAgain;

  return (
    <Screen
      header={
        <View style={styles.header}>
          <AppText variant="title">Emergency</AppText>
          <View
            style={[styles.connection, { backgroundColor: isConnected ? colors.successSoft : colors.surfaceMuted }]}
            accessibilityLabel={isConnected ? "Connected for live updates" : "Reconnecting for live updates"}
          >
            <View style={[styles.connectionDot, { backgroundColor: isConnected ? colors.success : colors.textSubtle }]} />
            <AppText variant="caption" tone={isConnected ? "success" : "muted"}>
              {isConnected ? "Live" : "Reconnecting"}
            </AppText>
          </View>
        </View>
      }
    >
      <View style={styles.stack}>
        {myOpenCase ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your active emergency"
            onPress={() => router.push({ pathname: "/case", params: { emergencyId: myOpenCase.emergencyId } })}
            style={({ pressed }) => [styles.activeCase, { borderColor: colors.danger, backgroundColor: pressed ? colors.dangerSoft : colors.surface }]}
          >
            <View style={styles.rowBetween}>
              <AppText variant="overline" tone="danger">YOUR SOS IS ACTIVE</AppText>
              <StatusPill status={myOpenCase.status} />
            </View>
            <AppText variant="headline">{myOpenCase.title}</AppText>
            <AppText variant="caption" tone="muted">
              {myOpenCase.respondersCount > 0
                ? `${myOpenCase.respondersCount} responder${myOpenCase.respondersCount === 1 ? "" : "s"} connected · tap to open`
                : "Waiting for responders · tap to see your case"}
            </AppText>
          </Pressable>
        ) : null}

        {helpingCases.map((item) => (
          <Pressable
            key={item.emergencyId}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/case", params: { emergencyId: item.emergencyId } })}
            style={({ pressed }) => [styles.activeCase, { borderColor: colors.accent, backgroundColor: pressed ? colors.accentSoft : colors.surface }]}
          >
            <AppText variant="overline" tone="accent">YOU’RE HELPING</AppText>
            <AppText variant="bodyStrong">{item.title}</AppText>
            <AppText variant="caption" tone="muted">Open the case for directions and updates</AppText>
          </Pressable>
        ))}

        {!myOpenCase && (
          <SosButton
            phase={phase}
            secondsLeft={secondsLeft}
            totalSeconds={SOS_COUNTDOWN_SECONDS}
            disabled={sosDisabled}
            disabledReason="Turn on location for SafeSphere in Settings to send an SOS."
            onStart={startCountdown}
            onCancel={cancelCountdown}
            onSendNow={() => void send()}
          />
        )}

        {!!error && <Banner tone="danger" message={error} actionLabel={phase === "idle" && !myOpenCase ? "Try again" : undefined} onAction={() => void send()} />}

        <View style={styles.row}>
          <VoiceSosButton />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${NATIONAL_EMERGENCY_NUMBER}`}
            onPress={() => call(NATIONAL_EMERGENCY_NUMBER)}
            style={({ pressed }) => [styles.callTile, { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
          >
            <Phone size={20} color={colors.text} aria-hidden />
            <AppText variant="bodyStrong">Call {NATIONAL_EMERGENCY_NUMBER}</AppText>
          </Pressable>
        </View>

        <View style={[styles.hint, { backgroundColor: colors.surfaceMuted }]}>
          <Smartphone size={18} color={colors.textMuted} aria-hidden />
          <AppText variant="caption" tone="muted" style={styles.flex}>
            Can’t reach the screen? Shake your phone hard to start a voice SOS from anywhere in the app.
          </AppText>
        </View>

        <LocationStatusCard location={location} />

        {!myOpenCase && (
          <Card>
            <AppText variant="bodyStrong">What’s happening?</AppText>
            <View style={styles.chips}>
              {TYPES.map((value) => (
                <Chip key={value} label={EMERGENCY_TYPE_LABELS[value]} selected={type === value} onPress={() => setType(value)} />
              ))}
            </View>
            <AppText variant="bodyStrong">How serious?</AppText>
            <View style={styles.chips}>
              {SEVERITIES.map((value) => (
                <Chip key={value} label={value[0]!.toUpperCase() + value.slice(1)} selected={severity === value} onPress={() => setSeverity(value)} />
              ))}
            </View>
            <AppText variant="bodyStrong">Who needs help?</AppText>
            <View style={styles.chips}>
              <Chip label="Me" selected={isForSelf} onPress={() => setIsForSelf(true)} />
              <Chip label="Someone else" icon={Users} selected={!isForSelf} onPress={() => setIsForSelf(false)} />
            </View>

            {!isForSelf && (
              <View style={styles.stackTight}>
                <View style={styles.chips}>
                  <Chip label="A family member" selected={relation === "family"} onPress={() => setRelation("family")} />
                  <Chip label="Someone I found" selected={relation === "bystander"} onPress={() => setRelation("bystander")} />
                </View>
                <Button
                  label={identifying ? "Looking for a match…" : strangerPhoto ? "Retake photo" : "Photograph the person (optional)"}
                  icon={Camera}
                  variant="secondary"
                  loading={identifying}
                  onPress={() => void identifyPerson()}
                />
                <AppText variant="caption" tone="muted">
                  If they’re registered with SafeSphere, we can suggest who they are so responders can reach their family. The
                  photo is only used for this match.
                </AppText>
                {strangerPhoto && <Image source={{ uri: strangerPhoto }} style={styles.photo} accessibilityLabel="Photo of the person" />}
                {match && match.matchKind === "none" && (
                  <Banner tone="info" message="No registered person matched this photo. Send the SOS anyway; responders will help identify them." />
                )}
                {match?.matchedUser && (
                  <View style={[styles.match, { borderColor: confirmedMatch ? colors.success : colors.borderStrong }]}>
                    <AppText variant="overline" tone="muted">
                      POSSIBLE MATCH{typeof match.similarity?.matchedScore === "number" ? ` · ${Math.round(match.similarity.matchedScore * 100)}% similar` : ""}
                    </AppText>
                    <AppText variant="headline">{match.matchedUser.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {[match.matchedUser.age ? `${match.matchedUser.age} years` : null, match.matchedUser.gender].filter(Boolean).join(" · ") ||
                        "Compare their face with the photo before confirming."}
                    </AppText>
                    <View style={styles.row}>
                      <View style={styles.flex}>
                        <Button label={confirmedMatch ? "Confirmed" : "It's them"} variant={confirmedMatch ? "primary" : "secondary"} onPress={() => setConfirmedMatch(true)} />
                      </View>
                      <View style={styles.flex}>
                        <Button label="Not them" variant="ghost" onPress={() => { setConfirmedMatch(false); setMatch({ ...match, matchedUser: null, matchKind: "none" }); }} />
                      </View>
                    </View>
                    {confirmedMatch &&
                      (match.matchedUser.contacts ?? []).slice(0, 3).map((contact) => (
                        <View key={contact.phoneNumber} style={styles.rowBetween}>
                          <AppText variant="body">{contact.name}{contact.relation ? ` · ${contact.relation}` : ""}</AppText>
                          <Button label="Call" icon={Phone} variant="secondary" fullWidth={false} onPress={() => call(contact.phoneNumber)} />
                        </View>
                      ))}
                  </View>
                )}
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showDetails }}
              onPress={() => setShowDetails((value) => !value)}
              style={styles.disclosure}
            >
              <AppText variant="label">Add details and evidence (optional)</AppText>
              {showDetails ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
            </Pressable>

            {showDetails && (
              <View style={styles.stackTight}>
                {(
                  [
                    ["Short title", title, setTitle, "e.g. Man collapsed at bus stop"],
                    ["What happened", description, setDescription, "Anything that helps responders"],
                    ["Their condition", condition, setCondition, "e.g. breathing, bleeding"],
                  ] as const
                ).map(([label, value, setter, placeholder]) => (
                  <View key={label} style={styles.field}>
                    <AppText variant="label">{label}</AppText>
                    <TextInput
                      value={value}
                      onChangeText={setter}
                      placeholder={placeholder}
                      placeholderTextColor={colors.textSubtle}
                      multiline={label === "What happened"}
                      style={[styles.input, { borderColor: colors.borderStrong, color: colors.text, backgroundColor: colors.surface }]}
                    />
                  </View>
                ))}
                <View style={styles.field}>
                  <AppText variant="label">People affected</AppText>
                  <TextInput
                    value={victimsCount}
                    onChangeText={(value) => setVictimsCount(value.replace(/\D/g, "").slice(0, 3))}
                    keyboardType="number-pad"
                    style={[styles.input, { borderColor: colors.borderStrong, color: colors.text, backgroundColor: colors.surface }]}
                  />
                </View>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Button label="Photo" icon={ImagePlus} variant="secondary" loading={uploadingMedia} onPress={() => void addMedia("image")} />
                  </View>
                  <View style={styles.flex}>
                    <Button label="Video" icon={Video} variant="secondary" disabled={uploadingMedia} onPress={() => void addMedia("video")} />
                  </View>
                </View>
                {attachments.length > 0 && (
                  <AppText variant="caption" tone="muted">{attachments.length} file(s) attached to this SOS</AppText>
                )}
              </View>
            )}
          </Card>
        )}

        <Card muted>
          <View style={styles.row}>
            <ShieldAlert size={18} color={colors.text} aria-hidden />
            <AppText variant="bodyStrong">When you send an SOS</AppText>
          </View>
          <AppText variant="caption" tone="muted">
            • Volunteers within 8 km and authorities within 20 km get an in-app alert.{"\n"}
            • Your emergency contacts get an SMS with your location ({contacts.length || "none"} saved).{"\n"}
            • People nearby who are offline may get an SMS.{"\n"}
            • The control center sees your case and its progress.
          </AppText>
        </Card>

        {contacts.length > 0 && (
          <Card>
            <AppText variant="bodyStrong">Your emergency contacts</AppText>
            {contacts.slice(0, 4).map((contact) => (
              <View key={contact.phoneNumber} style={styles.rowBetween}>
                <View style={styles.flex}>
                  <AppText variant="body">{contact.name}</AppText>
                  {!!contact.relation && <AppText variant="caption" tone="muted">{contact.relation}</AppText>}
                </View>
                <Button label="Call" icon={Phone} variant="secondary" fullWidth={false} onPress={() => call(contact.phoneNumber)} />
              </View>
            ))}
          </Card>
        )}

        <View style={styles.stackTight}>
          <View style={styles.rowBetween}>
            <AppText variant="headline">Nearby emergencies</AppText>
            <AppText variant="caption" tone="muted">{location.coords ? "within 10 km" : ""}</AppText>
          </View>
          {!location.coords ? (
            <AppText variant="caption" tone="muted">Turn on location to see people nearby who need help.</AppText>
          ) : nearby.length === 0 ? (
            <AppText variant="caption" tone="muted">No open emergencies near you right now.</AppText>
          ) : (
            nearby.slice(0, 8).map((item) => (
              <Card key={item.emergencyId}>
                <View style={styles.rowBetween}>
                  <AppText variant="bodyStrong" style={styles.flex}>{item.title}</AppText>
                  <SeverityBadge severity={item.severity} />
                </View>
                <AppText variant="caption" tone="muted">
                  {EMERGENCY_TYPE_LABELS[item.type]} · {item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)} m` : `${item.distanceKm.toFixed(1)} km`} away ·{" "}
                  {item.respondersCount} helping
                </AppText>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Button label="View" variant="secondary" onPress={() => router.push({ pathname: "/case", params: { emergencyId: item.emergencyId } })} />
                  </View>
                  {!item.amResponding && (
                    <View style={styles.flex}>
                      <Button label="I can help" onPress={() => void offerHelp(item)} />
                    </View>
                  )}
                </View>
              </Card>
            ))
          )}
        </View>
      </View>

      <EmergencyChatbotWidget emergencyId={myOpenCase?.emergencyId} side="right" bottomOffset={24} horizontalOffset={18} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  connection: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },
  stack: { gap: space.lg },
  stackTight: { gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  activeCase: { borderWidth: 2, borderRadius: radius.lg, padding: space.md, gap: space.xxs },
  callTile: { flex: 1, minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, borderWidth: 1.5, borderRadius: radius.lg },
  hint: { flexDirection: "row", gap: space.sm, alignItems: "center", padding: space.sm, borderRadius: radius.md },
  photo: { width: "100%", height: 200, borderRadius: radius.md },
  match: { borderWidth: 1.5, borderRadius: radius.md, padding: space.md, gap: space.xs },
  disclosure: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  field: { gap: space.xxs },
  input: { ...typeScale.body, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 48 },
});
