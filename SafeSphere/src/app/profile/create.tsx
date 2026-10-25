import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
  Animated,
} from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  User,
  HeartPulse,
  Users,
  ScanFace,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  CircleUserRound,
  MapPin,
} from "lucide-react-native";
import {
  getAppUsers,
  getS3UploadUrl,
  upsertPublicProfile,
} from "../../lib/api";
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

/* ---------------------------------------------------------------------- */
/*  Design tokens                                                          */
/*  Restrained clinical system: neutral surface, single accent, hairline   */
/*  borders, compact spacing. No gradients, no glassmorphism.              */
/* ---------------------------------------------------------------------- */
const COLOR = {
  bg: "#F5F5F6",
  surface: "#FFFFFF",
  border: "#E3E3E6",
  borderStrong: "#D3D3D8",
  ink: "#16161A",
  inkMuted: "#68686F",
  inkFaint: "#9A9AA1",
  accent: "#C2410C",
  accentSoft: "#FCEEE6",
  success: "#15803D",
  successSoft: "#EEF7F0",
  danger: "#B91C1C",
  dangerSoft: "#FBEBEB",
};

const TAB_META: Record<string, { label: string; icon: any }> = {
  basic: { label: "Basic", icon: User },
  medical: { label: "Health", icon: HeartPulse },
  contacts: { label: "Trusted", icon: Users },
  face: { label: "Face ID", icon: ScanFace },
};

/* ---------------------------------------------------------------------- */
/*  Reusable primitives                                                    */
/* ---------------------------------------------------------------------- */

function FormSection({
  title,
  description,
  children,
  last,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View className={`py-4 ${last ? "" : "border-b border-[#E3E3E6]"}`}>
      <Text className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#68686F]">
        {title}
      </Text>
      {description ? (
        <Text className="mt-0.5 text-xs text-[#9A9AA1]">{description}</Text>
      ) : null}
      <View className="mt-3">{children}</View>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-1.5 text-[13px] font-medium text-[#16161A]">
      {children}
    </Text>
  );
}

function PremiumInput(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#B4B4BA"
      {...props}
      className={`rounded-[10px] border border-[#D3D3D8] bg-white px-3.5 py-3 text-[15px] text-[#16161A] ${props.className ?? ""}`}
    />
  );
}

function ChipOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-[10px] border px-3 py-2.5 ${
        active ? "border-[#C2410C] bg-[#FCEEE6]" : "border-[#D3D3D8] bg-white"
      }`}
    >
      <Text
        className={`text-center text-[13px] font-semibold ${
          active ? "text-[#C2410C]" : "text-[#68686F]"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleSwitch({
  label,
  description,
  value,
  onToggle,
}: {
  label: string;
  description?: string;
  value: boolean;
  onToggle: () => void;
}) {
  const thumbAnim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(thumbAnim, {
      toValue: value ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [value, thumbAnim]);

  const translateX = thumbAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 20],
  });

  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center justify-between py-2.5"
    >
      <View className="flex-1 pr-4">
        <Text className="text-[14px] font-medium text-[#16161A]">{label}</Text>
        {description ? (
          <Text className="mt-0.5 text-xs text-[#9A9AA1]">{description}</Text>
        ) : null}
      </View>
      <View
        className={`h-6 w-[42px] justify-center rounded-full px-0.5 ${
          value ? "bg-[#C2410C]" : "bg-[#DEDEE2]"
        }`}
      >
        <Animated.View
          style={{ transform: [{ translateX }] }}
          className="h-5 w-5 rounded-full bg-white"
        />
      </View>
    </Pressable>
  );
}

