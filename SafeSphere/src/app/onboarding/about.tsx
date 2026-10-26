import { useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import { router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { useOnboardingDraft, validateAbout, type OnboardingDraft } from "../../context/onboardingDraft";
import { StepScreen } from "../../components/onboarding/StepScreen";
import { AppText, Button, Chip, TextField } from "../../components/ui";
import { space } from "../../theme";

const GENDERS: { value: Exclude<OnboardingDraft["gender"], "">; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

export default function AboutStep() {
  const { draft, update } = useOnboardingDraft();
  const [submitted, setSubmitted] = useState(false);
  const ageRef = useRef<TextInput>(null);

  const errors = submitted ? validateAbout(draft) : {};

  const next = () => {
    setSubmitted(true);
    if (Object.keys(validateAbout(draft)).length === 0) {
      router.push("/onboarding/medical");
    }
  };

  return (
    <StepScreen
      step="about"
      title="Let's start with you"
      subtitle="Responders use this to identify and address you."
      footer={<Button label="Continue" icon={ArrowRight} iconPosition="right" onPress={next} />}
    >
      <TextField
        label="Full name"
        value={draft.name}
        onChangeText={(name) => update({ name })}
        placeholder="As on your ID"
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => ageRef.current?.focus()}
        maxLength={50}
        error={errors.name}
      />

      <TextField
        ref={ageRef}
        label="Age"
        optional
        value={draft.age}
        onChangeText={(age) => update({ age: age.replace(/\D/g, "").slice(0, 3) })}
        placeholder="e.g. 28"
        keyboardType="number-pad"
        helper="Helps medics judge dosage and risk."
        error={errors.age}
      />

      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Gender">
        <View style={styles.labelRow}>
          <AppText variant="label">Gender</AppText>
          <AppText variant="caption" tone="subtle">
            Optional
          </AppText>
        </View>
        <View style={styles.chips}>
          {GENDERS.map(({ value, label }) => (
            <Chip
              key={value}
              label={label}
              selected={draft.gender === value}
              onPress={() => update({ gender: draft.gender === value ? "" : value })}
            />
          ))}
        </View>
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
});
