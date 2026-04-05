import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, DeviceEventEmitter, Pressable, Text, Vibration, View } from "react-native";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import { router } from "expo-router";

import { AuthContext } from "../context/authContext";
import {
  enqueueVoiceEmergencyAnalysis,
  getS3UploadUrl,
  getVoiceEmergencyAnalysis,
  initiateEmergency,
} from "../lib/api";

type AnalysisResponse = {
  status: "pending" | "success" | "failed";
  analysis?: {
    severity?: "low" | "medium" | "high" | "critical";
    type?: "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
  };
  fileKey?: string;
  fileName?: string;
  transcribedText?: string;
};

const EMERGENCY_TYPES: ("medical" | "fire" | "crime" | "accident" | "missing_child" | "other")[] = [
  "medical",
  "fire",
  "crime",
  "accident",
  "missing_child",
  "other",
];
const EMERGENCY_SEVERITIES: ("low" | "medium" | "high" | "critical")[] = ["low", "medium", "high", "critical"];

const PRE_MIC_COUNTDOWN_SECONDS = 20;
const MIN_SECONDS = 10;
const MAX_SECONDS = 20;
const AUTO_TRIGGER_AFTER_ANALYSIS_SECONDS = 5;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Stage = "idle" | "arming" | "recording" | "uploading" | "analyzing" | "countdown" | "creating";

