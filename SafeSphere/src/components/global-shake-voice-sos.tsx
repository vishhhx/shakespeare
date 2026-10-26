import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, DeviceEventEmitter, StyleSheet, Vibration, View } from "react-native";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from "react-native-reanimated";
import { Mic, Send, X } from "lucide-react-native";

import { AuthContext } from "../context/authContext";
import { useActiveCase } from "../context/activeCase";
import {
  enqueueVoiceEmergencyAnalysis,
  getApiErrorMessage,
  getS3UploadUrl,
  getVoiceEmergencyAnalysis,
  initiateEmergency,
  newClientRequestId,
} from "../lib/api";
import type { EmergencySeverity, EmergencyType } from "../lib/emergencyTypes";
import { EMERGENCY_TYPE_LABELS, SEVERITY_LABELS } from "../lib/emergencyTypes";
import { radius, shadow, space, useTheme } from "../theme";
import { AppText, Button } from "./ui";

/** Emitted by the shake listener and the voice SOS button. */
export const VOICE_SOS_EVENT = "voice-sos-start-requested";

type Analysis = {
  status: "pending" | "success" | "failed";
  analysis?: { severity?: EmergencySeverity; type?: EmergencyType };
  transcribedText?: string;
};

type Stage =
  | { name: "idle" }
  | { name: "arming"; seconds: number }
  | { name: "recording"; elapsed: number }
  | { name: "uploading" }
  | { name: "analyzing" }
  | { name: "countdown"; seconds: number; analysis: Analysis | null }
  | { name: "sending" }
  | { name: "failed"; message: string; canSendWithoutVoice: boolean };

const EMERGENCY_TYPES: EmergencyType[] = ["medical", "fire", "crime", "accident", "missing_child", "other"];
const SEVERITIES: EmergencySeverity[] = ["low", "medium", "high", "critical"];

