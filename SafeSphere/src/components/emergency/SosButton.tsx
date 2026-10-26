import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { radius, space, useTheme } from "../../theme";
import { AppText, Button } from "../ui";

const SIZE = 196;

type Props = {
  phase: "idle" | "counting" | "sending";
  secondsLeft: number;
  totalSeconds: number;
  disabled?: boolean;
  disabledReason?: string;
  onStart: () => void;
  onCancel: () => void;
  onSendNow: () => void;
};

/**
 * The primary SOS control. A tap starts a short countdown that can be cancelled or skipped;
 * the countdown guards against pocket taps without slowing a real emergency down.
 */
export function SosButton({ phase, secondsLeft, totalSeconds, disabled, disabledReason, onStart, onCancel, onSendNow }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  const pressed = useSharedValue(1);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (phase === "idle" && !disabled && !reduceMotion) {
      pulse.set(
        withRepeat(withSequence(withTiming(1.06, { duration: 900 }), withTiming(1, { duration: 900 })), -1),
      );
    } else {
      cancelAnimation(pulse);
      pulse.set(withTiming(1, { duration: 150 }));
    }
  }, [phase, disabled, reduceMotion, pulse]);

  useEffect(() => {
    if (phase === "counting") {
      progress.set((totalSeconds - secondsLeft) / totalSeconds);
      progress.set(withTiming((totalSeconds - secondsLeft + 1) / totalSeconds, { duration: 1000, easing: Easing.linear }));
    } else {
      progress.set(0);
    }
  }, [phase, secondsLeft, totalSeconds, progress]);

  const haloStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }], opacity: 2 - pulse.get() * 1.6 }));
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressed.get() }] }));
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.min(100, progress.get() * 100)}%` }));

  const isIdle = phase === "idle";
  const background = disabled ? colors.surfaceMuted : colors.danger;

  return (
    <View style={styles.wrap}>
      <View style={styles.stage}>
        {isIdle && !disabled && (
          <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: colors.dangerSoft }, haloStyle]} />
        )}
        <Animated.View style={buttonStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isIdle ? "Send SOS" : phase === "counting" ? `Sending SOS in ${secondsLeft} seconds` : "Sending SOS"}
            accessibilityHint={isIdle ? `Starts a ${totalSeconds} second countdown you can cancel` : undefined}
            accessibilityState={{ disabled: Boolean(disabled) || !isIdle }}
            disabled={disabled || !isIdle}
            onPressIn={() => {
              if (!reduceMotion) pressed.set(withTiming(0.95, { duration: 100 }));
            }}
            onPressOut={() => pressed.set(withTiming(1, { duration: 140 }))}
            onPress={() => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              onStart();
            }}
            style={[styles.button, { backgroundColor: background, shadowColor: colors.danger }]}
          >
            {phase === "sending" ? (
              <ActivityIndicator color="#FFFFFF" size="large" />
            ) : phase === "counting" ? (
              <>
                <AppText variant="display" style={styles.onRed}>{secondsLeft}</AppText>
                <AppText variant="label" style={styles.onRed}>Sending SOS…</AppText>
              </>
            ) : (
              <>
                <AppText variant="display" style={[styles.sos, { color: disabled ? colors.textSubtle : "#FFFFFF" }]}>SOS</AppText>
                <AppText variant="label" style={{ color: disabled ? colors.textSubtle : "#FFFFFF" }}>Tap for help</AppText>
              </>
            )}
          </Pressable>
        </Animated.View>
      </View>

      {phase === "counting" && (
        <View style={styles.controls}>
          <View style={[styles.track, { backgroundColor: colors.dangerSoft }]}>
            <Animated.View style={[styles.fill, { backgroundColor: colors.danger }, barStyle]} />
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <Button label="Send now" variant="danger" onPress={onSendNow} />
            </View>
          </View>
        </View>
      )}

      {isIdle && disabled && !!disabledReason && (
        <AppText variant="caption" tone="muted" align="center">{disabledReason}</AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.md },
  stage: { width: SIZE + 48, height: SIZE + 48, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: SIZE + 40, height: SIZE + 40, borderRadius: (SIZE + 40) / 2 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xxs,
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sos: { fontSize: 48, lineHeight: 56, letterSpacing: 2 },
  onRed: { color: "#FFFFFF" },
  controls: { alignSelf: "stretch", gap: space.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
  row: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
});
