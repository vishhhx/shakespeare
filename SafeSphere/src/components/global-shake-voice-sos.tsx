import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Pressable,
  Text,
  Vibration,
  View,
} from "react-native";
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
    type?:
      | "medical"
      | "fire"
      | "crime"
      | "accident"
      | "missing_child"
      | "other";
  };
  fileKey?: string;
  fileName?: string;
  transcribedText?: string;
};

const EMERGENCY_TYPES: (
  | "medical"
  | "fire"
  | "crime"
  | "accident"
  | "missing_child"
  | "other"
)[] = ["medical", "fire", "crime", "accident", "missing_child", "other"];
const EMERGENCY_SEVERITIES: ("low" | "medium" | "high" | "critical")[] = [
  "low",
  "medium",
  "high",
  "critical",
];

const PRE_MIC_COUNTDOWN_SECONDS = 20;
const MIN_SECONDS = 10;
const MAX_SECONDS = 20;
const AUTO_TRIGGER_AFTER_ANALYSIS_SECONDS = 5;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Stage =
  | "idle"
  | "arming"
  | "recording"
  | "uploading"
  | "analyzing"
  | "countdown"
  | "creating";

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
  const [analysisToUse, setAnalysisToUse] = useState<AnalysisResponse | null>(
    null,
  );

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

  const triggerEmergencyFromAnalysis = useCallback(
    async (analysis: AnalysisResponse) => {
      try {
        setStage("creating");

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          throw new Error(
            "Location permission is required to trigger emergency.",
          );
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const type = EMERGENCY_TYPES.includes(
          (analysis.analysis?.type as any) || "",
        )
          ? (analysis.analysis?.type as any)
          : "medical";
        const severity = EMERGENCY_SEVERITIES.includes(
          (analysis.analysis?.severity as any) || "",
        )
          ? (analysis.analysis?.severity as any)
          : "critical";

        const transcribedText = String(
          analysis.transcribedText || "Emergency voice distress reported",
        ).trim();
        const shortTitle =
          transcribedText.length > 72
            ? `${transcribedText.slice(0, 72)}...`
            : transcribedText;

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

        Alert.alert(
          "Emergency Triggered",
          `Emergency created from shake SOS. ID: ${response.emergencyId}`,
        );
        await fullReset();
        router.push({
          pathname: "/case",
          params: { emergencyId: response.emergencyId },
        });
      } catch (error: any) {
        Alert.alert(
          "Voice SOS Failed",
          error?.response?.data?.error ||
            error?.message ||
            "Unable to trigger emergency.",
        );
        await fullReset();
      }
    },
    [fullReset],
  );

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
      Alert.alert(
        "Voice SOS Failed",
        error?.response?.data?.error ||
          error?.message ||
          "Unable to process shake SOS.",
      );
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
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
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
      Alert.alert(
        "Recorder Error",
        error?.message || "Unable to start recording.",
      );
      await fullReset();
    }
  }, [
    fullReset,
    isAuthenticated,
    stage,
    stopRecordingAndProcess,
    userDetails?.userId,
  ]);

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
      Alert.alert(
        "Keep Recording",
        `You can stop after ${MIN_SECONDS} seconds.`,
      );
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
    const subscription = DeviceEventEmitter.addListener(
      "voice-sos-start-requested",
      () => {
        startArmingCountdown();
      },
    );

    return () => {
      subscription.remove();
    };
  }, [startArmingCountdown]);

  useEffect(() => {
    return () => {
      void fullReset();
    };
  }, [fullReset]);

  const recordingRemaining = useMemo(
    () => Math.max(0, MAX_SECONDS - elapsedSeconds),
    [elapsedSeconds],
  );

  if (!visible) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 96,
        zIndex: 50,
      }}
    >
      <View className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-lg">
        {/* Header / status */}
        <View className="flex-row items-center justify-between border-b border-red-100 px-4 py-3">
          <View className="flex-row items-center gap-2">
            <View className="h-2.5 w-2.5 rounded-full bg-red-600" />
            <Text className="text-sm font-bold text-gray-900">
              {stage === "recording"
                ? "Recording SOS"
                : stage === "arming"
                  ? "SOS Armed"
                  : stage === "uploading"
                    ? "Uploading"
                    : stage === "analyzing"
                      ? "Analyzing"
                      : stage === "countdown"
                        ? "Emergency Ready"
                        : "Creating Emergency"}
            </Text>
          </View>

          {stage === "recording" && (
            <Text className="text-sm font-semibold text-red-700">
              {recordingRemaining}s left
            </Text>
          )}
        </View>

        {/* Active state */}
        <View className="px-4 py-4">
          {stage === "recording" && (
            <>
              <Text className="text-lg font-bold text-gray-900">
                Tell us what’s happening
              </Text>
              <Text className="mt-1 text-sm leading-5 text-gray-500">
                Keep speaking. Your voice is being recorded as emergency
                evidence.
              </Text>

              <View className="mt-4 h-2 overflow-hidden rounded-full bg-red-100">
                <View
                  className="h-full rounded-full bg-red-600"
                  style={{
                    width: `${Math.min(100, (elapsedSeconds / MAX_SECONDS) * 100)}%`,
                  }}
                />
              </View>

              <Text className="mt-2 text-xs text-gray-500">
                You can stop after {MIN_SECONDS}s.
              </Text>
            </>
          )}

          {stage === "arming" && (
            <>
              <Text className="text-lg font-bold text-gray-900">
                Get ready to speak
              </Text>
              <Text className="mt-1 text-sm leading-5 text-gray-500">
                The microphone will open automatically when the countdown ends.
              </Text>

              <View className="mt-4 items-center">
                <Text className="text-5xl font-black text-red-600">
                  {armingSeconds}
                </Text>
                <Text className="mt-1 text-xs font-medium text-gray-500">
                  Phone vibration is active
                </Text>
              </View>
            </>
          )}

          {stage === "uploading" && (
            <View className="flex-row items-center py-2">
              <ActivityIndicator color="#dc2626" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-gray-900">
                  Saving voice evidence
                </Text>
                <Text className="mt-1 text-xs text-gray-500">
                  This should only take a moment.
                </Text>
              </View>
            </View>
          )}

          {stage === "analyzing" && (
            <View className="flex-row items-center py-2">
              <ActivityIndicator color="#dc2626" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-gray-900">
                  Understanding the emergency
                </Text>
                <Text className="mt-1 text-xs text-gray-500">
                  AI is identifying the emergency type and severity.
                </Text>
              </View>
            </View>
          )}

          {stage === "countdown" && (
            <>
              <Text className="text-lg font-bold text-gray-900">
                Emergency is ready
              </Text>
              <Text className="mt-1 text-sm leading-5 text-gray-500">
                Your voice report has been processed. The emergency will be
                created automatically.
              </Text>

              <View className="mt-4 flex-row items-center rounded-xl bg-red-50 px-4 py-3">
                <Text className="text-3xl font-black text-red-600">
                  {countdownSeconds}
                </Text>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-red-800">
                    Triggering emergency
                  </Text>
                  <Text className="mt-0.5 text-xs text-red-700">
                    Cancel if you triggered SOS by mistake.
                  </Text>
                </View>
              </View>
            </>
          )}

          {stage === "creating" && (
            <View className="flex-row items-center py-2">
              <ActivityIndicator color="#dc2626" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-gray-900">
                  Creating emergency case
                </Text>
                <Text className="mt-1 text-xs text-gray-500">
                  Getting your location and contacting responders.
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Action */}
        {stage !== "creating" && (
          <View className="border-t border-gray-100 px-4 py-3">
            <Pressable
              onPress={() => void handleStop()}
              disabled={stage === "recording" && elapsedSeconds < MIN_SECONDS}
              className={`items-center rounded-xl px-4 py-3 ${
                stage === "recording" && elapsedSeconds < MIN_SECONDS
                  ? "bg-gray-100"
                  : "bg-gray-100"
              }`}
            >
              <Text
                className={`text-sm font-bold ${
                  stage === "recording" && elapsedSeconds < MIN_SECONDS
                    ? "text-gray-400"
                    : "text-gray-800"
                }`}
              >
                {stage === "recording" && elapsedSeconds < MIN_SECONDS
                  ? `Keep recording · ${MIN_SECONDS - elapsedSeconds}s`
                  : stage === "arming"
                    ? "Cancel SOS"
                    : stage === "countdown"
                      ? "Cancel emergency"
                      : "Stop"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
