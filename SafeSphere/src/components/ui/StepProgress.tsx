import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { motion, radius, space, useTheme } from "../../theme";
import { AppText } from "./AppText";

type StepProgressProps = { current: number; total: number; label: string };

/** Animates scaleX (not width) so the fill never triggers layout. */
export function StepProgress({ current, total, label }: StepProgressProps) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(current / total);

  useEffect(() => {
    const target = current / total;
    progress.set(reduceMotion ? target : withTiming(target, { duration: motion.base }));
  }, [current, total, reduceMotion, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.get() }],
  }));

  return (
    <View
      style={styles.wrapper}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${total}: ${label}`}
      accessibilityValue={{ min: 0, max: total, now: current }}
    >
      <View style={styles.labels}>
        <AppText variant="overline" tone="accent">
          {`STEP ${current} OF ${total}`}
        </AppText>
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <Animated.View style={[styles.fill, { backgroundColor: colors.accentText }, fillStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space.xs },
  labels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  track: { height: 4, borderRadius: radius.pill, overflow: "hidden" },
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: radius.pill, transformOrigin: "left" },
});
