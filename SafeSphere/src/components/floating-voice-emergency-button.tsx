import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, Vibration, View } from "react-native";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

type Props = {
  minSeconds?: number;
  maxSeconds?: number;
  onEmergencyCreated?: (args: { emergencyId: string; analysis: AnalysisResponse }) => void;
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
const VOICE_SOS_AUTO_START_KEY = "voiceSOSAutoStart";
const PRE_MIC_COUNTDOWN_SECONDS = 20;
const AUTO_TRIGGER_AFTER_ANALYSIS_SECONDS = 8;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function FloatingVoiceEmergencyButton({
  minSeconds = 10,
  maxSeconds = 30,
  onEmergencyCreated,
}: Props) {
  const { userDetails } = useContext(AuthContext);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const armingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stage, setStage] = useState<"idle" | "arming" | "uploading" | "analyzing" | "countdown" | "creating">("idle");
  const [armingSeconds, setArmingSeconds] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [analysisToUse, setAnalysisToUse] = useState<AnalysisResponse | null>(null);

  const isBusy = stage !== "idle" && stage !== "countdown";

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

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownSeconds(0);
    setAnalysisToUse(null);
    setStage("idle");
  }, []);

  const cancelArming = useCallback(() => {
    if (armingTimerRef.current) {
      clearInterval(armingTimerRef.current);
      armingTimerRef.current = null;
    }
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    Vibration.cancel();
    setArmingSeconds(0);
    setStage("idle");
  }, []);

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

  const buildEmergencyPayload = useCallback(async (analysis: AnalysisResponse) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      throw new Error("Location permission is required to trigger emergency.");
    }

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const type = EMERGENCY_TYPES.includes((analysis.analysis?.type as any) || "")
      ? (analysis.analysis?.type as any)
      : "medical";

    const severity = EMERGENCY_SEVERITIES.includes((analysis.analysis?.severity as any) || "")
      ? (analysis.analysis?.severity as any)
      : "critical";

    const transcribedText = String(analysis.transcribedText || "Emergency voice distress reported").trim();
    const shortTitle = transcribedText.length > 72 ? `${transcribedText.slice(0, 72)}...` : transcribedText;

    return {
      title: shortTitle || "Voice Emergency Alert",
      description: transcribedText,
      type,
      severity,
      relationToVictim: "self" as const,
      isForSelf: true,
      location: {
        lat: current.coords.latitude,
        lng: current.coords.longitude,
      },
      victimsCount: 1,
      condition: transcribedText,
    };
  }, []);

  const triggerEmergencyFromVoice = useCallback(async (analysis: AnalysisResponse) => {
    try {
      setStage("creating");
      const payload = await buildEmergencyPayload(analysis);
      const response = await initiateEmergency(payload);
      onEmergencyCreated?.({ emergencyId: response.emergencyId, analysis });
      Alert.alert("Emergency Triggered", `Emergency created from voice analysis. ID: ${response.emergencyId}`);
      router.push({ pathname: "/case", params: { emergencyId: response.emergencyId } });
    } catch (error: any) {
      Alert.alert("Voice Emergency Failed", error?.response?.data?.error || error?.message || "Unable to trigger emergency.");
    } finally {
      setStage("idle");
      setAnalysisToUse(null);
      setCountdownSeconds(0);
    }
  }, [buildEmergencyPayload, onEmergencyCreated]);

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
          void triggerEmergencyFromVoice(analysisToUse);
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
  }, [stage, countdownSeconds, analysisToUse, triggerEmergencyFromVoice]);

  const stopRecordingAndProcess = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    cleanupTimers();
    setIsRecording(false);

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

      // Fast-path UX: start a short auto-trigger countdown immediately after analysis.
      setStage("countdown");
      setCountdownSeconds(AUTO_TRIGGER_AFTER_ANALYSIS_SECONDS);
    } catch (error: any) {
      setStage("idle");
      setAnalysisToUse(null);
      Alert.alert("Voice Processing Failed", error?.response?.data?.error || error?.message || "Unable to process voice emergency.");
    }
  }, [cleanupTimers, pollVoiceAnalysis, userDetails?.userId]);

  const startRecording = useCallback(async () => {
    try {
      if (armingTimerRef.current) {
        clearInterval(armingTimerRef.current);
        armingTimerRef.current = null;
      }
      if (vibrationTimerRef.current) {
        clearInterval(vibrationTimerRef.current);
        vibrationTimerRef.current = null;
      }
      Vibration.cancel();
      setArmingSeconds(0);

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission Needed", "Microphone permission is required.");
        setStage("idle");
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
      setIsRecording(true);
      setStage("idle");

      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);

      autoStopTimerRef.current = setTimeout(() => {
        void stopRecordingAndProcess();
      }, maxSeconds * 1000);
    } catch (error: any) {
      Alert.alert("Recorder Error", error?.message || "Unable to start recording.");
      cleanupTimers();
      setIsRecording(false);
      setStage("idle");
    }
  }, [cleanupTimers, maxSeconds, stopRecordingAndProcess]);

  const startArmingCountdown = useCallback(() => {
    if (isRecording || isBusy || stage !== "idle") {
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
  }, [isBusy, isRecording, stage, startRecording]);

  const onMainPress = useCallback(() => {
    if (isBusy) return;

    if (isRecording) {
      if (elapsedSeconds < minSeconds) {
        Alert.alert("Keep Recording", `Please record at least ${minSeconds} seconds.`);
        return;
      }
      void stopRecordingAndProcess();
      return;
    }

    startArmingCountdown();
  }, [elapsedSeconds, isBusy, isRecording, minSeconds, startArmingCountdown, stopRecordingAndProcess]);

  useEffect(() => {
    return () => {
      cleanupTimers();
      const recording = recordingRef.current;
      if (recording) {
        void recording.stopAndUnloadAsync();
      }
    };
  }, [cleanupTimers]);

  useEffect(() => {
    let mounted = true;

    const maybeAutoStart = async () => {
      const marker = await AsyncStorage.getItem(VOICE_SOS_AUTO_START_KEY);
      if (!marker || !mounted) {
        return;
      }

      await AsyncStorage.removeItem(VOICE_SOS_AUTO_START_KEY);
      startArmingCountdown();
    };

    void maybeAutoStart();

    return () => {
      mounted = false;
    };
  }, [startArmingCountdown]);

  const label = useMemo(() => {
    if (isRecording) return `Stop (${elapsedSeconds}s)`;
    if (stage === "uploading") return "Uploading...";
    if (stage === "analyzing") return "Analyzing...";
    if (stage === "creating") return "Creating emergency...";
    if (stage === "arming") return `Arming ${armingSeconds}s`;
    return "Voice SOS";
  }, [armingSeconds, elapsedSeconds, isRecording, stage]);

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 18, bottom: 24 }}>
      {stage === "arming" && armingSeconds > 0 && (
        <View className="mb-3 min-w-[220px] rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-center text-xs font-semibold text-red-700">Voice SOS starts in {armingSeconds}s</Text>
          <Text className="mt-1 text-center text-[11px] text-red-700">Phone vibrating. Mic will open automatically.</Text>
          <View className="mt-2 flex-row gap-2">
            <Pressable onPress={cancelArming} className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-2">
              <Text className="text-center text-xs font-semibold text-red-700">Cancel</Text>
            </Pressable>
            <Pressable onPress={() => void startRecording()} className="flex-1 rounded-lg bg-red-600 px-3 py-2">
              <Text className="text-center text-xs font-semibold text-white">Send It Now</Text>
            </Pressable>
          </View>
        </View>
      )}

      {stage === "countdown" && countdownSeconds > 0 && (
        <View className="mb-3 min-w-[180px] rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-center text-xs font-semibold text-red-700">Auto emergency in {countdownSeconds}s</Text>
          <View className="mt-2 flex-row gap-2">
            <Pressable
              onPress={() => {
                if (analysisToUse) {
                  void triggerEmergencyFromVoice(analysisToUse);
                }
              }}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2"
            >
              <Text className="text-center text-xs font-semibold text-white">Trigger Now</Text>
            </Pressable>
            <Pressable onPress={cancelCountdown} className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-2">
              <Text className="text-center text-xs font-semibold text-red-700">Stop</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable
        onPress={onMainPress}
        disabled={isBusy}
        className={`min-w-[126px] flex-row items-center justify-center gap-2 rounded-full px-4 py-4 ${
          isRecording ? "bg-red-600" : isBusy ? "bg-muted" : "bg-primary"
        }`}
        style={{ elevation: 7 }}
      >
        {isBusy ? <ActivityIndicator color="#fff" /> : <Text className="text-base">🎙️</Text>}
        <Text className="text-sm font-bold text-primary-foreground">{label}</Text>
      </Pressable>
      {!isRecording && stage === "idle" && (
        <Text className="mt-2 text-center text-[11px] text-muted-foreground">20s arm, then 10-30s voice evidence</Text>
      )}
    </View>
  );
}
