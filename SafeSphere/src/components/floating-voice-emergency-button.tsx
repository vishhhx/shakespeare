import { DeviceEventEmitter, Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Mic } from "lucide-react-native";

import { VOICE_SOS_EVENT } from "./global-shake-voice-sos";
import { radius, space, touchTarget, useTheme } from "../theme";
import { AppText } from "./ui";

/**
 * Starts the voice SOS by hand (same flow as shaking the phone). The flow itself lives in
 * GlobalShakeVoiceSOS, mounted once in the root layout, so there is a single implementation.
 */
export default function VoiceSosButton({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start voice SOS"
      accessibilityHint="Opens the microphone after a short countdown so you can describe the emergency"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        DeviceEventEmitter.emit(VOICE_SOS_EVENT, { source: "button" });
      }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { borderColor: colors.danger, backgroundColor: pressed ? colors.dangerSoft : colors.surface },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.dangerSoft }]}>
        <Mic size={20} color={colors.danger} aria-hidden />
      </View>
      {!compact && (
        <View style={styles.text}>
          <AppText variant="bodyStrong">Voice SOS</AppText>
          <AppText variant="caption" tone="muted">Speak instead of typing</AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: touchTarget + 16,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.lg,
  },
  compact: { flex: 0, width: touchTarget + 8, justifyContent: "center", paddingHorizontal: 0 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
});
