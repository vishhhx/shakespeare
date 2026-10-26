import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { BLOOD_GROUPS, useOnboardingDraft, validateMedical } from "../../context/onboardingDraft";
import { StepScreen } from "../../components/onboarding/StepScreen";
import { AppText, Button, Card, Chip, SwitchRow, TagInput, TextField } from "../../components/ui";
import { space } from "../../theme";

export default function MedicalStep() {
  const { draft, update } = useOnboardingDraft();
  const [submitted, setSubmitted] = useState(false);
  const errors: { bloodGroup?: string } = submitted ? validateMedical(draft) : {};

  const next = () => {
    setSubmitted(true);
    if (Object.keys(validateMedical(draft)).length === 0) {
      router.push("/onboarding/contacts");
    }
  };

  return (
    <StepScreen
      step="medical"
      title="Medical information"
      subtitle="Only blood group is required. Add anything a medic should know before treating you."
      footer={<Button label="Continue" icon={ArrowRight} iconPosition="right" onPress={next} />}
    >
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Blood group">
        <AppText variant="label">Blood group</AppText>
        <View style={styles.grid}>
          {BLOOD_GROUPS.map((group) => (
            <View key={group} style={styles.gridItem}>
              <Chip label={group} selected={draft.bloodGroup === group} onPress={() => update({ bloodGroup: group })} />
            </View>
          ))}
        </View>
        {errors.bloodGroup ? (
          <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {errors.bloodGroup}
          </AppText>
        ) : null}
      </View>

      <TagInput
        label="Allergies"
        values={draft.allergies}
        onChange={(allergies) => update({ allergies })}
        placeholder="e.g. Penicillin"
      />
      <TagInput
        label="Current medications"
        values={draft.medications}
        onChange={(medications) => update({ medications })}
        placeholder="e.g. Metformin 500 mg"
      />
      <TagInput
        label="Health conditions"
        values={draft.diseases}
        onChange={(diseases) => update({ diseases })}
        placeholder="e.g. Asthma, diabetes"
      />
      <TextField
        label="Notes for responders"
        optional
        multiline
        value={draft.notes}
        onChangeText={(notes) => update({ notes })}
        placeholder="Implants, pregnancy, mobility needs…"
        maxLength={500}
      />

      <Card muted>
        <SwitchRow
          title="Share with responders during an SOS"
          description="When you raise an alert, people responding to it can see this medical information. It is never shown publicly."
          value={draft.autoShareMedical}
          onValueChange={(autoShareMedical) => update({ autoShareMedical })}
        />
      </Card>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -space.xxs },
  gridItem: { width: "25%", padding: space.xxs },
});
