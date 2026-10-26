import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { firstIncompleteStep, STEPS, useOnboardingDraft } from "../../context/onboardingDraft";
import { useTheme } from "../../theme";

/** Entry point: rebuilds the back stack up to the first unfinished step so "back" still works after a restart. */
export default function OnboardingIndex() {
  const { colors } = useTheme();
  const { draft, ready } = useOnboardingDraft();

  useEffect(() => {
    if (!ready) return;
    const target = firstIncompleteStep(draft);
    const targetIndex = STEPS.findIndex((s) => s.route === target);
    router.replace(`/onboarding/${STEPS[0].route}`);
    for (let i = 1; i <= targetIndex; i++) {
      router.push(`/onboarding/${STEPS[i]!.route}`);
    }
    // Run once, when the draft has been restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.text} accessibilityLabel="Loading your progress" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
