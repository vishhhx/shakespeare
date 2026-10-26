import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ArrowRight, Plus, Star, Trash2 } from "lucide-react-native";
import { useOnboardingDraft, validateContact, type DraftContact } from "../../context/onboardingDraft";
import { StepScreen } from "../../components/onboarding/StepScreen";
import { AppText, Button, Card, Chip, IconButton, TextField } from "../../components/ui";
import { space, useTheme } from "../../theme";

const MAX_CONTACTS = 5;
const EMPTY_CONTACT: DraftContact = { name: "", phone: "", relation: "", isPrimary: false };

export default function ContactsStep() {
  const { colors } = useTheme();
  const { draft, update } = useOnboardingDraft();
  const [submitted, setSubmitted] = useState(false);

  const contacts = draft.contacts;

  const setContact = (index: number, patch: Partial<DraftContact>) => {
    update({ contacts: contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  };

  const makePrimary = (index: number) => {
    update({ contacts: contacts.map((c, i) => ({ ...c, isPrimary: i === index })) });
  };

  const addContact = () => {
    update({ contacts: [...contacts, { ...EMPTY_CONTACT, isPrimary: contacts.length === 0 }] });
  };

  const removeContact = (index: number) => {
    const remaining = contacts.filter((_, i) => i !== index);
    if (remaining.length && !remaining.some((c) => c.isPrimary)) {
      remaining[0] = { ...remaining[0]!, isPrimary: true };
    }
    update({ contacts: remaining });
  };

  const next = () => {
    setSubmitted(true);
    if (contacts.every((c) => Object.keys(validateContact(c)).length === 0)) {
      router.push("/onboarding/photo");
    }
  };

  return (
    <StepScreen
      step="contacts"
      title="Who should we alert?"
      subtitle="We text these people when you raise an SOS. You can add up to 5."
      footer={
        <Button
          label={contacts.length ? "Continue" : "Skip for now"}
          variant={contacts.length ? "primary" : "secondary"}
          icon={ArrowRight}
          iconPosition="right"
          onPress={next}
        />
      }
    >
      {contacts.map((contact, index) => {
        const errors = submitted ? validateContact(contact) : {};
        return (
          <Card key={index}>
            <View style={styles.cardHeader}>
              <AppText variant="bodyStrong">{`Contact ${index + 1}`}</AppText>
              <View style={styles.cardActions}>
                {contact.isPrimary ? (
                  <View style={[styles.primaryBadge, { backgroundColor: colors.accentSoft }]}>
                    <Star size={14} color={colors.accentText} fill={colors.accentText} aria-hidden />
                    <AppText variant="caption" tone="accent">
                      Primary
                    </AppText>
                  </View>
                ) : (
                  <Chip label="Make primary" onPress={() => makePrimary(index)} />
                )}
                <IconButton icon={Trash2} tone="danger" label={`Remove contact ${index + 1}`} onPress={() => removeContact(index)} />
              </View>
            </View>
            <TextField
              label="Name"
              value={contact.name}
              onChangeText={(name) => setContact(index, { name })}
              autoCapitalize="words"
              error={errors.name}
            />
            <TextField
              label="Mobile number"
              value={contact.phone}
              onChangeText={(phone) => setContact(index, { phone: phone.replace(/\D/g, "").slice(-10) })}
              keyboardType="phone-pad"
              maxLength={10}
              error={errors.phone}
              leading={
                <AppText variant="bodyStrong" tone="muted">
                  +91
                </AppText>
              }
            />
            <TextField
              label="Relationship"
              optional
              value={contact.relation}
              onChangeText={(relation) => setContact(index, { relation })}
              placeholder="e.g. Sister"
            />
          </Card>
        );
      })}

      {contacts.length < MAX_CONTACTS ? (
        <Button label={contacts.length ? "Add another contact" : "Add a contact"} variant="secondary" icon={Plus} onPress={addContact} />
      ) : null}

      <TextField
        label="SOS message"
        optional
        multiline
        value={draft.sosMessage}
        onChangeText={(sosMessage) => update({ sosMessage })}
        placeholder="I need help. This is my live location."
        helper="Sent to your contacts with your location when you raise an alert."
        maxLength={240}
      />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: space.xxs },
  primaryBadge: { flexDirection: "row", alignItems: "center", gap: space.xxs, paddingHorizontal: space.sm, paddingVertical: space.xxs, borderRadius: 999 },
});
