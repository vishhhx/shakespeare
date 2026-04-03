import { useContext, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { api, upsertPublicProfile } from "../../lib/api";
import AnimatedBackground from "../../components/animated-background";
import ProfileImagePicker from "../../components/profile-image-picker";
import { AuthContext } from "../../context/authContext";
import * as Location from "expo-location";

export default function CreateProfileScreen() {
  const { userDetails, authToken, saveAuth, isAuthenticated } = useContext(AuthContext);
  const [name, setName] = useState(userDetails?.name || "");
  const [profileImage, setProfileImage] = useState(userDetails?.avatarUrl || "");
  const [sosMessage, setSosMessage] = useState("I need help, please track my location.");
  const [bloodGroup, setBloodGroup] = useState("O+");
  const [allergies, setAllergies] = useState("");
  const [medications, setMedications] = useState("");
  const [diseases, setDiseases] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [autoShareMedical, setAutoShareMedical] = useState(true);
  const [enableLocationTracking, setEnableLocationTracking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("basic"); // basic, medical, emergency, location
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !userDetails) {
      router.replace("/");
    }
    getLocation();
  }, [isAuthenticated, userDetails]);

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setCurrentLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      }
    } catch (err) {
      console.error("Location error:", err);
    }
  };

  const submitProfile = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    if (!profileImage.trim()) {
      setError("Please add a profile image");
      return;
    }

    if (!emergencyContactName.trim() || !emergencyContactPhone.trim()) {
      setError("Please add emergency contact information");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const profileData: any = {
        name: name.trim(),
        profileImage: profileImage.trim(),
        contacts: emergencyContactName.trim() ? [{
          name: emergencyContactName.trim(),
          phoneNumber: emergencyContactPhone.trim(),
          relation: "Emergency Contact",
          isPrimary: true,
        }] : [],
        appContacts: [],
        medicalRecord: {
          bloodGroup: bloodGroup as "O+" | "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O-",
          allergies: allergies.trim() ? allergies.split(",").map(a => a.trim()) : [],
          medications: medications.trim() ? medications.split(",").map(m => m.trim()) : [],
          diseases: diseases.trim() ? diseases.split(",").map(d => d.trim()) : [],
          notes: medicalNotes.trim(),
        },
        sosMessage: sosMessage.trim(),
        autoShareMedical,
        enableContinuousTracking: enableLocationTracking,
      };

      // Add location if available
      if (currentLocation) {
        profileData.location = currentLocation;
      }

      await upsertPublicProfile(profileData);
      
      await saveAuth({
        user: {
          userId: String(userDetails?.userId),
          phoneNumber: String(userDetails?.phoneNumber ?? ""),
          name: name.trim(),
          role: "public",
          isVerified: Boolean(userDetails?.isVerified ?? false),
          avatarUrl: profileImage.trim(),
          isprofileComplete: true,
        },
        token: authToken ?? undefined,
      });

      Alert.alert("Success", "Profile updated successfully!", [
        { text: "OK", onPress: () => router.replace("/(tabs)") }
      ]);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message;
      setError(message || "Unable to update profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View className="relative flex-1 px-6 pt-16 pb-10">
        <AnimatedBackground variant="primary" intensity={0.12} />

        <View className="z-10 self-start rounded-full border border-border bg-primary/10 px-4 py-2">
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Complete Profile</Text>
        </View>

        <Text className="z-10 mt-6 text-4xl font-black text-foreground">Profile Setup</Text>
        <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
          Complete all sections to fully set up your profile{activeTab === "basic" ? "" : ` (${activeTab === "medical" ? "Medical" : "Emergency"} Info)`}
        </Text>

        {/* Tab Navigation */}
        <View className="z-10 mt-6 flex-row gap-2">
          {["basic", "medical", "emergency"].map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              className={`flex-1 rounded-xl px-4 py-3 ${
                activeTab === tab
                  ? "bg-primary"
                  : "bg-card border border-border"
              }`}
            >
              <Text
                className={`text-center text-xs font-semibold uppercase ${
                  activeTab === tab ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {tab === "basic" ? "Basic" : tab === "medical" ? "Medical" : "Emergency"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Basic Info Tab */}
        {activeTab === "basic" && (
          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
            <ProfileImagePicker
              initialImageUrl={profileImage}
              onUploadComplete={(key) => setProfileImage(key)}
            />

            <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Full Name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Enter your full name"
              placeholderTextColor="#6b7280"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-base text-foreground"
            />

            <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              SOS Message
            </Text>
            <TextInput
              value={sosMessage}
              onChangeText={setSosMessage}
              placeholder="Your SOS message"
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={3}
              className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
            />

            <View className="mt-5 flex-row items-center justify-between rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-sm text-foreground">Auto-share Medical Info</Text>
              <Pressable
                onPress={() => setAutoShareMedical(!autoShareMedical)}
                className={`h-6 w-11 rounded-full ${autoShareMedical ? "bg-primary" : "bg-muted"}`}
              />
            </View>

            <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-border bg-background px-4 py-4">
              <View>
                <Text className="text-sm font-semibold text-foreground">Enable Location Tracking</Text>
                <Text className="text-xs text-muted-foreground">Helps authorities find nearest support</Text>
              </View>
              <Pressable
                onPress={() => setEnableLocationTracking(!enableLocationTracking)}
                className={`h-6 w-11 rounded-full ${enableLocationTracking ? "bg-primary" : "bg-muted"}`}
              />
            </View>
          </View>
        )}

        {/* Medical Info Tab */}
        {activeTab === "medical" && (
          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Blood Group
            </Text>
            <View className="gap-2">
              <View className="flex-row flex-wrap gap-2">
                {["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((bg) => (
                  <Pressable
                    key={bg}
                    onPress={() => setBloodGroup(bg)}
                    className={`flex-1 min-w-[45%] rounded-xl px-3 py-3 ${
                      bloodGroup === bg
                        ? "bg-primary"
                        : "border border-border bg-background"
                    }`}
                  >
                    <Text
                      className={`text-center font-semibold ${
                        bloodGroup === bg ? "text-primary-foreground" : "text-foreground"
                      }`}
                    >
                      {bg}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Allergies (comma-separated)
            </Text>
            <TextInput
              value={allergies}
              onChangeText={setAllergies}
              placeholder="e.g. Peanuts, Penicillin"
              placeholderTextColor="#6b7280"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
            />

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Current Medications (comma-separated)
            </Text>
            <TextInput
              value={medications}
              onChangeText={setMedications}
              placeholder="e.g. Aspirin, Vitamins"
              placeholderTextColor="#6b7280"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
            />

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Health Conditions (comma-separated)
            </Text>
            <TextInput
              value={diseases}
              onChangeText={setDiseases}
              placeholder="e.g. Diabetes, Asthma"
              placeholderTextColor="#6b7280"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
            />

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Additional Notes
            </Text>
            <TextInput
              value={medicalNotes}
              onChangeText={setMedicalNotes}
              placeholder="Any additional medical information"
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={3}
              className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
            />
          </View>
        )}

        {/* Emergency Contact Tab */}
        {activeTab === "emergency" && (
          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Emergency Contact Name
            </Text>
            <TextInput
              value={emergencyContactName}
              onChangeText={setEmergencyContactName}
              placeholder="Enter emergency contact name"
              placeholderTextColor="#6b7280"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-base text-foreground"
            />

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Emergency Contact Phone
            </Text>
            <TextInput
              value={emergencyContactPhone}
              onChangeText={setEmergencyContactPhone}
              placeholder="Enter emergency contact phone"
              placeholderTextColor="#6b7280"
              keyboardType="phone-pad"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-base text-foreground"
            />
          </View>
        )}

        {!!error && (
          <Text className="z-10 mt-3 text-sm text-destructive" selectable>
            {error}
          </Text>
        )}

        <Pressable
          className="z-10 mt-8 items-center rounded-2xl bg-primary py-4"
          onPress={submitProfile}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-primary-foreground">
              {activeTab === "emergency" ? "Complete Profile" : "Next Step"}
            </Text>
          )}
        </Pressable>

        {activeTab !== "basic" && (
          <Pressable
            className="z-10 mt-2 items-center rounded-2xl border border-border py-4"
            onPress={() => {
              const tabs = ["basic", "medical", "emergency"];
              const currentIndex = tabs.indexOf(activeTab);
              if (currentIndex > 0) {
                setActiveTab(tabs[currentIndex - 1]);
              }
            }}
          >
            <Text className="text-base font-semibold text-foreground">Back</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}