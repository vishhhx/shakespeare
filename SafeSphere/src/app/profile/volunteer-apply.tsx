import { useContext, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { applyVolunteer, getMyVolunteerApplication, VolunteerApplicationPayload } from "../../lib/api";
import AnimatedBackground from "../../components/animated-background";
import { AuthContext } from "../../context/authContext";
import { SocketContext } from "../../context/socketContext";
import { useDocumentPicker } from "../../hooks/useDocumentPicker";
import * as Location from 'expo-location';

export default function VolunteerApplyScreen() {
  const { userDetails, isAuthenticated } = useContext(AuthContext);
  const { on, off } = useContext(SocketContext);
  const { documents, uploading, uploadProgress, error: uploadError, handleAddDocument, removeDocument } = useDocumentPicker();
  const [viewMode, setViewMode] = useState<"apply" | "view">("apply");
  const [skills, setSkills] = useState("");
  const [experience, setExperience] = useState("");
  const [preferredRoles, setPreferredRoles] = useState<string[]>([]);
  const [availability, setAvailability] = useState(false);
  const [timeSlots, setTimeSlots] = useState("");
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

    if (documents.length === 0) {
      setError("Please upload at least one supporting document");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload: VolunteerApplicationPayload = {
        skills: skills.split(",").map((s) => s.trim()).filter(s => s),
        experience: experience.trim(),
        documents: documents.map(doc => ({
          name: doc.name,
          url: doc.url
        })),
        preferredRoles: preferredRoles as any,
        availability: {
          isAvailable: availability,
          timeSlots: availability ? timeSlots.split(",").map((t) => t.trim()).filter(t => t) : [],
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
        contentContainerStyle={{ flexGrow: 1, minHeight: '100%' }}
      >
        <View className="relative flex-1 px-4 pt-16 pb-12 sm:px-6">
          <AnimatedBackground variant="primary" intensity={0.12} />

          <View className="z-10 self-start rounded-full border border-border bg-primary/10 px-4 py-2">
            <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Application Status
            </Text>
          </View>

          <Text className="z-10 mt-6 text-3xl font-black text-foreground md:text-4xl">
            Your Application
          </Text>
          <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
            Status: {existingApplication.status?.toUpperCase() || "PENDING"}
          </Text>

          <View className="z-10 mt-8 rounded-3xl border border-border bg-card p-5 md:p-7">
            <View className="mb-6">
              <StatusBadge status={existingApplication.status} />
            </View>

            {/* Skills */}
            <View className="mb-6 border-b border-border pb-6">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Skills
              </Text>
              <Text className="text-sm text-foreground">
                {existingApplication.skills?.join(", ")}
              </Text>
            </View>

            {/* Preferred Roles */}
            <View className="mb-6 border-b border-border pb-6">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Preferred Roles
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {existingApplication.preferredRoles?.map((role: string, idx: number) => (
                  <View
                    key={idx}
                    className="rounded-full bg-primary/10 px-3 py-1"
                  >
                    <Text className="text-xs font-semibold text-primary">{role}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Experience */}
            {existingApplication.experience && (
              <View className="mb-6 border-b border-border pb-6">
                <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Experience
                </Text>
                <Text className="text-sm text-foreground">
                  {existingApplication.experience}
                </Text>
              </View>
            )}

            {/* Documents */}
            {existingApplication.documents && existingApplication.documents.length > 0 && (
              <View className="mb-6 border-b border-border pb-6">
                <Text className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Documents ({existingApplication.documents.length})
                </Text>
                {existingApplication.documents.map((doc: any, idx: number) => (
                  <View
                    key={idx}
                    className="mb-2 flex-row items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <Text className="text-lg">📄</Text>
                    <View className="flex-1">
                      <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                        {doc.name}
                      </Text>
                      {doc.signedUrl && (
                        <Text className="text-xs text-primary">✓ Uploaded</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Review Notes */}
            {existingApplication.reviewNotes && (
              <View>
                <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Review Notes
                </Text>
                <View className="rounded-lg border border-border bg-background p-3">
                  <Text className="text-sm text-foreground">
                    {existingApplication.reviewNotes}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Action Button */}
          {existingApplication.status === "pending" && (
            <Pressable
              className="z-10 mt-8 items-center rounded-2xl bg-primary px-4 py-4"
              onPress={() => setViewMode("apply")}
            >
              <Text className="text-base font-semibold text-primary-foreground">
                Submit Another Application
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1, minHeight: '100%' }}
      scrollEnabled={true}
    >
      <View className="relative flex-1 px-4 pt-16 pb-12 sm:px-6">
        <AnimatedBackground variant="primary" intensity={0.12} />

        <View className="z-10 self-start rounded-full border border-border bg-primary/10 px-4 py-2">
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Volunteer Application
          </Text>
        </View>

        <Text className="z-10 mt-6 text-3xl font-black text-foreground md:text-4xl">
          Become a Volunteer
        </Text>
        <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
          Complete this form to apply for volunteer role upgrade
        </Text>

        {/* Form Container - with better spacing */}
        <View className="z-10 mt-8 rounded-3xl border border-border bg-card p-5 md:p-7">
          
          {/* Skills Section */}
          <View className="mb-6">
            <Text className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Skills (comma-separated)
            </Text>
            <TextInput
              value={skills}
              onChangeText={setSkills}
              placeholder="e.g. First Aid, CPR, Rescue"
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={2}
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
            />
          </View>

          {/* Experience Section */}
          <View className="mb-6">
            <Text className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Experience
            </Text>
            <TextInput
              value={experience}
              onChangeText={setExperience}
              placeholder="Describe your experience (optional)"
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={3}
              className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
            />
          </View>

          {/* Preferred Roles Section */}
          <View className="mb-6">
            <Text className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Preferred Roles
            </Text>
            <View className="gap-2">
              {[
                { label: "🏥 Medical", value: "medical" },
                { label: "🚒 Rescue", value: "rescue" },
                { label: "📦 Logistics", value: "logistics" },
                { label: "🤝 General", value: "general" },
              ].map((role) => (
                <Pressable
                  key={role.value}
                  onPress={() => toggleRole(role.value)}
                  className={`rounded-xl px-4 py-3 ${
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
          </View>

          {/* Availability Section */}
          <View className="mb-6 flex-row items-center justify-between rounded-2xl border border-border bg-background px-4 py-4">
            <Text className="text-sm font-medium text-foreground">Available for shift work?</Text>
            <Pressable
              onPress={() => setAvailability(!availability)}
              className={`h-6 w-11 rounded-full ${availability ? "bg-primary" : "bg-muted"}`}
            />
          </View>

          {/* Time Slots - conditional */}
          {availability && (
            <View className="mb-6">
              <Text className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Time Slots (comma-separated)
              </Text>
              <TextInput
                value={timeSlots}
                onChangeText={setTimeSlots}
                placeholder="e.g. Monday 9AM-5PM, Weekend flexible"
                placeholderTextColor="#6b7280"
                multiline
                numberOfLines={2}
                className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              />
            </View>
          )}

          {/* Documents Upload Section - IMPROVED */}
          <View className="mb-2">
            <Text className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Supporting Documents
            </Text>
            
            {/* Upload Button */}
            <Pressable
              onPress={() => handleAddDocument(String(userDetails?.userId ?? ""))}
              disabled={uploading || loading}
              className={`rounded-2xl border-2 border-dashed px-4 py-6 ${
                uploading ? "bg-primary/5" : "bg-primary/5"
              }`}
              style={{
                borderColor: uploading ? '#3b82f6' : '#6366f1',
              }}
            >
              <View className="items-center gap-2">
                <Text className="text-2xl">📎</Text>
                <Text className="text-xs font-semibold uppercase text-primary">
                  {uploading ? "Uploading..." : "Tap to Add Document"}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  PDF, Images, Word (Max 10MB)
                </Text>
              </View>
            </Pressable>

            {/* Document List */}
            {documents.length > 0 && (
              <View className="mt-4 gap-2">
                <Text className="text-xs font-semibold text-foreground">
                  Uploaded Documents ({documents.length})
                </Text>
                {documents.map((doc) => {
                  const progress = uploadProgress[doc.id];
                  const fileTypeIcon = doc.type.includes('pdf') ? '📄' : doc.type.includes('image') ? '🖼️' : '📋';
                  
                  return (
                    <View
                      key={doc.id}
                      className="flex-row items-center justify-between rounded-xl border border-border bg-background px-3 py-3"
                    >
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-lg">{fileTypeIcon}</Text>
                          <View className="flex-1">
                            <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                              {doc.name}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              {(doc.size / 1024).toFixed(1)} KB
                            </Text>
                          </View>
                        </View>
                        {progress !== undefined && progress < 100 && (
                          <View className="mt-1 h-1 rounded-full bg-border">
                            <View
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${progress}%` }}
                            />
                          </View>
                        )}
                      </View>
                      <Pressable
                        onPress={() => removeDocument(doc.id)}
                        disabled={uploading || loading}
                        className="ml-2 rounded-lg bg-destructive/10 px-2 py-2"
                      >
                        <Text className="text-sm font-semibold text-destructive">✕</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* Error Messages */}
        {(!!error || !!uploadError) && (
          <Text className="z-10 mt-4 text-sm text-destructive" selectable>
            {error || uploadError}
          </Text>
        )}

        {/* Submit Button */}
        <Pressable
          className={`z-10 mt-8 items-center rounded-2xl py-4 ${
            loading || uploading || documents.length === 0
              ? "bg-muted"
              : "bg-primary"
          }`}
          onPress={submitApplication}
          disabled={loading || uploading || documents.length === 0}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className={`text-base font-semibold ${
              loading || uploading || documents.length === 0
                ? "text-muted-foreground"
                : "text-primary-foreground"
            }`}>
              Submit Application
            </Text>
          )}
        </Pressable>

        {/* Hint Text */}
        {documents.length === 0 && (
          <Text className="z-10 mt-3 text-center text-xs text-muted-foreground">
            Add at least one document to proceed
          </Text>
        )}
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
