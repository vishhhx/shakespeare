import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert, Image, Animated } from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { getAppUsers, getS3UploadUrl, upsertPublicProfile } from "../../lib/api";
import AnimatedBackground from "../../components/animated-background";
import ProfileImagePicker from "../../components/profile-image-picker";
import { AuthContext } from "../../context/authContext";
import * as Location from "expo-location";

import AsyncStorage from "@react-native-async-storage/async-storage";
type AppUser = {
  userId: string;
  name: string;
  phoneNumber: string;
  role: string;
  isVerified: boolean;
  isprofileComplete: boolean;
  profileImage?: string | null;
  profileImageSignedUrl?: string | null;
};

export default function CreateProfileScreen() {
  const { userDetails, authToken, saveAuth, isAuthenticated } = useContext(AuthContext);
  const [name, setName] = useState(userDetails?.name || "");
  const [ageInput, setAgeInput] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other">("other");
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
    const [userType, setUserType] = useState<"medical" | "fire" | "police" | "ngo" | "other">("other");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("basic");
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showFaceCamera, setShowFaceCamera] = useState(false);
  const [faceUploadKey, setFaceUploadKey] = useState("");
  const [faceUploading, setFaceUploading] = useState(false);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [appUsersLoading, setAppUsersLoading] = useState(false);
  const [appUsersSearch, setAppUsersSearch] = useState("");
  const [selectedAppContacts, setSelectedAppContacts] = useState<string[]>([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const tabAnim = useRef(new Animated.Value(1)).current;

  const tabs = ["basic", "medical", "contacts", "face"];

  const filteredAppUsers = useMemo(() => {
    const query = appUsersSearch.trim().toLowerCase();
    if (!query) {
      return appUsers;
    }

    return appUsers.filter((user) => {
      const combined = `${user.name} ${user.phoneNumber} ${user.role}`.toLowerCase();
      return combined.includes(query);
    });
  }, [appUsers, appUsersSearch]);

  useEffect(() => {
    if (!isAuthenticated || !userDetails) {
      router.replace("/");
    }
    getLocation();
  }, [isAuthenticated, userDetails]);

  const fetchAppUsers = async () => {
    try {
      setAppUsersLoading(true);
      const response = await getAppUsers();
      setAppUsers(response.users ?? []);
    } catch (err) {
      console.error("Error fetching app users:", err);
    } finally {
      setAppUsersLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void fetchAppUsers();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    tabAnim.setValue(0);
    Animated.spring(tabAnim, {
      toValue: 1,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    }).start();
  }, [activeTab, tabAnim]);

  const animatedCardStyle = {
    opacity: tabAnim,
    transform: [
      {
        translateY: tabAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
      {
        scale: tabAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.97, 1],
        }),
      },
    ],
  };

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

    const parsedAge = Number(ageInput);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      setError("Please enter a valid age between 1 and 120");
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

    if (!faceUploadKey.trim()) {
      setError("Please click your face photo before creating profile");
      setActiveTab("face");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const profileData: any = {
        name: name.trim(),
        age: parsedAge,
        gender,
        profileImage: profileImage.trim(),
          userType,
        faceEmbeddingPhoto: faceUploadKey,
        contacts: emergencyContactName.trim() ? [{
          name: emergencyContactName.trim(),
          phoneNumber: emergencyContactPhone.trim(),
          relation: "Emergency Contact",
          isPrimary: true,
        }] : [],
        appContacts: selectedAppContacts,
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
  await AsyncStorage.setItem("enableContinuousTracking", String(enableLocationTracking));
      
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

  const uploadFaceToS3 = async (uri: string) => {
    if (!userDetails?.userId) {
      setError("Session expired. Please login again.");
      return;
    }

    setFaceUploading(true);
    setError("");

    try {
      const key = `${String(userDetails.userId)}.jpg`;
      const { url } = await getS3UploadUrl({
        key,
        contentType: "image/jpeg",
        bucket: "face",
      });

      const file = await fetch(uri);
      const blob = await file.blob();

      const uploadResponse = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("Unable to upload face photo");
      }

      setFaceUploadKey(key);
      Alert.alert("Face Uploaded", "Face photo captured and uploaded.");
    } catch (uploadErr: any) {
      setFaceUploadKey("");
      setError(uploadErr?.message || "Face upload failed");
    } finally {
      setFaceUploading(false);
    }
  };

  const captureFacePhoto = async () => {
    if (!cameraRef.current) {
      setError("Camera is not ready");
      return;
    }

    try {
      setError("");
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) {
        setError("Unable to capture image");
        return;
      }

      setShowFaceCamera(false);
      await uploadFaceToS3(photo.uri);
    } catch (captureErr: any) {
      setError(captureErr?.message || "Face capture failed");
    }
  };

  const openFaceCamera = async () => {
    const granted = cameraPermission?.granted ?? false;
    if (!granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        setError("Camera permission is required for face capture");
        return;
      }
    }

    setShowFaceCamera(true);
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-6 pt-16 pb-4 border-b border-border bg-background">
        <View className="self-start rounded-full border border-border bg-primary/10 px-4 py-2">
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Complete Profile</Text>
        </View>
        <Text className="mt-4 text-4xl font-black text-foreground">Profile Setup</Text>
        <Text className="mt-2 text-sm leading-6 text-muted-foreground">
          Complete all sections to fully set up your profile
        </Text>
      </View>

      <View className="px-6 py-3 border-b border-border bg-background">
        <View className="flex-row gap-2">
          {tabs.map((tab) => (
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
                {tab === "basic" ? "Basic" : tab === "medical" ? "Medical" : tab === "contacts" ? "Contacts" : "Face"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
      >
      <View className="relative flex-1 px-6 pt-4 pb-10">
        <AnimatedBackground variant="primary" intensity={0.12} />

        {/* Basic Info Tab */}
        {activeTab === "basic" && (
          <Animated.View style={animatedCardStyle}>
          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
            <ProfileImagePicker
              userId={String(userDetails?.userId ?? "")}
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
              Age
            </Text>
            <TextInput
              value={ageInput}
              onChangeText={setAgeInput}
              placeholder="Enter your age"
              placeholderTextColor="#6b7280"
              keyboardType="number-pad"
              className="rounded-2xl border border-border bg-background px-4 py-4 text-base text-foreground"
            />

            <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Gender
            </Text>
            <View className="flex-row gap-2">
              {[
                { label: "Male", value: "male" },
                { label: "Female", value: "female" },
                { label: "Other", value: "other" },
              ].map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setGender(option.value as "male" | "female" | "other")}
                  className={`flex-1 rounded-xl px-3 py-3 ${
                    gender === option.value
                      ? "bg-primary"
                      : "border border-border bg-background"
                  }`}
                >
                  <Text
                    className={`text-center font-semibold ${
                      gender === option.value ? "text-primary-foreground" : "text-foreground"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

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

            <View className="mt-5 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Current Selection
              </Text>
              <Text className="mt-2 text-sm text-foreground">
                {name.trim() ? name.trim() : "Your profile details will appear here"}
              </Text>
            </View>
          </View>
          </Animated.View>
        )}

        {/* Medical Info Tab */}
        {activeTab === "medical" && (
          <Animated.View style={animatedCardStyle}>
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
          </Animated.View>
        )}

        {/* Contacts Tab */}
        {activeTab === "contacts" && (
          <Animated.View style={animatedCardStyle}>
          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
            <Text className="text-lg font-bold text-foreground">Select App Contacts</Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Choose people already using the app to add as your trusted contacts.
            </Text>

            <Pressable
              onPress={() => void fetchAppUsers()}
              className="mt-3 self-start rounded-full border border-border bg-background px-4 py-2"
            >
              <Text className="text-xs font-semibold text-foreground">
                {appUsersLoading ? "Refreshing users..." : "Refresh users"}
              </Text>
            </Pressable>

            <TextInput
              value={appUsersSearch}
              onChangeText={setAppUsersSearch}
              placeholder="Search by name or phone"
              placeholderTextColor="#6b7280"
              className="mt-4 rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground"
            />

            <View className="mt-4 rounded-2xl border border-dashed border-border bg-background p-4">
              <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Emergency Contact
              </Text>
              <TextInput
                value={emergencyContactName}
                onChangeText={setEmergencyContactName}
                placeholder="Emergency contact name"
                placeholderTextColor="#6b7280"
                className="mt-3 rounded-2xl border border-border bg-card px-4 py-4 text-base text-foreground"
              />
              <TextInput
                value={emergencyContactPhone}
                onChangeText={setEmergencyContactPhone}
                placeholder="Emergency contact phone"
                placeholderTextColor="#6b7280"
                keyboardType="phone-pad"
                className="mt-3 rounded-2xl border border-border bg-card px-4 py-4 text-base text-foreground"
              />
            </View>

            <View className="mt-5 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Selected App Contacts
              </Text>
              {selectedAppContacts.length === 0 ? (
                <Text className="mt-2 text-sm text-muted-foreground">No app contacts selected yet.</Text>
              ) : (
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {selectedAppContacts.map((id) => {
                    const person = appUsers.find((entry) => entry.userId === id);
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setSelectedAppContacts((current) => current.filter((item) => item !== id))}
                        className="rounded-full bg-primary/10 px-3 py-2"
                      >
                        <Text className="text-xs font-semibold text-primary">
                          {person?.name || id}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              App Users
            </Text>
            {appUsersLoading ? (
              <View className="rounded-2xl border border-border bg-background p-4">
                <ActivityIndicator />
              </View>
            ) : (
              <View className="gap-3">
                {filteredAppUsers.length === 0 ? (
                  <Text className="text-sm text-muted-foreground">No users found.</Text>
                ) : (
                  filteredAppUsers.map((person) => {
                    const selected = selectedAppContacts.includes(person.userId);
                    return (
                      <Pressable
                        key={person.userId}
                        onPress={() => {
                          setSelectedAppContacts((current) =>
                            current.includes(person.userId)
                              ? current.filter((item) => item !== person.userId)
                              : [...current, person.userId],
                          );
                        }}
                        className={`flex-row items-center gap-3 rounded-2xl border px-4 py-4 ${
                          selected ? "border-primary bg-primary/5" : "border-border bg-background"
                        }`}
                      >
                        <Image
                          source={{
                            uri:
                              person.profileImageSignedUrl ||
                              person.profileImage ||
                              "https://cdn-icons-png.flaticon.com/512/149/149071.png",
                          }}
                          className="h-12 w-12 rounded-full"
                        />
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-foreground">{person.name}</Text>
                          <Text className="text-xs text-muted-foreground">{person.phoneNumber}</Text>
                          <Text className="text-xs text-muted-foreground capitalize">{person.role}</Text>
                        </View>
                        <Text className={`text-sm font-bold ${selected ? "text-primary" : "text-muted-foreground"}`}>
                          {selected ? "Selected" : "Add"}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            )}
          </View>
          </Animated.View>
        )}

        {activeTab === "face" && (
          <Animated.View style={animatedCardStyle}>
          <View className="z-10 mt-6 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
            <Text className="text-sm text-foreground">Click your face photo to continue. JPG only.</Text>

            {!showFaceCamera ? (
              <View className="mt-4 gap-3">
                <Pressable
                  onPress={openFaceCamera}
                  className="rounded-xl bg-primary px-4 py-3"
                >
                  <Text className="text-center font-semibold text-primary-foreground">
                    {faceUploadKey ? "Retake Face Photo" : "Open Camera"}
                  </Text>
                </Pressable>

                {faceUploading && (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#111827" />
                    <Text className="text-sm text-muted-foreground">Uploading face image...</Text>
                  </View>
                )}

                {!!faceUploadKey && (
                  <Text className="text-sm font-semibold text-green-700">Face photo uploaded successfully.</Text>
                )}
              </View>
            ) : (
              <View className="mt-4 gap-3">
                <View className="overflow-hidden rounded-2xl">
                  <CameraView
                    ref={cameraRef}
                    style={{ width: "100%", height: 320 }}
                    facing="front"
                  />
                </View>

                <View className="flex-row gap-2">
                  <Pressable
                    onPress={captureFacePhoto}
                    className="flex-1 rounded-xl bg-primary px-4 py-3"
                  >
                    <Text className="text-center font-semibold text-primary-foreground">Capture Face</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setShowFaceCamera(false)}
                    className="flex-1 rounded-xl border border-border bg-background px-4 py-3"
                  >
                    <Text className="text-center font-semibold text-foreground">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
          </Animated.View>
        )}

        {!!error && (
          <Text className="z-10 mt-3 text-sm text-destructive" selectable>
            {error}
          </Text>
        )}

        <Pressable
          className="z-10 mt-8 items-center rounded-2xl bg-primary py-4"
          onPress={() => {
            if (activeTab === "face") {
              void submitProfile();
              return;
            }

            const currentIndex = tabs.indexOf(activeTab);
            if (currentIndex >= 0 && currentIndex < tabs.length - 1) {
              setActiveTab(tabs[currentIndex + 1]);
            }
          }}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-primary-foreground">
              {activeTab === "face" ? "Complete Profile" : "Next Step"}
            </Text>
          )}
        </Pressable>

        {activeTab !== "basic" && (
          <Pressable
            className="z-10 mt-2 items-center rounded-2xl border border-border py-4"
            onPress={() => {
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
    </View>
  );
}