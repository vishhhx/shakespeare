import { useContext, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import { Image } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CheckCircle2, CircleAlert, Pencil } from "lucide-react-native";
import { AuthContext } from "../../context/authContext";
import { firstIncompleteStep, useOnboardingDraft, type StepRoute } from "../../context/onboardingDraft";
import { getApiErrorMessage, upsertPublicProfile, type PublicProfilePayload } from "../../lib/api";
import { getPreciseLocation } from "../../lib/location";
import { StepScreen } from "../../components/onboarding/StepScreen";
import { AppText, Banner, Button, Card, SwitchRow } from "../../components/ui";
import { radius, space, useTheme } from "../../theme";

const listOrNone = (values: string[]) => (values.length ? values.join(", ") : "None added");

function Section({ title, step, children }: { title: string; step: StepRoute; children: ReactNode }) {
  return (
    <Card>
      <View style={styles.sectionHeader}>
        <AppText variant="bodyStrong" accessibilityRole="header">
          {title}
        </AppText>
        <Button
          label="Edit"
          variant="ghost"
          icon={Pencil}
          fullWidth={false}
          haptic={false}
          accessibilityLabel={`Edit ${title}`}
          onPress={() => router.dismissTo(`/onboarding/${step}` as Href)}
        />
      </View>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="label" tone="muted" style={styles.rowLabel}>
        {label}
      </AppText>
      <AppText variant="label" style={styles.rowValue}>
        {value}
      </AppText>
    </View>
  );
}

