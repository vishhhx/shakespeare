import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { STEPS, stepNumber, type StepRoute } from "../../context/onboardingDraft";
import { space } from "../../theme";
import { AppText, FadeInView, IconButton, Screen, StepProgress } from "../ui";

type StepScreenProps = {
  step: StepRoute;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  /** Hide the back control (e.g. while an upload is in flight). */
  backDisabled?: boolean;
};

export function StepScreen({ step, title, subtitle, children, footer, backDisabled }: StepScreenProps) {
  const current = stepNumber(step);
  const label = STEPS[current - 1]?.label ?? "";

  return (
    <Screen
      header={
        <View style={styles.header}>
          <IconButton
            icon={ChevronLeft}
            label="Previous step"
            disabled={backDisabled || current === 1}
            onPress={() => router.back()}
          />
          <View style={styles.progress}>
            <StepProgress current={current} total={STEPS.length} label={label} />
          </View>
        </View>
      }
      footer={footer}
    >
      <FadeInView style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText tone="muted">{subtitle}</AppText> : null}
      </FadeInView>
      <View style={styles.body}>{children}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  progress: { flex: 1, paddingRight: space.xxs },
  heading: { gap: space.xs },
  body: { marginTop: space.lg, gap: space.lg },
});
