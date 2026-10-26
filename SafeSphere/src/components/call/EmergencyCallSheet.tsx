import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { MediaStreamTrack } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react-native";

import { useEmergencyCall } from "../../context/call";
import type { CallView } from "../../lib/callTypes";
import type { CallSnapshot, RemotePeer } from "../../lib/mediaCall";
import { webrtc } from "../../lib/webrtc";
import { radius, space, useTheme } from "../../theme";
import { AppText, Button } from "../ui";

const ROLE_NAMES: Record<string, string> = {
  "controller-center": "Control center",
  authority: "Authority",
  responder: "Field responder",
  volunteer: "Volunteer",
  public: "Community helper",
};

/** What the person who raised the SOS most needs to know about the call right now. */
const callerHeadline = (view: CallView | null, media: CallSnapshot) => {
  if (media.connection === "ended") return "Call ended. Your emergency is still open.";
  if (media.connection === "failed") return media.error ?? "The call couldn't connect.";
  if (media.connection === "connecting") return "Connecting your call…";
  if (media.connection === "reconnecting") return "Reconnecting…";
  const controllerIn = view?.participants.some((p) => p.role === "controller-center" && p.connection === "connected");
  if (controllerIn) {
    const others = view?.participants.filter((p) => p.connection === "connected" && p.role !== "controller-center" && p.inviteStatus !== "caller").length ?? 0;
    return others ? `Control center and ${others} responder${others === 1 ? "" : "s"} are with you` : "The control center has joined";
  }
  if (view?.answeredBy) return "The control center is joining…";
  return "Waiting for the control center to answer…";
};

function StreamView({ track, mirror, style }: { track: MediaStreamTrack; mirror?: boolean; style: object }) {
  // One MediaStream per track (RTCView renders streams by URL).
  // Only rendered for tracks the call produced, so WebRTC is loaded whenever this runs.
  const { MediaStream, RTCView } = webrtc!;
  const url = useMemo(() => new MediaStream([track]).toURL(), [MediaStream, track]);
  return <RTCView streamURL={url} objectFit="cover" mirror={mirror} style={style} />;
}

function PeerTile({ peer, label }: { peer: RemotePeer; label: string }) {
  const { colors } = useTheme();
  const showVideo = peer.video && !peer.videoPaused;
  return (
    <View style={[styles.tile, { backgroundColor: "#111" }]} accessibilityLabel={`${peer.name}, ${label}`}>
      {showVideo ? (
        <StreamView track={peer.video as unknown as MediaStreamTrack} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={styles.avatar}>
          <AppText variant="headline" style={styles.onDark}>{peer.name.slice(0, 1).toUpperCase()}</AppText>
        </View>
      )}
      <View style={styles.caption}>
        <AppText variant="label" style={styles.onDark} numberOfLines={1}>{peer.name}</AppText>
        <AppText variant="caption" style={{ color: "rgba(255,255,255,0.75)" }} numberOfLines={1}>{label}</AppText>
        {(peer.audioPaused || !peer.audio) && <MicOff size={14} color={colors.danger} aria-label="Microphone off" />}
      </View>
    </View>
  );
}