export default function GlobalShakeVoiceSOS() {
  const { isAuthenticated, userDetails } = useContext(AuthContext);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const armingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [armingSeconds, setArmingSeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [analysisToUse, setAnalysisToUse] = useState<AnalysisResponse | null>(null);

  const visible = stage !== "idle";

  const cleanupTimers = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (armingTimerRef.current) {
      clearInterval(armingTimerRef.current);
      armingTimerRef.current = null;
    }
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    Vibration.cancel();
  }, []);

  const fullReset = useCallback(async () => {
    cleanupTimers();
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // Ignore stop failures while resetting.
      }
    }

    setStage("idle");
    setArmingSeconds(0);
    setElapsedSeconds(0);
    setCountdownSeconds(0);
    setAnalysisToUse(null);
  }, [cleanupTimers]);

  const triggerEmergencyFromAnalysis = useCallback(async (analysis: AnalysisResponse) => {
    try {
      setStage("creating");

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        throw new Error("Location permission is required to trigger emergency.");
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const type = EMERGENCY_TYPES.includes((analysis.analysis?.type as any) || "")
        ? (analysis.analysis?.type as any)
        : "medical";
      const severity = EMERGENCY_SEVERITIES.includes((analysis.analysis?.severity as any) || "")
        ? (analysis.analysis?.severity as any)
        : "critical";

      const transcribedText = String(analysis.transcribedText || "Emergency voice distress reported").trim();
      const shortTitle = transcribedText.length > 72 ? `${transcribedText.slice(0, 72)}...` : transcribedText;

      const response = await initiateEmergency({
        title: shortTitle || "Voice Emergency Alert",
        description: transcribedText,
        type,
        severity,
        relationToVictim: "self",
        isForSelf: true,
        location: {
          lat: current.coords.latitude,
          lng: current.coords.longitude,
        },
        victimsCount: 1,
        condition: transcribedText,
      });

      Alert.alert("Emergency Triggered", `Emergency created from shake SOS. ID: ${response.emergencyId}`);
      await fullReset();
      router.push({ pathname: "/case", params: { emergencyId: response.emergencyId } });
    } catch (error: any) {
      Alert.alert("Voice SOS Failed", error?.response?.data?.error || error?.message || "Unable to trigger emergency.");
      await fullReset();
    }
  }, [fullReset]);

  const pollVoiceAnalysis = useCallback(async (fileKey: string) => {
    const maxPollAttempts = 16;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const analysis = await getVoiceEmergencyAnalysis(fileKey);
      if (analysis.status === "success") {
        return analysis;
      }
      await wait(1500);
    }
    throw new Error("Voice analysis is taking too long. Please try again.");
  }, []);

  const stopRecordingAndProcess = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }

    cleanupTimers();

    try {
      setStage("uploading");
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      if (!uri) {
        throw new Error("Recording file is unavailable.");
      }

      const userId = String(userDetails?.userId || "").trim();
      if (!userId) {
        throw new Error("User session missing. Please login again.");
      }

      const fileKey = `voice/emergency/${userId}/${Date.now()}.m4a`;
      const { url } = await getS3UploadUrl({
        key: fileKey,
        contentType: "audio/mp4",
        bucket: "voice",
      });

      const blob = await (await fetch(uri)).blob();
      const uploadResponse = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "audio/mp4" },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload voice recording.");
      }

      await enqueueVoiceEmergencyAnalysis(fileKey);

      setStage("analyzing");
      const analysis = await pollVoiceAnalysis(fileKey);
      setAnalysisToUse(analysis);
      setStage("countdown");
      setCountdownSeconds(AUTO_TRIGGER_AFTER_ANALYSIS_SECONDS);
    } catch (error: any) {
      Alert.alert("Voice SOS Failed", error?.response?.data?.error || error?.message || "Unable to process shake SOS.");
      await fullReset();
    }
  }, [cleanupTimers, fullReset, pollVoiceAnalysis, userDetails?.userId]);

  const startRecording = useCallback(async () => {
    if (!isAuthenticated || !userDetails?.userId) {
      return;
    }

    if (!(stage === "idle" || stage === "arming")) {
      return;
    }

    try {
      if (armingTimerRef.current) {
        clearInterval(armingTimerRef.current);
        armingTimerRef.current = null;
      }
      setArmingSeconds(0);
      Vibration.cancel();
      if (vibrationTimerRef.current) {
        clearInterval(vibrationTimerRef.current);
        vibrationTimerRef.current = null;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission Needed", "Microphone permission is required.");
        await fullReset();
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

      recordingRef.current = recording;
      setElapsedSeconds(0);
      setStage("recording");

      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);

      autoStopTimerRef.current = setTimeout(() => {
        void stopRecordingAndProcess();
      }, MAX_SECONDS * 1000);
    } catch (error: any) {
      Alert.alert("Recorder Error", error?.message || "Unable to start recording.");
      await fullReset();
    }
  }, [fullReset, isAuthenticated, stage, stopRecordingAndProcess, userDetails?.userId]);

  const startArmingCountdown = useCallback(() => {
    if (!isAuthenticated || !userDetails?.userId || stage !== "idle") {
      return;
    }

    setStage("arming");
    setArmingSeconds(PRE_MIC_COUNTDOWN_SECONDS);

    Vibration.vibrate(350);
    vibrationTimerRef.current = setInterval(() => {
      Vibration.vibrate(250);
    }, 900);

    armingTimerRef.current = setInterval(() => {
      setArmingSeconds((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (armingTimerRef.current) {
            clearInterval(armingTimerRef.current);
            armingTimerRef.current = null;
          }
          void startRecording();
          return 0;
        }
        return next;
      });
    }, 1000);
  }, [isAuthenticated, stage, startRecording, userDetails?.userId]);

  const handleStop = useCallback(async () => {
    if (stage === "recording") {
      if (elapsedSeconds >= MIN_SECONDS) {
        await stopRecordingAndProcess();
        return;
      }
      Alert.alert("Keep Recording", `You can stop after ${MIN_SECONDS} seconds.`);
      return;
    }

    if (stage === "arming") {
      await fullReset();
      return;
    }

    if (stage === "countdown") {
      await fullReset();
      return;
    }

    if (stage !== "idle") {
      await fullReset();
    }
  }, [elapsedSeconds, fullReset, stage, stopRecordingAndProcess]);

  useEffect(() => {
    if (stage !== "countdown" || countdownSeconds <= 0 || !analysisToUse) {
      return;
    }

    countdownTimerRef.current = setInterval(() => {
      setCountdownSeconds((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          void triggerEmergencyFromAnalysis(analysisToUse);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [analysisToUse, countdownSeconds, stage, triggerEmergencyFromAnalysis]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener("voice-sos-start-requested", () => {
      startArmingCountdown();
    });

    return () => {
      subscription.remove();
    };
  }, [startArmingCountdown]);

  useEffect(() => {
    return () => {
      void fullReset();
    };
  }, [fullReset]);

  const recordingRemaining = useMemo(() => Math.max(0, MAX_SECONDS - elapsedSeconds), [elapsedSeconds]);

  if (!visible) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 14, right: 14, bottom: 96, zIndex: 50 }}>
      <View className="rounded-2xl border border-red-200 bg-red-50 p-4">
        {stage === "recording" && (
          <>
            <Text className="text-center text-xs font-semibold uppercase tracking-[0.12em] text-red-700">Shake SOS Recording Live</Text>
            <Text className="mt-1 text-center text-3xl font-black text-red-700">{recordingRemaining}s</Text>
            <Text className="mt-1 text-center text-xs text-red-700">Min {MIN_SECONDS}s required</Text>
          </>
        )}

        {stage === "arming" && (
          <>
            <Text className="text-center text-xs font-semibold uppercase tracking-[0.12em] text-red-700">Shake SOS Armed</Text>
            <Text className="mt-1 text-center text-3xl font-black text-red-700">{armingSeconds}s</Text>
            <Text className="mt-1 text-center text-xs text-red-700">Mic will open automatically at 0 · phone is vibrating</Text>
          </>
        )}

        {stage === "uploading" && (
          <View className="items-center py-2">
            <ActivityIndicator color="#b91c1c" />
            <Text className="mt-2 text-xs font-semibold text-red-700">Uploading voice evidence...</Text>
          </View>
        )}

        {stage === "analyzing" && (
          <View className="items-center py-2">
            <ActivityIndicator color="#b91c1c" />
            <Text className="mt-2 text-xs font-semibold text-red-700">Analyzing from Python API...</Text>
          </View>
        )}

        {stage === "countdown" && (
          <>
            <Text className="text-center text-xs font-semibold uppercase tracking-[0.12em] text-red-700">Auto Triggering Emergency</Text>
            <Text className="mt-1 text-center text-3xl font-black text-red-700">{countdownSeconds}s</Text>
          </>
        )}

        {stage === "creating" && (
          <View className="items-center py-2">
            <ActivityIndicator color="#b91c1c" />
            <Text className="mt-2 text-xs font-semibold text-red-700">Creating emergency case...</Text>
          </View>
        )}

        {stage !== "creating" && (
          <Pressable
            onPress={() => void handleStop()}
            disabled={stage === "recording" && elapsedSeconds < MIN_SECONDS}
            className={`mt-3 items-center rounded-xl border px-4 py-3 ${
              stage === "recording" && elapsedSeconds < MIN_SECONDS
                ? "border-red-200 bg-red-100"
                : "border-red-300 bg-white"
            }`}
          >
            <Text
              className={`text-sm font-bold ${
                stage === "recording" && elapsedSeconds < MIN_SECONDS ? "text-red-400" : "text-red-700"
              }`}
            >
              {stage === "recording" && elapsedSeconds < MIN_SECONDS
                ? `Stop after ${MIN_SECONDS - elapsedSeconds}s`
                : stage === "arming"
                  ? "Cancel"
                  : "Stop"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
