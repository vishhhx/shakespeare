import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { LucideIcon } from "lucide-react-native";
import { motion, radius, space, touchTarget, useTheme } from "../../theme";
import { AppText } from "./AppText";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  haptic?: boolean;
};

export function Button({
  label,
  variant = "primary",
  loading = false,
  disabled,
  icon: Icon,
  iconPosition = "left",
  fullWidth = true,
  haptic = true,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const isDisabled = Boolean(disabled || loading);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const palette = {
    primary: { bg: colors.inverse, pressed: colors.inversePressed, fg: colors.textOnInverse, border: colors.inverse },
    secondary: { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: "transparent", pressed: colors.surfaceMuted, fg: colors.text, border: "transparent" },
    danger: { bg: colors.danger, pressed: colors.dangerText, fg: "#FFFFFF", border: colors.danger },
  }[variant];

  const iconNode = Icon ? <Icon size={18} color={palette.fg} strokeWidth={2} aria-hidden /> : null;

  return (
    <Animated.View style={[fullWidth && styles.fullWidth, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={(event) => {
          if (!reduceMotion) {
            scale.set(withTiming(motion.pressScale, { duration: motion.press }));
          }
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          scale.set(withTiming(1, { duration: motion.fast }));
          onPressOut?.(event);
        }}
        onPress={(event) => {
          if (haptic) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          onPress?.(event);
        }}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: pressed ? palette.pressed : palette.bg,
            borderColor: palette.border,
            opacity: isDisabled && !loading ? 0.45 : 1,
          },
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <View style={styles.content}>
            {iconPosition === "left" ? iconNode : null}
            <AppText variant="bodyStrong" style={{ color: palette.fg }} numberOfLines={1}>
              {label}
            </AppText>
            {iconPosition === "right" ? iconNode : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: "stretch" },
  base: {
    minHeight: touchTarget + 4,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", gap: space.xs },
});