function StepNav({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: string[];
  activeTab: string;
  onSelect: (tab: string) => void;
}) {
  const activeIndex = tabs.indexOf(activeTab);

  return (
    <View className="flex-row items-start">
      {tabs.map((tab, idx) => {
        const meta = TAB_META[tab];
        const Icon = meta.icon;
        const isActive = tab === activeTab;
        const isDone = idx < activeIndex;
        const isLast = idx === tabs.length - 1;

        return (
          <View key={tab} className="flex-1 flex-row items-center">
            <Pressable
              onPress={() => onSelect(tab)}
              className="flex-1 items-center"
            >
              <View
                className={`h-9 w-9 items-center justify-center rounded-full border ${
                  isActive
                    ? "border-[#C2410C] bg-[#C2410C]"
                    : isDone
                      ? "border-[#C2410C] bg-[#FCEEE6]"
                      : "border-[#D3D3D8] bg-white"
                }`}
              >
                {isDone ? (
                  <Check size={16} color="#C2410C" strokeWidth={2.5} />
                ) : (
                  <Icon
                    size={16}
                    color={isActive ? "#FFFFFF" : "#9A9AA1"}
                    strokeWidth={2}
                  />
                )}
              </View>
              <Text
                className={`mt-1.5 text-[11px] font-semibold ${
                  isActive || isDone ? "text-[#16161A]" : "text-[#9A9AA1]"
                }`}
              >
                {meta.label}
              </Text>
            </Pressable>
            {!isLast && (
              <View
                className={`mb-4 h-[1.5px] flex-1 ${
                  isDone ? "bg-[#C2410C]" : "bg-[#E3E3E6]"
                }`}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function CornerBrackets() {
  return (
    <View className="h-60 w-60 items-center justify-center">
      <View className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-2 border-t-2 border-white/90" />
      <View className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-2 border-t-2 border-white/90" />
      <View className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-2 border-l-2 border-white/90" />
      <View className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-2 border-r-2 border-white/90" />
    </View>
  );
}

/* ---------------------------------------------------------------------- */
/*  Screen                                                                  */
/* ---------------------------------------------------------------------- */

export default function CreateProfileScreen() {
  const { userDetails, authToken, saveAuth, isAuthenticated } =
    useContext(AuthContext);
  const [name, setName] = useState(userDetails?.name || "");
  const [ageInput, setAgeInput] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other">("other");
  const [profileImage, setProfileImage] = useState(
    userDetails?.avatarUrl || "",
  );
  const [sosMessage, setSosMessage] = useState(
    "I need help, please track my location.",
  );
  const [bloodGroup, setBloodGroup] = useState("O+");
  const [allergies, setAllergies] = useState("");
  const [medications, setMedications] = useState("");
  const [diseases, setDiseases] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [autoShareMedical, setAutoShareMedical] = useState(true);
  const [enableLocationTracking, setEnableLocationTracking] = useState(true);
  const [userType, setUserType] = useState<
    "medical" | "fire" | "police" | "ngo" | "other"
  >("other");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("basic");
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [showFaceCamera, setShowFaceCamera] = useState(false);
  const [faceUploadKey, setFaceUploadKey] = useState("");
  const [facePhotoUri, setFacePhotoUri] = useState("");
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
      const combined =
        `${user.name} ${user.phoneNumber} ${user.role}`.toLowerCase();
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
    Animated.timing(tabAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [activeTab, tabAnim]);

  const animatedCardStyle = {
    opacity: tabAnim,
    transform: [
      {
        translateY: tabAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
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
        contacts: emergencyContactName.trim()
          ? [
              {
                name: emergencyContactName.trim(),
                phoneNumber: emergencyContactPhone.trim(),
                relation: "Emergency Contact",
                isPrimary: true,
              },
            ]
          : [],
        appContacts: selectedAppContacts,
        medicalRecord: {
          bloodGroup: bloodGroup as
            | "O+"
            | "A+"
            | "A-"
            | "B+"
            | "B-"
            | "AB+"
            | "AB-"
            | "O-",
          allergies: allergies.trim()
            ? allergies.split(",").map((a) => a.trim())
            : [],
          medications: medications.trim()
            ? medications.split(",").map((m) => m.trim())
            : [],
          diseases: diseases.trim()
            ? diseases.split(",").map((d) => d.trim())
            : [],
          notes: medicalNotes.trim(),
        },
        sosMessage: sosMessage.trim(),
        autoShareMedical,
        enableContinuousTracking: enableLocationTracking,
      };

      if (currentLocation) {
        profileData.location = currentLocation;
      }

      await upsertPublicProfile(profileData);
      await AsyncStorage.setItem(
        "enableContinuousTracking",
        String(enableLocationTracking),
      );

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
        { text: "OK", onPress: () => router.replace("/(tabs)") },
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
      setFacePhotoUri(uri);
      Alert.alert("Face Uploaded", "Face photo captured and uploaded.");
    } catch (uploadErr: any) {
      setFaceUploadKey("");
      setFacePhotoUri("");
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

      setFacePhotoUri(photo.uri);
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

  const stageIndex = tabs.indexOf(activeTab);

  return (
    <View className="flex-1 bg-[#F5F5F6]">
      {/* ------------------------------------------------------------ */}
      {/* Fixed header + step navigation                               */}
      {/* ------------------------------------------------------------ */}
      <View className="border-b border-[#E3E3E6] bg-[#F5F5F6] px-5 pb-4 pt-14">
        <Text className="text-[22px] font-bold text-[#16161A]">
          Create your profile
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-[#68686F]">
          Complete the steps below so responders can identify and assist you
          quickly.
        </Text>

        <View className="mt-6">
          <StepNav tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />
        </View>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
      >
        {/* ------------------------------------------------------------ */}
        {/* Content card                                                 */}
        {/* ------------------------------------------------------------ */}
        <View className="px-5 pt-5">
          <Animated.View
            style={animatedCardStyle}
            className="rounded-2xl border border-[#E3E3E6] bg-white px-4 pt-1"
          >
            {activeTab === "basic" && (
              <View>
                <FormSection title="Profile photo">
                  <View className="flex-row items-center gap-4">
                    <ProfileImagePicker
                      userId={String(userDetails?.userId ?? "")}
                      initialImageUrl={profileImage}
                      onUploadComplete={(key) => setProfileImage(key)}
                    />
                    <Text className="flex-1 text-xs leading-4 text-[#9A9AA1]">
                      A clear, forward-facing photo helps responders confirm
                      your identity on scene.
                    </Text>
                  </View>
                </FormSection>

                <FormSection title="Personal details">
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <FieldLabel>Full name</FieldLabel>
                      <PremiumInput
                        value={name}
                        onChangeText={setName}
                        placeholder="Emma Carter"
                      />
                    </View>
                    <View className="w-24">
                      <FieldLabel>Age</FieldLabel>
                      <PremiumInput
                        value={ageInput}
                        onChangeText={setAgeInput}
                        placeholder="29"
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>

                  <View className="mt-3">
                    <FieldLabel>Gender</FieldLabel>
                    <View className="flex-row gap-2">
                      {[
                        { label: "Male", value: "male" },
                        { label: "Female", value: "female" },
                        { label: "Other", value: "other" },
                      ].map((option) => (
                        <View key={option.value} className="flex-1">
                          <ChipOption
                            label={option.label}
                            active={gender === option.value}
                            onPress={() =>
                              setGender(
                                option.value as "male" | "female" | "other",
                              )
                            }
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                </FormSection>

                <FormSection title="Emergency SOS message">
                  <PremiumInput
                    value={sosMessage}
                    onChangeText={setSosMessage}
                    placeholder="Send help. Share my location."
                    multiline
                    numberOfLines={3}
                    className="min-h-[84px] text-sm"
                    style={{ textAlignVertical: "top" }}
                  />
                </FormSection>

                <FormSection title="Sharing preferences" last>
                  <View className="divide-y divide-[#EDEDEF]">
                    <ToggleSwitch
                      label="Auto-share medical info"
                      description="Sent instantly with every SOS alert"
                      value={autoShareMedical}
                      onToggle={() => setAutoShareMedical(!autoShareMedical)}
                    />
                    <ToggleSwitch
                      label="Continuous location tracking"
                      description="Lets trusted contacts follow you live"
                      value={enableLocationTracking}
                      onToggle={() =>
                        setEnableLocationTracking(!enableLocationTracking)
                      }
                    />
                  </View>
                  {currentLocation ? (
                    <View className="mt-1 flex-row items-center gap-1.5">
                      <MapPin size={12} color="#9A9AA1" />
                      <Text className="text-[11px] text-[#9A9AA1]">
                        Current location detected
                      </Text>
                    </View>
                  ) : null}
                </FormSection>
              </View>
            )}

            {activeTab === "medical" && (
              <View>
                <FormSection title="Blood group">
                  <View className="flex-row flex-wrap gap-2">
                    {["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map(
                      (bg) => (
                        <View key={bg} style={{ width: "23%" }}>
                          <ChipOption
                            label={bg}
                            active={bloodGroup === bg}
                            onPress={() => setBloodGroup(bg)}
                          />
                        </View>
                      ),
                    )}
                  </View>
                </FormSection>

                <FormSection
                  title="Allergies"
                  description="Separate multiple entries with a comma"
                >
                  <PremiumInput
                    value={allergies}
                    onChangeText={setAllergies}
                    placeholder="Peanuts, Penicillin"
                  />
                </FormSection>

                <FormSection
                  title="Medications"
                  description="Separate multiple entries with a comma"
                >
                  <PremiumInput
                    value={medications}
                    onChangeText={setMedications}
                    placeholder="Aspirin, Vitamins"
                  />
                </FormSection>

                <FormSection
                  title="Health conditions"
                  description="Separate multiple entries with a comma"
                >
                  <PremiumInput
                    value={diseases}
                    onChangeText={setDiseases}
                    placeholder="Diabetes, Asthma"
                  />
                </FormSection>

                <FormSection title="Additional notes" last>
                  <PremiumInput
                    value={medicalNotes}
                    onChangeText={setMedicalNotes}
                    placeholder="Any additional medical information"
                    multiline
                    numberOfLines={4}
                    className="min-h-[100px] text-sm"
                    style={{ textAlignVertical: "top" }}
                  />
                </FormSection>
              </View>
            )}

            {activeTab === "contacts" && (
              <View>
                <FormSection title="Primary emergency contact">
                  <View className="gap-3">
                    <View>
                      <FieldLabel>Contact name</FieldLabel>
                      <PremiumInput
                        value={emergencyContactName}
                        onChangeText={setEmergencyContactName}
                        placeholder="Contact name"
                      />
                    </View>
                    <View>
                      <FieldLabel>Phone number</FieldLabel>
                      <PremiumInput
                        value={emergencyContactPhone}
                        onChangeText={setEmergencyContactPhone}
                        placeholder="Phone number"
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>
                </FormSection>

                <FormSection title="Trusted network" last>
                  <View className="mb-3 flex-row items-center gap-2">
                    <View className="flex-1">
                      <PremiumInput
                        value={appUsersSearch}
                        onChangeText={setAppUsersSearch}
                        placeholder="Search name or phone"
                        className="py-2.5"
                      />
                    </View>
                    <Pressable
                      onPress={() => void fetchAppUsers()}
                      className="flex-row items-center gap-1.5 rounded-[10px] border border-[#D3D3D8] bg-white px-3 py-2.5"
                    >
                      <RefreshCw size={13} color="#C2410C" />
                      <Text className="text-xs font-semibold text-[#C2410C]">
                        Refresh
                      </Text>
                    </Pressable>
                  </View>

                  {selectedAppContacts.length > 0 && (
                    <View className="mb-3 flex-row flex-wrap gap-1.5">
                      {selectedAppContacts.map((id) => {
                        const person = appUsers.find(
                          (entry) => entry.userId === id,
                        );
                        return (
                          <Pressable
                            key={id}
                            onPress={() =>
                              setSelectedAppContacts((current) =>
                                current.filter((item) => item !== id),
                              )
                            }
                            className="flex-row items-center gap-1 rounded-full border border-[#D3D3D8] bg-[#F5F5F6] px-2.5 py-1"
                          >
                            <Text className="text-xs font-medium text-[#16161A]">
                              {person?.name || "Contact"}
                            </Text>
                            <X size={11} color="#68686F" />
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  <View>
                    {appUsersLoading ? (
                      <View className="items-center rounded-[10px] border border-[#E3E3E6] py-6">
                        <ActivityIndicator color="#C2410C" />
                      </View>
                    ) : filteredAppUsers.length === 0 ? (
                      <Text className="py-2 text-sm text-[#9A9AA1]">
                        No users found.
                      </Text>
                    ) : (
                      <View className="divide-y divide-[#EDEDEF] border-t border-[#EDEDEF]">
                        {filteredAppUsers.map((person) => {
                          const selected = selectedAppContacts.includes(
                            person.userId,
                          );
                          return (
                            <Pressable
                              key={person.userId}
                              onPress={() => {
                                setSelectedAppContacts((current) =>
                                  current.includes(person.userId)
                                    ? current.filter(
                                        (item) => item !== person.userId,
                                      )
                                    : [...current, person.userId],
                                );
                              }}
                              className="flex-row items-center gap-3 py-3"
                            >
                              {person.profileImageSignedUrl ||
                              person.profileImage ? (
                                <Image
                                  source={{
                                    uri:
                                      person.profileImageSignedUrl ||
                                      person.profileImage ||
                                      "",
                                  }}
                                  className="h-10 w-10 rounded-full"
                                />
                              ) : (
                                <View className="h-10 w-10 items-center justify-center rounded-full bg-[#F5F5F6]">
                                  <CircleUserRound size={20} color="#9A9AA1" />
                                </View>
                              )}
                              <View className="flex-1">
                                <Text className="text-[14px] font-medium text-[#16161A]">
                                  {person.name}
                                </Text>
                                <Text className="text-xs text-[#9A9AA1]">
                                  {person.phoneNumber}
                                </Text>
                              </View>
                              <View
                                className={`h-5 w-5 items-center justify-center rounded-[6px] border ${
                                  selected
                                    ? "border-[#C2410C] bg-[#C2410C]"
                                    : "border-[#D3D3D8] bg-white"
                                }`}
                              >
                                {selected && (
                                  <Check
                                    size={13}
                                    color="#FFFFFF"
                                    strokeWidth={3}
                                  />
                                )}
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                </FormSection>
              </View>
            )}

            {activeTab === "face" && (
              <View>
                <FormSection title="Face verification" last>
                  <Text className="mb-4 text-[13px] leading-5 text-[#68686F]">
                    Capture a clear, well-lit photo of your face. This confirms
                    your identity to emergency responders.
                  </Text>

                  {!showFaceCamera ? (
                    <View className="items-center rounded-xl border border-[#E3E3E6] bg-[#FAFAFA] px-4 py-6">
                      {facePhotoUri ? (
                        <View className="items-center">
                          <View className="relative">
                            <Image
                              source={{ uri: facePhotoUri }}
                              className="h-48 w-48 rounded-xl border border-[#E3E3E6]"
                            />
                            <View className="absolute -bottom-2 -right-2 h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#15803D]">
                              <Check
                                size={14}
                                color="#FFFFFF"
                                strokeWidth={3}
                              />
                            </View>
                          </View>
                          <Text className="mt-3 text-[13px] font-semibold text-[#15803D]">
                            Face verified and uploaded
                          </Text>
                        </View>
                      ) : (
                        <View className="h-48 w-48 items-center justify-center rounded-xl border border-dashed border-[#D3D3D8] bg-white">
                          <ScanFace
                            size={30}
                            color="#9A9AA1"
                            strokeWidth={1.5}
                          />
                          <Text className="mt-2 px-6 text-center text-xs text-[#9A9AA1]">
                            No photo captured yet
                          </Text>
                        </View>
                      )}

                      <View className="mt-5 w-full flex-row gap-2.5">
                        <Pressable
                          onPress={openFaceCamera}
                          className="flex-1 items-center rounded-[10px] bg-[#C2410C] px-4 py-3"
                        >
                          <Text className="text-center text-sm font-semibold text-white">
                            {faceUploadKey ? "Retake photo" : "Open camera"}
                          </Text>
                        </Pressable>
                        {facePhotoUri ? (
                          <Pressable
                            onPress={() => {
                              setFacePhotoUri("");
                              setFaceUploadKey("");
                            }}
                            className="flex-1 items-center rounded-[10px] border border-[#D3D3D8] bg-white px-4 py-3"
                          >
                            <Text className="text-center text-sm font-semibold text-[#68686F]">
                              Clear
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ) : (
                    <View className="overflow-hidden rounded-xl border border-[#E3E3E6] bg-black">
                      <View className="relative">
                        <CameraView
                          ref={cameraRef}
                          style={{ width: "100%", height: 420 }}
                          facing="front"
                        />

                        <View
                          pointerEvents="none"
                          className="absolute inset-0 items-center justify-center"
                        >
                          <CornerBrackets />
                        </View>

                        <View className="absolute left-0 right-0 top-4 items-center">
                          <View className="rounded-md bg-black/55 px-3 py-1.5">
                            <Text className="text-xs font-medium text-white">
                              Align your face within the frame
                            </Text>
                          </View>
                        </View>

                        <View className="absolute bottom-6 left-0 right-0 flex-row items-center justify-center gap-8">
                          <Pressable
                            onPress={() => setShowFaceCamera(false)}
                            className="h-11 w-11 items-center justify-center rounded-full border border-white/50 bg-black/30"
                          >
                            <X size={18} color="#FFFFFF" />
                          </Pressable>
                          <Pressable
                            onPress={captureFacePhoto}
                            className="h-16 w-16 items-center justify-center rounded-full border-[3px] border-white bg-[#C2410C]"
                          >
                            <View className="h-12 w-12 rounded-full bg-white" />
                          </Pressable>
                          <View className="h-11 w-11" />
                        </View>
                      </View>
                    </View>
                  )}

                  {faceUploading && (
                    <View className="mt-3 flex-row items-center gap-3 rounded-[10px] border border-[#E3E3E6] bg-[#FAFAFA] px-4 py-3">
                      <ActivityIndicator color="#C2410C" />
                      <Text className="text-sm text-[#68686F]">
                        Uploading face image…
                      </Text>
                    </View>
                  )}
                </FormSection>
              </View>
            )}

            {!!error && (
              <View className="mb-4 flex-row items-start gap-2 rounded-[10px] border border-[#F3C6C6] bg-[#FBEBEB] px-3.5 py-3">
                <AlertCircle
                  size={16}
                  color="#B91C1C"
                  style={{ marginTop: 1 }}
                />
                <Text className="flex-1 text-[13px] font-medium text-[#B91C1C]">
                  {error}
                </Text>
              </View>
            )}
          </Animated.View>

          {/* -------------------------------------------------------- */}
          {/* Actions                                                  */}
          {/* -------------------------------------------------------- */}
          <View className="mt-5 gap-2.5">
            <Pressable
              className="items-center rounded-xl bg-[#C2410C] px-4 py-3.5"
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
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-center text-[15px] font-semibold text-white">
                  {activeTab === "face"
                    ? "Complete profile"
                    : `Continue · Step ${stageIndex + 2} of ${tabs.length}`}
                </Text>
              )}
            </Pressable>

            {activeTab !== "basic" && (
              <Pressable
                className="items-center rounded-xl border border-[#D3D3D8] bg-white px-4 py-3.5"
                onPress={() => {
                  const currentIndex = tabs.indexOf(activeTab);
                  if (currentIndex > 0) {
                    setActiveTab(tabs[currentIndex - 1]);
                  }
                }}
              >
                <Text className="text-center text-[15px] font-semibold text-[#68686F]">
                  Back
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
