import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";

import { chatWithEmergencyBot } from "../lib/api";

type MessageItem = {
  id: string;
  role: "user" | "assistant";
  text: string;
  suggestedVideo?: string;
};

const SUGGESTION_VIDEO_MAP: Record<string, number> = {
  "bloodwoundheel.mp4": require("../../assets/suggestions/bloodwoundheel.mp4"),
  "cpr.mp4": require("../../assets/suggestions/cpr.mp4"),
  "humanthroatandlungs.mp4": require("../../assets/suggestions/humanthroatandlungs.mp4"),
};

const resolveSuggestedVideoSource = (suggestedVideo?: string) => {
  if (!suggestedVideo) {
    return null;
  }

  const normalized = String(suggestedVideo).trim().replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.toLowerCase() || "";
  if (!fileName) {
    return null;
  }

  return SUGGESTION_VIDEO_MAP[fileName] || null;
};

type Props = {
  emergencyId?: string;
  bottomOffset?: number;
  side?: "left" | "right";
  horizontalOffset?: number;
};

export default function EmergencyChatbotWidget({
  emergencyId,
  bottomOffset = 24,
  side = "left",
  horizontalOffset = 18,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  const onSend = async () => {
    if (!canSend) {
      return;
    }

    const messageText = input.trim();
    setInput("");

    const userMessage: MessageItem = {
      id: `user-${Date.now()}`,
      role: "user",
      text: messageText,
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      setSending(true);
      const response = await chatWithEmergencyBot({
        message: messageText,
        session: sessionId.length > 0,
        sessionId: sessionId || undefined,
        emergencyId: emergencyId || undefined,
      });

      if (response.sessionId) {
        setSessionId(response.sessionId);
      }

      const botMessage: MessageItem = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: response.message || "I did not understand that. Please try again.",
        suggestedVideo: response.suggestedVideo || (response.raw?.suggestedVideo as string | undefined),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (error: any) {
      const errorMessage: MessageItem = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: error?.response?.data?.error || error?.message || "Unable to reach chatbot right now.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: bottomOffset,
        ...(side === "right" ? { right: horizontalOffset } : { left: horizontalOffset }),
      }}
    >
      <Pressable
        onPress={() => setVisible(true)}
        className="h-14 w-14 items-center justify-center rounded-full bg-primary"
        style={{ elevation: 7 }}
      >
        <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
      </Pressable>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={() => setVisible(false)}>
        <View className="flex-1 justify-end bg-black/45">
          <View className="h-[78%] rounded-t-3xl border border-border bg-card p-4">
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <Ionicons name="medical" size={18} color="#2563eb" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-foreground">Emergency Assistant</Text>
                  <Text className="text-xs text-muted-foreground">
                    {sessionId ? `Session: ${sessionId.slice(0, 8)}...` : "New session"}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setVisible(false)} className="rounded-lg border border-border px-3 py-2">
                <Text className="text-xs font-semibold text-foreground">Close</Text>
              </Pressable>
            </View>

            <ScrollView className="flex-1 rounded-2xl border border-border bg-background p-3">
              {messages.length === 0 ? (
                <View className="items-center py-10">
                  <Ionicons name="shield-checkmark" size={22} color="#16a34a" />
                  <Text className="mt-2 text-center text-xs text-muted-foreground">
                    Ask for emergency guidance, first-aid steps, or what to do next.
                  </Text>
                </View>
              ) : (
                messages.map((item) => (
                  <View
                    key={item.id}
                    className={`mb-2 max-w-[88%] rounded-2xl px-3 py-2 ${
                      item.role === "user"
                        ? "self-end bg-primary"
                        : "self-start border border-border bg-card"
                    }`}
                  >
                    <Text className={`text-sm ${item.role === "user" ? "text-primary-foreground" : "text-foreground"}`}>
                      {item.text}
                    </Text>
                    {item.role === "assistant" && (() => {
                      const videoSource = resolveSuggestedVideoSource(item.suggestedVideo);
                      if (!videoSource) {
                        return null;
                      }

                      return (
                        <View className="mt-2 overflow-hidden rounded-xl border border-border bg-black">
                          <Video
                            source={videoSource}
                            useNativeControls
                            resizeMode={ResizeMode.CONTAIN}
                            style={{ width: "100%", height: 180 }}
                            shouldPlay={false}
                            isLooping={false}
                          />
                          <View className="px-2 py-1">
                            <Text className="text-[11px] text-muted-foreground">Suggested emergency guidance video</Text>
                          </View>
                        </View>
                      );
                    })()}
                  </View>
                ))
              )}
              {sending && (
                <View className="mt-2 flex-row items-center gap-2">
                  <ActivityIndicator size="small" />
                  <Text className="text-xs text-muted-foreground">Assistant is typing...</Text>
                </View>
              )}
            </ScrollView>

            <View className="mt-3 flex-row items-end gap-2">
              <View className="flex-1 rounded-2xl border border-border bg-background px-3 py-2">
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Type your emergency message"
                  placeholderTextColor="#9ca3af"
                  multiline
                  className="max-h-28 text-sm text-foreground"
                />
              </View>
              <Pressable
                onPress={() => void onSend()}
                disabled={!canSend}
                className={`h-11 w-11 items-center justify-center rounded-full ${canSend ? "bg-primary" : "bg-muted"}`}
              >
                <Ionicons name="send" size={16} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
