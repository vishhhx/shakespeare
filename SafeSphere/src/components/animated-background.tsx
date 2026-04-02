import { useEffect } from "react";
import { View, useColorScheme } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeSphereColors } from "../constants/colors";

interface AnimatedBackgroundProps {
  variant?: "primary" | "success" | "emergency";
  intensity?: number;
}

/**
 * AnimatedBackground Component
 * Creates a dynamic animated background with floating orbs
 * Uses SafeSphere color palette: Blue (primary), Green (success), Red (emergency)
 */
export default function AnimatedBackground({
  variant = "primary",
  intensity = 0.4,
}: AnimatedBackgroundProps) {
  useColorScheme();

  // Shared animation values
  const orbOneY = useSharedValue(-16);
  const orbTwoY = useSharedValue(20);
  const orbThreeScale = useSharedValue(1);
  const orbFourX = useSharedValue(-14);
  const orbFiveY = useSharedValue(10);

  // Select color palette based on variant
  const getOrbColors = () => {
    switch (variant) {
      case "success":
        return {
          orb1: SafeSphereColors.success.light,
          orb2: SafeSphereColors.success.light,
          orb3: SafeSphereColors.success.main,
          orb4: SafeSphereColors.success.dark,
          orb5: SafeSphereColors.success.light,
        };
      case "emergency":
        return {
          orb1: SafeSphereColors.emergency.light,
          orb2: SafeSphereColors.emergency.light,
          orb3: SafeSphereColors.emergency.main,
          orb4: SafeSphereColors.emergency.dark,
          orb5: SafeSphereColors.emergency.light,
        };
      default:
        // primary
        return {
          orb1: SafeSphereColors.primary.pale,
          orb2: SafeSphereColors.primary.light,
          orb3: SafeSphereColors.primary.main,
          orb4: SafeSphereColors.primary.dark,
          orb5: SafeSphereColors.primary.light,
        };
    }
  };

  const colors = getOrbColors();

  useEffect(() => {
    // Orb 1 - Y translation (top-left)
    orbOneY.value = withRepeat(
      withTiming(18, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    // Orb 2 - Y translation (top-right)
    orbTwoY.value = withRepeat(
      withTiming(-20, { duration: 3600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    // Orb 3 - Scale (bottom-left)
    orbThreeScale.value = withRepeat(
      withTiming(1.08, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    // Orb 4 - X translation (center)
    orbFourX.value = withRepeat(
      withTiming(14, { duration: 3400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    // Orb 5 - Y translation (bottom-right)
    orbFiveY.value = withRepeat(
      withTiming(-16, { duration: 3800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [orbOneY, orbTwoY, orbThreeScale, orbFourX, orbFiveY]);

  const orbOneStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: orbOneY.value }],
    opacity: intensity,
  }));

  const orbTwoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: orbTwoY.value }],
    opacity: intensity,
  }));

  const orbThreeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: orbThreeScale.value }],
    opacity: intensity * 0.8,
  }));

  const orbFourStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: orbFourX.value }],
    opacity: intensity * 0.7,
  }));

  const orbFiveStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: orbFiveY.value }],
    opacity: intensity * 0.75,
  }));

  return (
    <View className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Orb 1 - Top Left */}
      <Animated.View
        style={[
          orbOneStyle,
          { backgroundColor: colors.orb1 },
        ]}
        className="absolute -top-10 -left-12 h-52 w-52 rounded-full blur-3xl"
      />

      {/* Orb 2 - Top Right */}
      <Animated.View
        style={[
          orbTwoStyle,
          { backgroundColor: colors.orb2 },
        ]}
        className="absolute top-28 -right-14 h-64 w-64 rounded-full blur-3xl"
      />

      {/* Orb 3 - Bottom Left */}
      <Animated.View
        style={[
          orbThreeStyle,
          { backgroundColor: colors.orb3 },
        ]}
        className="absolute -bottom-12 left-12 h-72 w-72 rounded-full blur-3xl"
      />

      {/* Orb 4 - Center */}
      <Animated.View
        style={[
          orbFourStyle,
          { backgroundColor: colors.orb4 },
        ]}
        className="absolute top-1/3 left-1/3 h-40 w-40 rounded-full blur-2xl"
      />

      {/* Orb 5 - Bottom Right */}
      <Animated.View
        style={[
          orbFiveStyle,
          { backgroundColor: colors.orb5 },
        ]}
        className="absolute bottom-24 right-8 h-32 w-32 rounded-full blur-2xl"
      />
    </View>
  );
}