export default function ReviewStep() {
  const { colors } = useTheme();
  const { userDetails, setUserDetails } = useContext(AuthContext);
  const { draft, update, previews, clear } = useOnboardingDraft();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [locationNote, setLocationNote] = useState("");

  const blocking = firstIncompleteStep(draft) !== "review";
  const faceReady = Boolean(draft.facePhotoKey && draft.faceConsentAt);

  const toggleTracking = async (enabled: boolean) => {
    setLocationNote("");
    if (!enabled) {
      update({ enableContinuousTracking: false });
      return;
    }
    try {
      await getPreciseLocation();
      update({ enableContinuousTracking: true });
    } catch {
      setLocationNote("Location access is off, so nearby alerts can't reach you. You can turn it on later in Settings.");
    }
  };

  const submit = async () => {
    if (submitting || !userDetails) return;
    if (blocking) {
      router.dismissTo(`/onboarding/${firstIncompleteStep(draft)}` as Href);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      let location: PublicProfilePayload["location"];
      if (draft.enableContinuousTracking) {
        try {
          const { lat, lng } = await getPreciseLocation();
          location = { lat, lng };
        } catch {
          // Location is optional; the profile still saves without it.
        }
      }

      const payload: PublicProfilePayload = {
        name: draft.name.trim(),
        age: draft.age ? Number(draft.age) : undefined,
        gender: draft.gender || undefined,
        profileImage: draft.profilePhotoKey || undefined,
        faceEmbeddingPhoto: draft.facePhotoKey,
        faceConsentAt: draft.faceConsentAt,
        contacts: draft.contacts.map((c) => ({
          name: c.name.trim(),
          phoneNumber: `+91${c.phone.replace(/\D/g, "")}`,
          relation: c.relation.trim() || undefined,
          isPrimary: c.isPrimary,
        })),
        medicalRecord: {
          bloodGroup: draft.bloodGroup as PublicProfilePayload["medicalRecord"]["bloodGroup"],
          allergies: draft.allergies,
          medications: draft.medications,
          diseases: draft.diseases,
          notes: draft.notes.trim() || undefined,
        },
        sosMessage: draft.sosMessage.trim() || undefined,
        autoShareMedical: draft.autoShareMedical,
        enableContinuousTracking: draft.enableContinuousTracking,
        location,
      };

      const response = await upsertPublicProfile(payload);
      const user = response?.user;

      await AsyncStorage.setItem("enableContinuousTracking", String(draft.enableContinuousTracking)).catch(() => {});
      setUserDetails({
        ...userDetails,
        name: String(user?.name ?? payload.name),
        avatarUrl: String(user?.avatarUrl ?? userDetails.avatarUrl ?? ""),
        isprofileComplete: true,
      });
      await clear();
      router.replace("/onboarding/done");
    } catch (err) {
      setError(getApiErrorMessage(err, "We couldn't save your profile. Your answers are kept, so you can try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StepScreen
      step="review"
      title="Review and finish"
      subtitle="Check everything is right. You can change any of this later from your profile."
      backDisabled={submitting}
      footer={<Button label="Confirm and finish" loading={submitting} onPress={submit} />}
    >
      <Section title="About you" step="about">
        <Row label="Name" value={draft.name || "Missing"} />
        <Row label="Age" value={draft.age || "Not added"} />
        <Row label="Gender" value={draft.gender ? draft.gender[0]!.toUpperCase() + draft.gender.slice(1) : "Not added"} />
      </Section>

      <Section title="Medical information" step="medical">
        <Row label="Blood group" value={draft.bloodGroup || "Missing"} />
        <Row label="Allergies" value={listOrNone(draft.allergies)} />
        <Row label="Medications" value={listOrNone(draft.medications)} />
        <Row label="Conditions" value={listOrNone(draft.diseases)} />
        <Row label="Share in SOS" value={draft.autoShareMedical ? "Yes" : "No"} />
      </Section>

      <Section title="Emergency contacts" step="contacts">
        {draft.contacts.length ? (
          draft.contacts.map((c, i) => (
            <Row key={i} label={c.isPrimary ? "Primary" : c.relation || `Contact ${i + 1}`} value={`${c.name} · +91 ${c.phone}`} />
          ))
        ) : (
          <AppText variant="label" tone="muted">
            No contacts added. We recommend at least one.
          </AppText>
        )}
      </Section>

      <Card>
        <AppText variant="bodyStrong" accessibilityRole="header">
          Photos
        </AppText>
        <View style={styles.photos}>
          <View style={styles.photoItem}>
            <View style={[styles.thumb, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
              {previews.profile ? (
                <Image source={{ uri: previews.profile }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Profile photo" />
              ) : null}
            </View>
            <AppText variant="caption" tone="muted">
              Profile photo
            </AppText>
            <AppText variant="label">{draft.profilePhotoKey ? "Saved" : "Skipped"}</AppText>
            <Button label="Retake" variant="ghost" fullWidth={false} haptic={false} onPress={() => router.dismissTo("/onboarding/photo")} />
          </View>
          <View style={styles.photoItem}>
            <View style={[styles.thumb, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
              {previews.face ? (
                <Image source={{ uri: previews.face }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Face photo" />
              ) : null}
            </View>
            <AppText variant="caption" tone="muted">
              Face photo
            </AppText>
            <View style={styles.status}>
              {faceReady ? (
                <CheckCircle2 size={14} color={colors.success} aria-hidden />
              ) : (
                <CircleAlert size={14} color={colors.danger} aria-hidden />
              )}
              <AppText variant="label" tone={faceReady ? "success" : "danger"}>
                {faceReady ? "Saved" : "Required"}
              </AppText>
            </View>
            <Button label="Retake" variant="ghost" fullWidth={false} haptic={false} onPress={() => router.dismissTo("/onboarding/face")} />
          </View>
        </View>
      </Card>

      <Card muted>
        <SwitchRow
          title="Share my location for nearby alerts"
          description="Lets SafeSphere alert you when someone near you needs help, and helps responders find you faster."
          value={draft.enableContinuousTracking}
          onValueChange={toggleTracking}
        />
      </Card>
      {locationNote ? <Banner tone="info" message={locationNote} /> : null}

      {error ? <Banner title="Not saved yet" message={error} /> : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: -space.xs },
  row: { flexDirection: "row", gap: space.md },
  rowLabel: { width: 112 },
  rowValue: { flex: 1 },
  photos: { flexDirection: "row", gap: space.md },
  photoItem: { flex: 1, alignItems: "flex-start", gap: space.xxs },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: radius.md, borderWidth: 1, overflow: "hidden", marginBottom: space.xxs },
  status: { flexDirection: "row", alignItems: "center", gap: space.xxs },
});