export default function EmergencyCallSheet() {
  const { active, sheetVisible, hideSheet, showSheet, leave, cancel, setMic, setCamera } = useEmergencyCall();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!active) return null;

  const { view, media } = active;
  const me = view?.participants.find((participant) => participant.isMe);
  const isCaller = me?.inviteStatus === "caller";
  const headline = isCaller ? callerHeadline(view, media) : media.connection === "connected" ? "In the emergency call" : callerHeadline(view, media);
  const byUser = new Map((view?.participants ?? []).map((participant) => [participant.userId, participant]));
  const localVideo = media.local.stream?.getVideoTracks()[0];
  const live = media.connection !== "ended" && media.connection !== "failed";

  // Minimised: a bar above the tab bar keeps the call one tap away without hiding the case.
  if (!sheetVisible) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Emergency call: ${headline}. Open call`}
        onPress={showSheet}
        style={[styles.bar, { bottom: insets.bottom + 72, backgroundColor: live ? colors.success : colors.surfaceMuted }]}
      >
        <Phone size={16} color={live ? "#fff" : colors.text} />
        <AppText variant="label" style={{ color: live ? "#fff" : colors.text, flex: 1 }} numberOfLines={1}>{headline}</AppText>
      </Pressable>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={hideSheet} presentationStyle="fullScreen">
      <View style={[styles.sheet, { backgroundColor: "#0A0A0A", paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.sm }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Minimise call" onPress={hideSheet} hitSlop={10} style={styles.headerButton}>
            <ChevronDown size={24} color="#fff" />
          </Pressable>
          <View style={styles.flex} accessibilityLiveRegion="polite">
            <AppText variant="bodyStrong" style={styles.onDark}>{headline}</AppText>
            <AppText variant="caption" style={{ color: "rgba(255,255,255,0.7)" }} numberOfLines={1}>
              {view?.emergency?.title ?? "Emergency"} · case #{active.emergencyId.slice(-6).toUpperCase()}
            </AppText>
          </View>
        </View>

        {!!media.local.notice && (
          <View style={[styles.notice, { backgroundColor: colors.accentSoft }]}>
            <AppText variant="caption" tone="accent">{media.local.notice}</AppText>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.grid}>
          {media.peers.length === 0 ? (
            <View style={styles.waiting}>
              <AppText variant="body" style={styles.onDark} align="center">
                {media.connection === "connected" ? "Nobody else is connected yet. Stay on the line." : "Setting up your camera and microphone…"}
              </AppText>
            </View>
          ) : (
            media.peers.map((peer) => {
              const participant = byUser.get(peer.userId);
              const label = [participant?.inviteStatus === "caller" ? "Caller" : ROLE_NAMES[peer.role] ?? peer.role, peer.organization].filter(Boolean).join(" · ");
              return <PeerTile key={peer.peerId} peer={peer} label={label} />;
            })
          )}
        </ScrollView>

        {localVideo && media.local.cameraOn && (
          <View style={styles.selfView} accessibilityLabel="Your camera">
            <StreamView track={localVideo} mirror style={StyleSheet.absoluteFill} />
          </View>
        )}

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={media.local.micOn ? "Mute microphone" : "Unmute microphone"}
            accessibilityState={{ disabled: !media.local.audioAvailable }}
            disabled={!media.local.audioAvailable || !live}
            onPress={() => setMic(!media.local.micOn)}
            style={[styles.round, { backgroundColor: media.local.micOn ? "#262626" : colors.danger, opacity: media.local.audioAvailable ? 1 : 0.4 }]}
          >
            {media.local.micOn ? <Mic size={24} color="#fff" /> : <MicOff size={24} color="#fff" />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={media.local.cameraOn ? "Turn camera off" : "Turn camera on"}
            disabled={!media.local.videoAvailable || !live}
            onPress={() => setCamera(!media.local.cameraOn)}
            style={[styles.round, { backgroundColor: media.local.cameraOn ? "#262626" : colors.danger, opacity: media.local.videoAvailable ? 1 : 0.4 }]}
          >
            {media.local.cameraOn ? <Video size={24} color="#fff" /> : <VideoOff size={24} color="#fff" />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={live ? "Leave call" : "Close"}
            onPress={() => void leave()}
            style={[styles.round, styles.hangUp, { backgroundColor: colors.danger }]}
          >
            <PhoneOff size={26} color="#fff" />
          </Pressable>
        </View>
        {isCaller && view?.status === "ringing" && live && (
          <View style={styles.cancelRow}>
            <Button label="Cancel call (keep my SOS active)" variant="ghost" onPress={() => void cancel()} />
          </View>
        )}
        <AppText variant="caption" align="center" style={{ color: "rgba(255,255,255,0.6)", marginTop: space.xs }}>
          Leaving the call doesn’t close your emergency. Video and audio aren’t recorded.
        </AppText>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: space.md },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  onDark: { color: "#FFFFFF" },
  notice: { borderRadius: radius.md, padding: space.sm, marginBottom: space.sm },
  grid: { gap: space.sm, paddingBottom: 140 },
  tile: { height: 240, borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end" },
  avatar: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  caption: { flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.sm, backgroundColor: "rgba(0,0,0,0.45)" },
  waiting: { height: 240, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", padding: space.lg, backgroundColor: "#171717" },
  selfView: { position: "absolute", right: space.md, bottom: 170, width: 110, height: 150, borderRadius: radius.md, overflow: "hidden", borderWidth: 2, borderColor: "#fff" },
  controls: { flexDirection: "row", justifyContent: "center", gap: space.lg, paddingTop: space.md },
  round: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  hangUp: { width: 68, height: 68, borderRadius: 34 },
  cancelRow: { marginTop: space.xs },
  bar: { position: "absolute", left: space.md, right: space.md, minHeight: 48, borderRadius: radius.pill, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.sm, zIndex: 60 },
});
