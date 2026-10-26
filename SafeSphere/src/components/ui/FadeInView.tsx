import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

/** Subtle entrance (opacity + 12px rise). Skipped automatically when the OS asks for reduced motion. */
export function FadeInView({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: ViewStyle }) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.duration(260).delay(delay).withInitialValues({ transform: [{ translateY: 12 }] }).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}