// Existing two-stage behaviour: a 20 s arming window (so an accidental shake can be cancelled
// before the microphone opens), 10–20 s of recording, analysis, then a short final countdown.
const ARMING_SECONDS = 20;
const MIN_RECORDING_SECONDS = 10;
const MAX_RECORDING_SECONDS = 20;
const FINAL_COUNTDOWN_SECONDS = 5;
const ANALYSIS_POLL_MS = 1500;
const ANALYSIS_MAX_POLLS = 16;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function GlobalShakeVoiceSOS() {
  const { isAuthenticated, userDetails } = useContext(AuthContext);
  const { active, refresh: refreshActiveCase } = useActiveCase();
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();

  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const stageRef = useRef<Stage>(stage);
  stageRef.current = stage;

  // Every SOS run gets an id. Cancelling bumps it, and any async step that finishes afterwards
  // sees a stale id and stops, so a cancelled SOS can never be sent.
  const runIdRef = useRef(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef<string>("");

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopRecorder = async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // already stopped
      }
    }
    return recording;
  };

  const reset = useCallback(async () => {
    runIdRef.current += 1;
    clearTimer();
    Vibration.cancel();
    await stopRecorder();
    setStage({ name: "idle" });
  }, []);

  const isCurrent = (runId: number) => runId === runIdRef.current;

  const getLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return null;
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
      wait(10000).then(() => null),
    ]);
    const position = fresh ?? (await Location.getLastKnownPositionAsync().catch(() => null));
    return position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
  };

  const send = useCallback(async (runId: number, analysis: Analysis | null) => {
    setStage({ name: "sending" });
    try {
      const location = await getLocation();
      if (!isCurrent(runId)) return;
      if (!location) {
        setStage({
          name: "failed",
          message: "We couldn't get your location. Turn on location services, then send again.",
          canSendWithoutVoice: true,
        });
        return;
      }

      const type = EMERGENCY_TYPES.includes(analysis?.analysis?.type as EmergencyType)
        ? (analysis!.analysis!.type as EmergencyType)
        : "medical";
      const severity = SEVERITIES.includes(analysis?.analysis?.severity as EmergencySeverity)
        ? (analysis!.analysis!.severity as EmergencySeverity)
        : "critical";
      const transcript = String(analysis?.transcribedText || "").trim();

      const result = await initiateEmergency({
        title: transcript ? (transcript.length > 72 ? `${transcript.slice(0, 72)}…` : transcript) : "Voice SOS",
        description: transcript || "Voice SOS sent without a transcript.",
        type,
        severity,
        relationToVictim: "self",
        isForSelf: true,
        location,
        victimsCount: 1,
        condition: transcript || undefined,
        clientRequestId: requestIdRef.current,
      });
      if (!isCurrent(runId)) return;

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await reset();
      void refreshActiveCase();
      router.push({ pathname: "/case", params: { emergencyId: result.emergencyId, justSent: result.kind === "created" ? "1" : "0" } });
    } catch (error) {
      if (!isCurrent(runId)) return;
      setStage({ name: "failed", message: getApiErrorMessage(error, "Your SOS was not sent."), canSendWithoutVoice: true });
    }
  }, [refreshActiveCase, reset]);

  const startFinalCountdown = useCallback((runId: number, analysis: Analysis | null) => {
    clearTimer();
    let seconds = FINAL_COUNTDOWN_SECONDS;
    setStage({ name: "countdown", seconds, analysis });
    timerRef.current = setInterval(() => {
      if (!isCurrent(runId)) return clearTimer();
      seconds -= 1;
      if (seconds <= 0) {
        clearTimer();
        void send(runId, analysis);
        return;
      }
      setStage({ name: "countdown", seconds, analysis });
    }, 1000);
  }, [send]);

  const finishRecording = useCallback(async (runId: number) => {
    clearTimer();
    setStage({ name: "uploading" });
    try {
      const recording = await stopRecorder();
      const uri = recording?.getURI();
      if (!uri) throw new Error("The recording could not be saved.");

      const userId = String(userDetails?.userId || "");
      const fileKey = `voice/emergency/${userId}/${Date.now()}.m4a`;
      const { url } = await getS3UploadUrl({ key: fileKey, contentType: "audio/mp4", bucket: "voice" });
      const blob = await (await fetch(uri)).blob();
      const upload = await fetch(url, { method: "PUT", headers: { "Content-Type": "audio/mp4" }, body: blob });
      if (!upload.ok) throw new Error("Uploading the recording failed.");
      if (!isCurrent(runId)) return;

      await enqueueVoiceEmergencyAnalysis(fileKey);
      if (!isCurrent(runId)) return;
      setStage({ name: "analyzing" });

      for (let attempt = 0; attempt < ANALYSIS_MAX_POLLS; attempt += 1) {
        const analysis = (await getVoiceEmergencyAnalysis(fileKey)) as Analysis;
        if (!isCurrent(runId)) return;
        if (analysis.status === "success") {
          startFinalCountdown(runId, analysis);
          return;
        }
        if (analysis.status === "failed") break;
        await wait(ANALYSIS_POLL_MS);
        if (!isCurrent(runId)) return;
      }
      setStage({
        name: "failed",
        message: "We couldn't understand the recording in time. You can still send the SOS now.",
        canSendWithoutVoice: true,
      });
    } catch (error) {
      if (!isCurrent(runId)) return;
      setStage({
        name: "failed",
        message: `${getApiErrorMessage(error, "Processing the recording failed.")} You can still send the SOS now.`,
        canSendWithoutVoice: true,
      });
    }
  }, [startFinalCountdown, userDetails?.userId]);

  const startRecording = useCallback(async (runId: number) => {
    clearTimer();
    Vibration.cancel();
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!isCurrent(runId)) return;
      if (permission.status !== "granted") {
        setStage({
          name: "failed",
          message: "Microphone access is off, so we can't record. You can still send the SOS without a voice note.",
          canSendWithoutVoice: true,
        });
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      if (!isCurrent(runId)) {
        await recording.stopAndUnloadAsync().catch(() => undefined);
        return;
      }
      recordingRef.current = recording;

      let elapsed = 0;
      setStage({ name: "recording", elapsed });
      timerRef.current = setInterval(() => {
        if (!isCurrent(runId)) return clearTimer();
        elapsed += 1;
        if (elapsed >= MAX_RECORDING_SECONDS) {
          void finishRecording(runId);
          return;
        }
        setStage({ name: "recording", elapsed });
      }, 1000);
    } catch {
      if (!isCurrent(runId)) return;
      setStage({
        name: "failed",
        message: "The microphone couldn't start. You can still send the SOS without a voice note.",
        canSendWithoutVoice: true,
      });
    }
  }, [finishRecording]);

  const startArming = useCallback(() => {
    if (!isAuthenticated || !userDetails?.userId || stageRef.current.name !== "idle") return;

    // Already have an open case? Take the person there instead of starting a second SOS.
    if (active?.asReporter) {
      router.push({ pathname: "/case", params: { emergencyId: active.asReporter.emergencyId } });
      return;
    }

    runIdRef.current += 1;
    const runId = runIdRef.current;
    requestIdRef.current = newClientRequestId();
    let seconds = ARMING_SECONDS;
    setStage({ name: "arming", seconds });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.vibrate([0, 300, 600], true);
    timerRef.current = setInterval(() => {
      if (!isCurrent(runId)) return clearTimer();
      seconds -= 1;
      if (seconds <= 0) {
        void startRecording(runId);
        return;
      }
      setStage({ name: "arming", seconds });
    }, 1000);
  }, [active?.asReporter, isAuthenticated, startRecording, userDetails?.userId]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(VOICE_SOS_EVENT, startArming);
    return () => subscription.remove();
  }, [startArming]);

  useEffect(() => () => void reset(), [reset]);

  if (stage.name === "idle") return null;

  const runId = runIdRef.current;
  const header = {
    arming: "Voice SOS starting",
    recording: "Listening",
    uploading: "Saving your recording",
    analyzing: "Understanding the emergency",
    countdown: "Sending your SOS",
    sending: "Sending your SOS",
    failed: "SOS not sent yet",
  }[stage.name];

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(180)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <View
        style={[styles.card, shadow, { backgroundColor: colors.surface, borderColor: colors.danger }]}
        accessibilityLiveRegion="polite"
        accessibilityViewIsModal
      >
        <View style={styles.header}>
          <View style={[styles.dot, { backgroundColor: colors.danger }]} />
          <AppText variant="overline" tone="danger">
            {header.toUpperCase()}
          </AppText>
        </View>

        {stage.name === "arming" && (
          <>
            <AppText variant="display" tone="danger">{stage.seconds}s</AppText>
            <AppText variant="body">
              The microphone opens when the countdown ends. Then tell us what is happening.
            </AppText>
            <AppText variant="caption" tone="muted">Shook your phone by mistake? Cancel now.</AppText>
          </>
        )}

        {stage.name === "recording" && (
          <>
            <View style={styles.row}>
              <Mic size={20} color={colors.danger} aria-hidden />
              <AppText variant="headline">Speak now · {MAX_RECORDING_SECONDS - stage.elapsed}s left</AppText>
            </View>
            <View style={[styles.track, { backgroundColor: colors.dangerSoft }]}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: colors.danger, width: `${Math.min(100, (stage.elapsed / MAX_RECORDING_SECONDS) * 100)}%` },
                ]}
              />
            </View>
            <AppText variant="caption" tone="muted">
              Say what happened, where you are and if anyone is hurt.
            </AppText>
          </>
        )}

        {(stage.name === "uploading" || stage.name === "analyzing" || stage.name === "sending") && (
          <View style={styles.row}>
            <ActivityIndicator color={colors.danger} />
            <AppText variant="body" style={styles.flex}>
              {stage.name === "uploading"
                ? "Uploading your voice note securely."
                : stage.name === "analyzing"
                  ? "Working out the emergency type and severity from your voice note."
                  : "Getting your location and alerting people who can help."}
            </AppText>
          </View>
        )}

        {stage.name === "countdown" && (
          <>
            <AppText variant="display" tone="danger">{stage.seconds}s</AppText>
            <AppText variant="bodyStrong">
              {stage.analysis?.analysis?.type ? EMERGENCY_TYPE_LABELS[stage.analysis.analysis.type] : "Emergency"}
              {stage.analysis?.analysis?.severity ? ` · ${SEVERITY_LABELS[stage.analysis.analysis.severity]}` : ""}
            </AppText>
            {!!stage.analysis?.transcribedText && (
              <AppText variant="caption" tone="muted" numberOfLines={3}>
                “{stage.analysis.transcribedText}”
              </AppText>
            )}
          </>
        )}

        {stage.name === "failed" && <AppText variant="body">{stage.message}</AppText>}

        {(stage.name === "countdown" || stage.name === "sending" || stage.name === "failed") && (
          <AppText variant="caption" tone="muted">
            Nearby volunteers and authorities get an in-app alert. Your emergency contacts get an SMS with your location.
          </AppText>
        )}

        <View style={styles.actions}>
          {stage.name === "arming" && (
            <Button label="Start recording now" icon={Mic} variant="danger" onPress={() => void startRecording(runId)} />
          )}
          {stage.name === "recording" && stage.elapsed >= MIN_RECORDING_SECONDS && (
            <Button label="Done speaking" variant="danger" onPress={() => void finishRecording(runId)} />
          )}
          {stage.name === "countdown" && (
            <Button label="Send now" icon={Send} variant="danger" onPress={() => { clearTimer(); void send(runId, stage.analysis); }} />
          )}
          {stage.name === "failed" && stage.canSendWithoutVoice && (
            <Button label="Send SOS now" icon={Send} variant="danger" onPress={() => void send(runId, null)} />
          )}
          {stage.name !== "sending" && (
            <Button label={stage.name === "failed" ? "Close" : "Cancel SOS"} icon={X} variant="secondary" onPress={() => void reset()} />
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.md, right: space.md, bottom: 96, zIndex: 50 },
  card: { borderWidth: 2, borderRadius: radius.xl, padding: space.lg, gap: space.sm },
  header: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  flex: { flex: 1 },
  track: { height: 8, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
  actions: { gap: space.xs, marginTop: space.xs },
});
