import { View, Text, Image, Pressable } from "react-native";
import { router } from "expo-router";
import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../../context/authContext";
import { useLocationTracking } from "../../lib/useLocationTracking";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function ProfileTab() {
  const { userDetails, logout } = useContext(AuthContext);
  const [trackingEnabled, setTrackingEnabled] = useState(false);

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
    <View className="flex-1 bg-background px-6 pt-16">
      <View className="items-center">
        <Image
          source={{
            uri:
              userDetails?.avatarUrl ||
              "https://cdn-icons-png.flaticon.com/512/149/149071.png",
          }}
          className="h-28 w-28 rounded-full"
        />
        <Text className="mt-4 text-2xl font-black text-foreground">
          {userDetails?.name || "Profile"}
        </Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          {userDetails?.phoneNumber || "No phone number"}
        </Text>
      </View>

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

      <Pressable
        className="mt-3 items-center rounded-2xl bg-blue-50 py-4"
        onPress={() => router.push("/profile/volunteer-apply")}
      >
        <Text className="text-base font-semibold text-blue-700">Apply as Volunteer</Text>
      </Pressable>

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
  );
}