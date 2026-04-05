import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, Animated } from "react-native";
import { router } from "expo-router";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "../../context/authContext";
import { useLocationTracking } from "../../lib/useLocationTracking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPublicProfile } from "../../lib/api";

type PublicProfile = {
  name?: string;
  phoneNumber?: string;
  profileImage?: string;
  profileImageSignedUrl?: string;
  userType?: "medical" | "fire" | "police" | "ngo" | "other";
  contacts?: Array<{ name: string; phoneNumber: string; relation?: string }>;
  medicalRecord?: {
    bloodGroup?: string;
    allergies?: string[];
    medications?: string[];
    diseases?: string[];
    notes?: string;
  };
  sosMessage?: string;
  autoShareMedical?: boolean;
  enableContinuousTracking?: boolean;
};

export default function ProfileTab() {
  const { userDetails, logout } = useContext(AuthContext);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const profileAnim = useRef(new Animated.Value(0)).current;

  const animateProfileSection = useCallback(() => {
    profileAnim.setValue(0);
    Animated.spring(profileAnim, {
      toValue: 1,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    }).start();
  }, [profileAnim]);

  const animatedSectionStyle = {
    opacity: profileAnim,
    transform: [
      {
        translateY: profileAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [20, 0],
        }),
      },
      {
        scale: profileAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.97, 1],
        }),
      },
    ],
  };

  // Get tracking preference from storage
  useEffect(() => {
    const loadTrackingPreference = async () => {
      try {
        const enabled = await AsyncStorage.getItem("enableContinuousTracking");
        setTrackingEnabled(enabled === "true");
      } catch (err) {
        console.error("Error loading tracking preference:", err);
      }
    };

    loadTrackingPreference();
  }, []);

  const fetchProfile = useCallback(async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) {
        setRefreshingProfile(true);
      } else {
        setLoadingProfile(true);
      }
      setProfileError("");
      const response = await getPublicProfile();
      setProfile(response?.profile ?? null);
      animateProfileSection();
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.message || "Unable to load profile details";
      setProfileError(message);
    } finally {
      setLoadingProfile(false);
      setRefreshingProfile(false);
    }
  }, [animateProfileSection]);

  useEffect(() => {
    void fetchProfile(false);
  }, [fetchProfile]);

  // Use location tracking hook
  const { isTracking, lastUpdateTime, error } = useLocationTracking({
    enableTracking: trackingEnabled,
    intervalSeconds: 30,
    debug: true,
  });

  const toggleTracking = async () => {
    try {
      const newState = !trackingEnabled;
      await AsyncStorage.setItem("enableContinuousTracking", String(newState));
      setTrackingEnabled(newState);
    } catch (err) {
      console.error("Error toggling tracking:", err);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-6 pb-3 pt-16 flex-row items-center justify-between border-b border-border bg-background">
        <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Profile</Text>
        <Pressable
          onPress={() => void fetchProfile(true)}
          className="rounded-full border border-border bg-card px-4 py-2"
        >
          <Text className="text-xs font-semibold text-foreground">
            {refreshingProfile ? "Refreshing..." : "Refresh"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View className="flex-1 px-6 pb-10 pt-4">
          <Animated.View style={animatedSectionStyle}>
            <View className="items-center rounded-3xl border border-border bg-card p-5">
        <Image
          source={{
            uri:
              profile?.profileImageSignedUrl ||
              profile?.profileImage ||
              userDetails?.avatarUrl ||
              "https://cdn-icons-png.flaticon.com/512/149/149071.png",
          }}
          className="h-28 w-28 rounded-full"
        />
        <Text className="mt-4 text-2xl font-black text-foreground">
          {profile?.name || userDetails?.name || "Profile"}
        </Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          {profile?.phoneNumber || userDetails?.phoneNumber || "No phone number"}
        </Text>
        {!!profile?.userType && (
          <View className="mt-3 rounded-full bg-primary/10 px-3 py-1">
            <Text className="text-xs font-semibold uppercase text-primary">{profile.userType}</Text>
          </View>
        )}
            </View>
          </Animated.View>

      {loadingProfile ? (
        <View className="mt-6 items-center rounded-2xl border border-border bg-card p-5">
          <ActivityIndicator />
          <Text className="mt-2 text-sm text-muted-foreground">Loading profile details...</Text>
        </View>
      ) : (
        <>
          {!!profileError && (
            <Text className="mt-4 text-sm text-destructive">{profileError}</Text>
          )}

          <View className="mt-6 rounded-2xl border border-border bg-card p-4">
            <Text className="text-sm font-semibold text-foreground">Profile Details</Text>
            <Text className="mt-2 text-xs text-muted-foreground">Blood Group</Text>
            <Text className="text-sm text-foreground">{profile?.medicalRecord?.bloodGroup || "N/A"}</Text>

            <Text className="mt-3 text-xs text-muted-foreground">Allergies</Text>
            <Text className="text-sm text-foreground">{profile?.medicalRecord?.allergies?.join(", ") || "None"}</Text>

            <Text className="mt-3 text-xs text-muted-foreground">Medications</Text>
            <Text className="text-sm text-foreground">{profile?.medicalRecord?.medications?.join(", ") || "None"}</Text>

            <Text className="mt-3 text-xs text-muted-foreground">Diseases</Text>
            <Text className="text-sm text-foreground">{profile?.medicalRecord?.diseases?.join(", ") || "None"}</Text>

            <Text className="mt-3 text-xs text-muted-foreground">SOS Message</Text>
            <Text className="text-sm text-foreground">{profile?.sosMessage || "Not set"}</Text>
          </View>

          {!!profile?.contacts?.length && (
            <View className="mt-4 rounded-2xl border border-border bg-card p-4">
              <Text className="text-sm font-semibold text-foreground">Emergency Contacts</Text>
              {profile.contacts.map((contact, idx) => (
                <View key={`${contact.phoneNumber}-${idx}`} className="mt-3 rounded-xl border border-border bg-background p-3">
                  <Text className="text-sm font-semibold text-foreground">{contact.name}</Text>
                  <Text className="text-xs text-muted-foreground">{contact.phoneNumber}</Text>
                  {!!contact.relation && <Text className="text-xs text-muted-foreground">{contact.relation}</Text>}
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Location Tracking Status */}
      <View className="mt-6 rounded-2xl border border-border bg-card p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">Location Tracking</Text>
            <Text className="mt-1 text-xs text-muted-foreground">
              {isTracking ? "Active - Location updated every 30s" : "Inactive"}
            </Text>
            {lastUpdateTime && (
              <Text className="mt-1 text-xs text-green-600">
                Last update: {lastUpdateTime.toLocaleTimeString()}
              </Text>
            )}
            {error && (
              <Text className="mt-1 text-xs text-red-600">
                Error: {error}
              </Text>
            )}
          </View>
          <Pressable
            onPress={toggleTracking}
            className={`h-12 w-12 items-center justify-center rounded-full ${
              trackingEnabled ? "bg-green-500" : "bg-muted"
            }`}
          >
            <Text className="text-xl">{trackingEnabled ? "✓" : "○"}</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        className="mt-8 items-center rounded-2xl bg-primary py-4"
        onPress={() => router.push("/profile/create")}
      >
        <Text className="text-base font-semibold text-primary-foreground">Update Profile</Text>
      </Pressable>

      {userDetails?.role !== "volunteer" && (
        <Pressable
          className="mt-3 items-center rounded-2xl bg-blue-50 py-4"
          onPress={() => router.push("/profile/volunteer-apply")}
        >
          <Text className="text-base font-semibold text-blue-700">Apply as Volunteer</Text>
        </Pressable>
      )}

      <Pressable
        className="mt-3 items-center rounded-2xl border border-red-300 bg-red-50 py-4"
        onPress={async () => {
          await logout();
          router.replace("/auth/login");
        }}
      >
        <Text className="text-base font-semibold text-red-700">Logout</Text>
      </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}