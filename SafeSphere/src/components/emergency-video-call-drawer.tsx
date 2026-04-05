import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, NativeModules, Pressable, ScrollView, Text, UIManager, View } from "react-native";
import {
  TwilioVideo,
  TwilioVideoLocalView,
  TwilioVideoParticipantView,
} from "react-native-twilio-video-webrtc";
import { Camera } from "expo-camera";

import { getEmergencyVideoToken } from "../lib/api";

type RemoteTrack = {
  participantSid: string;
  videoTrackSid: string;
};

type Props = {
  emergencyId: string;
  visible: boolean;
  autoJoin?: boolean;
  onAutoJoinHandled?: () => void;
  onClose: () => void;
};

const hasTwilioNativeView =
  !!(UIManager as any)?.getViewManagerConfig?.("RNTwilioVideoPreview") ||
  !!(UIManager as any)?.getViewManagerConfig?.("RNTwilioVideoView") ||
  !!(UIManager as any)?.RNTwilioVideoPreview ||
  !!(UIManager as any)?.RNTwilioVideoView ||
  !!(NativeModules as any)?.TwilioVideoModule;

export default function EmergencyVideoCallDrawer({ emergencyId, visible, autoJoin = false, onAutoJoinHandled, onClose }: Props) {
  const twilioRef = useRef<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [roomName, setRoomName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [remoteTracks, setRemoteTracks] = useState<RemoteTrack[]>([]);

  const disconnectRoom = useCallback(() => {
    try {
      twilioRef.current?.disconnect();
    } catch {
      // Ignore disconnect errors to keep drawer close deterministic.
    }
    setConnected(false);
    setConnecting(false);
    setRemoteTracks([]);
  }, []);

  const handleJoin = useCallback(async () => {
    if (!hasTwilioNativeView) {
      setError("Twilio native module is not available in this build. Use a development build instead of Expo Go.");
      return;
    }

    if (!emergencyId) {
      setError("Emergency ID is missing.");
      return;
    }

    try {
      setError("");
      setConnecting(true);

      const [cameraPermission, microphonePermission] = await Promise.all([
        Camera.requestCameraPermissionsAsync(),
        Camera.requestMicrophonePermissionsAsync(),
      ]);

      if (cameraPermission.status !== "granted" || microphonePermission.status !== "granted") {
        setConnecting(false);
        setConnected(false);
        setError("Camera and microphone permissions are required to publish your stream.");
        return;
      }

      const tokenPayload = await getEmergencyVideoToken(emergencyId);
      setRoomName(tokenPayload.roomName);

      twilioRef.current?.connect({
        accessToken: tokenPayload.token,
        roomName: tokenPayload.roomName,
        enableAudio: true,
        enableVideo: true,
      });
    } catch (joinError: any) {
      setConnecting(false);
      setConnected(false);
      setError(joinError?.response?.data?.error || joinError?.message || "Unable to join emergency call.");
    }
  }, [emergencyId]);

  const handleClose = useCallback(() => {
    disconnectRoom();
    onClose();
  }, [disconnectRoom, onClose]);

  useEffect(() => {
    if (!visible || !autoJoin || connecting || connected) return;
    void handleJoin();
    onAutoJoinHandled?.();
  }, [visible, autoJoin, connecting, connected, handleJoin, onAutoJoinHandled]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="max-h-[88%] rounded-t-3xl border border-border bg-card p-5">
          <View className="mb-4 flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Emergency Video Call</Text>
              <Text className="mt-1 text-base font-bold text-foreground">Emergency {emergencyId.slice(-6)}</Text>
              {!!roomName && <Text className="mt-1 text-xs text-muted-foreground">Room: {roomName}</Text>}
            </View>
            <Pressable onPress={handleClose} className="rounded-xl border border-border px-3 py-2">
              <Text className="text-xs font-semibold text-foreground">Close</Text>
            </Pressable>
          </View>

          {!connected ? (
            <Pressable
              onPress={() => void handleJoin()}
              disabled={connecting}
              className={`items-center rounded-2xl px-4 py-3 ${connecting ? "bg-muted" : "bg-primary"}`}
            >
              {connecting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-bold text-primary-foreground">Join Emergency Call</Text>
              )}
            </Pressable>
          ) : (
            <Pressable onPress={disconnectRoom} className="items-center rounded-2xl bg-destructive px-4 py-3">
              <Text className="text-sm font-bold text-white">Leave Call</Text>
            </Pressable>
          )}

          {!!error && <Text className="mt-3 text-xs text-destructive">{error}</Text>}

          {!hasTwilioNativeView ? (
            <View className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Text className="text-xs font-semibold text-amber-800">
                Twilio video native view is unavailable in this runtime.
              </Text>
              <Text className="mt-1 text-xs text-amber-700">
                Build and open a development client to use camera video calls.
              </Text>
            </View>
          ) : (
            <>
              <ScrollView className="mt-4" contentContainerStyle={{ gap: 12 }}>
                <View className="overflow-hidden rounded-2xl border border-border bg-black">
                  <Text className="px-3 py-2 text-xs font-semibold text-white">Your Camera</Text>
                  <TwilioVideoLocalView enabled style={{ width: "100%", height: 220 }} />
                </View>

                {remoteTracks.length === 0 ? (
                  <View className="rounded-2xl border border-border bg-background p-4">
                    <Text className="text-xs text-muted-foreground">Waiting for responders/authority to join this call.</Text>
                  </View>
                ) : (
                  remoteTracks.map((track) => (
                    <View
                      key={`${track.participantSid}:${track.videoTrackSid}`}
                      className="overflow-hidden rounded-2xl border border-border bg-black"
                    >
                      <Text className="px-3 py-2 text-xs font-semibold text-white">Participant {track.participantSid.slice(-6)}</Text>
                      <TwilioVideoParticipantView
                        style={{ width: "100%", height: 220 }}
                        trackIdentifier={{
                          participantSid: track.participantSid,
                          videoTrackSid: track.videoTrackSid,
                        }}
                      />
                    </View>
                  ))
                )}
              </ScrollView>

              <TwilioVideo
                ref={twilioRef}
                onRoomDidConnect={() => {
                  setConnecting(false);
                  setConnected(true);
                  setError("");
                }}
                onRoomDidDisconnect={() => {
                  setConnecting(false);
                  setConnected(false);
                  setRemoteTracks([]);
                }}
                onRoomDidFailToConnect={(event: any) => {
                  setConnecting(false);
                  setConnected(false);
                  setError(event?.error || "Unable to connect to room.");
                }}
                onParticipantAddedVideoTrack={(event: any) => {
                  const participantSid = String(event?.participant?.sid || "");
                  const videoTrackSid = String(event?.track?.trackSid || "");
                  if (!participantSid || !videoTrackSid) return;

                  setRemoteTracks((prev) => {
                    const exists = prev.some(
                      (item) => item.participantSid === participantSid && item.videoTrackSid === videoTrackSid,
                    );
                    if (exists) return prev;
                    return [...prev, { participantSid, videoTrackSid }];
                  });
                }}
                onParticipantRemovedVideoTrack={(event: any) => {
                  const participantSid = String(event?.participant?.sid || "");
                  const videoTrackSid = String(event?.track?.trackSid || "");
                  setRemoteTracks((prev) =>
                    prev.filter(
                      (item) => !(item.participantSid === participantSid && item.videoTrackSid === videoTrackSid),
                    ),
                  );
                }}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
