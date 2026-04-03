import { useContext, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { applyVolunteer, getMyVolunteerApplication, VolunteerApplicationPayload } from "../../lib/api";
import AnimatedBackground from "../../components/animated-background";
import { AuthContext } from "../../context/authContext";
import { SocketContext } from "../../context/socketContext";
import * as Location from 'expo-location';

export default function VolunteerApplyScreen() {
  const { userDetails, isAuthenticated } = useContext(AuthContext);
  const { on, off } = useContext(SocketContext);
  const [viewMode, setViewMode] = useState<"apply" | "view">("apply"); // apply or view existing app
  const [skills, setSkills] = useState("");
  const [experience, setExperience] = useState("");
  const [preferredRoles, setPreferredRoles] = useState<string[]>([]);
  const [availability, setAvailability] = useState(false);
  const [timeSlots, setTimeSlots] = useState("");
  const [documents, setDocuments] = useState<{ name: string; url: string }[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [existingApplication, setExistingApplication] = useState<any>(null);

  useEffect(() => {
    if (!isAuthenticated || !userDetails) {
      router.replace("/");
    }
    checkExistingApplication();
    getLocation();

    // Listen for application review notifications
    const handleApplicationReviewed = (data: any) => {
      console.log("Application review notification:", data);
      Alert.alert(
        data.status === "approved" ? "Application Approved! 🎉" : "Application Status Update",
        data.message,
        [{ text: "OK", onPress: () => checkExistingApplication() }]
      );
    };

    on("volunteer-application-reviewed", handleApplicationReviewed);

    return () => {
      off("volunteer-application-reviewed", handleApplicationReviewed);
    };
  }, [isAuthenticated, userDetails, on, off]);

  const checkExistingApplication = async () => {
    try {
      const app = await getMyVolunteerApplication();
      if (app.application) {
        setExistingApplication(app.application);
        setViewMode("view");
      }
    } catch (err) {
      console.error("Error checking application:", err);
    }
  };

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      }
    } catch (err) {
      console.error("Location error:", err);
    }
  };

  const toggleRole = (role: string) => {
    setPreferredRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const addDemoDocument = () => {
    // For now, we'll add a demo document
    // In production, you'd integrate with file picker libraries like expo-media-library or react-native-document-picker
    setDocuments((prev) => [
      ...prev,
      { name: `Certificate_${Date.now()}.pdf`, url: `volunteer-docs/${userDetails?.userId}/${Date.now()}-certificate.pdf` },
    ]);
  };

  const submitApplication = async () => {
    if (!skills.trim()) {
      setError("Please enter your skills");
      return;
    }

    if (preferredRoles.length === 0) {
      setError("Please select at least one preferred role");
      return;
    }

    if (!location) {
      setError("Location access required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload: VolunteerApplicationPayload = {
        skills: skills.split(",").map((s) => s.trim()),
        experience: experience.trim(),
        documents,
        preferredRoles: preferredRoles as any,
        availability: {
          isAvailable: availability,
          timeSlots: availability ? timeSlots.split(",").map((t) => t.trim()) : [],
        },
        location,
      };

      await applyVolunteer(payload);
      Alert.alert("Success", "Application submitted successfully!", [
        { text: "OK", onPress: () => setViewMode("view") }
      ]);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message;
      setError(message || "Failed to submit application");
    } finally {
      setLoading(false);
    }
  };

  if (viewMode === "view" && existingApplication) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1 bg-background"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View className="relative flex-1 px-6 pt-16 pb-10">
          <AnimatedBackground variant="primary" intensity={0.12} />

          <View className="z-10 self-start rounded-full border border-border bg-primary/10 px-4 py-2">
            <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Application Status
            </Text>
          </View>

          <Text className="z-10 mt-6 text-4xl font-black text-foreground">
            Your Application
          </Text>
          <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
            Status: {existingApplication.status?.toUpperCase() || "PENDING"}
          </Text>

          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5">
            <StatusBadge status={existingApplication.status} />

            <Text className="mt-4 text-sm font-semibold text-foreground">Skills</Text>
            <Text className="text-sm text-muted-foreground">
              {existingApplication.skills?.join(", ")}
            </Text>

            <Text className="mt-4 text-sm font-semibold text-foreground">Preferred Roles</Text>
            <Text className="text-sm text-muted-foreground">
              {existingApplication.preferredRoles?.join(", ")}
            </Text>

            {existingApplication.experience && (
              <>
                <Text className="mt-4 text-sm font-semibold text-foreground">Experience</Text>
                <Text className="text-sm text-muted-foreground">
                  {existingApplication.experience}
                </Text>
              </>
            )}

            {existingApplication.documents && existingApplication.documents.length > 0 && (
              <>
                <Text className="mt-4 text-sm font-semibold text-foreground">Documents</Text>
                {existingApplication.documents.map((doc: any, idx: number) => (
                  <View
                    key={idx}
                    className="mt-2 flex-row items-center rounded-lg border border-border bg-background p-3"
                  >
                    <Text className="flex-1 text-sm text-foreground">{doc.name}</Text>
                    <Text className="text-xs text-primary">✓</Text>
                  </View>
                ))}
              </>
            )}

            {existingApplication.reviewNotes && (
              <>
                <Text className="mt-4 text-sm font-semibold text-foreground">Review Notes</Text>
                <Text className="text-sm text-muted-foreground">
                  {existingApplication.reviewNotes}
                </Text>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View className="relative flex-1 px-6 pt-16 pb-10">
        <AnimatedBackground variant="primary" intensity={0.12} />

        <View className="z-10 self-start rounded-full border border-border bg-primary/10 px-4 py-2">
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Volunteer Application
          </Text>
        </View>

        <Text className="z-10 mt-6 text-4xl font-black text-foreground">
          Become a Volunteer
        </Text>
        <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
          Complete this form to apply for volunteer role upgrade
        </Text>

        <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Skills (comma-separated)
          </Text>
          <TextInput
            value={skills}
            onChangeText={setSkills}
            placeholder="e.g. First Aid, CPR, Rescue"
            placeholderTextColor="#6b7280"
            multiline
            numberOfLines={2}
            className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
          />

          <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Experience
          </Text>
          <TextInput
            value={experience}
            onChangeText={setExperience}
            placeholder="Describe your experience"
            placeholderTextColor="#6b7280"
            multiline
            numberOfLines={3}
            className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
          />

          <Text className="mb-3 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Preferred Roles
          </Text>
          <View className="gap-2">
            {[
              { label: "Medical", value: "medical" },
              { label: "Rescue", value: "rescue" },
              { label: "Logistics", value: "logistics" },
              { label: "General", value: "general" },
            ].map((role) => (
              <Pressable
                key={role.value}
                onPress={() => toggleRole(role.value)}
                className={`rounded-lg px-4 py-3 ${
                  preferredRoles.includes(role.value)
                    ? "bg-primary"
                    : "border border-border bg-background"
                }`}
              >
                <Text
                  className={`font-semibold ${
                    preferredRoles.includes(role.value)
                      ? "text-primary-foreground"
                      : "text-foreground"
                  }`}
                >
                  {role.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-5 flex-row items-center justify-between rounded-2xl border border-border bg-background px-4 py-4">
            <Text className="text-sm text-foreground">Available for shift work?</Text>
            <Pressable
              onPress={() => setAvailability(!availability)}
              className={`h-6 w-11 rounded-full ${availability ? "bg-primary" : "bg-muted"}`}
            />
          </View>

          {availability && (
            <>
              <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Time Slots (comma-separated)
              </Text>
              <TextInput
                value={timeSlots}
                onChangeText={setTimeSlots}
                placeholder="e.g. Monday 9AM-5PM, Weekend flexible"
                placeholderTextColor="#6b7280"
                className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
              />
            </>
          )}

          <Text className="mb-3 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Supporting Documents
          </Text>
          <Pressable
            onPress={addDemoDocument}
            disabled={loading}
            className="rounded-2xl border border-dashed border-primary bg-primary/5 px-4 py-4"
          >
            <Text className="text-center text-sm font-semibold text-primary">
              + Add Document
            </Text>
          </Pressable>

          {documents.length > 0 && (
            <View className="mt-3 gap-2">
              {documents.map((doc, idx) => (
                <View
                  key={idx}
                  className="flex-row items-center justify-between rounded-lg border border-border bg-background p-3"
                >
                  <Text className="flex-1 text-sm text-foreground">{doc.name}</Text>
                  <Pressable
                    onPress={() => {
                      setDocuments((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    <Text className="text-sm text-destructive">×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {!!error && (
          <Text className="z-10 mt-3 text-sm text-destructive" selectable>
            {error}
          </Text>
        )}

        <Pressable
          className="z-10 mt-8 items-center rounded-2xl bg-primary py-4"
          onPress={submitApplication}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-primary-foreground">
              Submit Application
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Pending Review" },
    approved: { bg: "bg-green-100", text: "text-green-800", label: "Approved" },
    rejected: { bg: "bg-red-100", text: "text-red-800", label: "Rejected" },
  };

  const config = colors[status] || colors.pending;

  return (
    <View className={`self-start rounded-full ${config.bg} px-3 py-1`}>
      <Text className={`text-xs font-semibold ${config.text}`}>{config.label}</Text>
    </View>
  );
}
