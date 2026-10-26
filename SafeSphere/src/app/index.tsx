import { useContext, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { BellRing, HeartPulse, Users, type LucideIcon } from "lucide-react-native";
import { AuthContext } from "../context/authContext";
import { api } from "../lib/api";
import { AppText, Button, FadeInView, Screen } from "../components/ui";
import { BrandMark } from "../components/auth/BrandMark";
import { radius, space, useTheme } from "../theme";

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: BellRing,
    title: "One tap alerts people nearby",
    body: "Your SOS reaches nearby volunteers, authorities and your emergency contacts.",
  },
  {
    icon: Users,
    title: "Verified responders, not strangers",
    body: "Authorities and approved volunteers coordinate every case.",
  },
  {
    icon: HeartPulse,
    title: "Responders arrive informed",
    body: "Share your blood group, allergies and medications only when you choose to.",
  },
];

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const redirectedRef = useRef(false);
  const { userDetails, isAuthenticated } = useContext(AuthContext);

  // Returning users skip the welcome screen.
  useEffect(() => {
    const redirect = async () => {
      if (redirectedRef.current || !isAuthenticated || !userDetails?.phoneNumber) {
        return;
      }
      redirectedRef.current = true;

      if (!userDetails.isVerified) {
        try {
          await api.post("/public-user/send-otp", { phoneNumber: userDetails.phoneNumber });
        } catch {}
        router.replace({
          pathname: "/auth/verify-otp",
          params: { phoneNumber: userDetails.phoneNumber, mode: "login" },
        });
        return;
      }

      router.replace(userDetails.isprofileComplete ? "/(tabs)" : "/onboarding");
    };

    void redirect();
  }, [isAuthenticated, userDetails]);

  return (
    <Screen
      footer={
        <>
          <Button label="Create account" onPress={() => router.push("/auth/register")} />
          <Button label="I already have an account" variant="ghost" onPress={() => router.push("/auth/login")} />
        </>
      }
    >
      <BrandMark />

      <FadeInView style={styles.hero}>
        <AppText variant="display" accessibilityRole="header">
          Help that finds you, fast.
        </AppText>
        <AppText tone="muted">
          SafeSphere connects you to people who can help in an emergency, and gives them what they need to know.
        </AppText>
      </FadeInView>

      <View style={styles.features}>
        {FEATURES.map(({ icon: Icon, title, body }, index) => (
          <FadeInView key={title} delay={80 + index * 60} style={styles.feature}>
            <View style={[styles.featureIcon, { backgroundColor: colors.accentSoft }]}>
              <Icon size={20} color={colors.accentText} strokeWidth={2} aria-hidden />
            </View>
            <View style={styles.featureText}>
              <AppText variant="bodyStrong">{title}</AppText>
              <AppText variant="label" tone="muted">
                {body}
              </AppText>
            </View>
          </FadeInView>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: space.xxl, gap: space.sm },
  features: { marginTop: space.xl, gap: space.lg },
  feature: { flexDirection: "row", gap: space.md },
  featureIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  featureText: { flex: 1, gap: space.xxs },
});
