import { useContext, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import { AuthContext } from "../../context/authContext";
import { AppText, Button, FadeInView, Screen } from "../../components/ui";
import { radius, space, useTheme } from "../../theme";

export default function OnboardingDone() {
  const { colors } = useTheme();
  const { userDetails } = useContext(AuthContext);
  const firstName = (userDetails?.name ?? "").trim().split(/\s+/)[0];

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <Screen scroll={false} footer={<Button label="Go to SafeSphere" onPress={() => router.replace("/(tabs)")} />}>
      <View style={styles.center}>
        <Animated.View
          entering={ZoomIn.duration(320).reduceMotion(ReduceMotion.System)}
          style={[styles.badge, { backgroundColor: colors.successSoft }]}
        >
          <Check size={40} color={colors.success} strokeWidth={2.5} aria-hidden />
        </Animated.View>
        <FadeInView delay={120} style={styles.text}>
          <AppText variant="display" align="center" accessibilityRole="header">
            {firstName ? `You're all set, ${firstName}` : "You're all set"}
          </AppText>
          <AppText tone="muted" align="center">
            Your safety profile is ready. If you ever need help, one tap alerts the people around you and the contacts you added.
          </AppText>
        </FadeInView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg },
  badge: { width: 88, height: 88, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  text: { gap: space.sm, maxWidth: 360 },
});
