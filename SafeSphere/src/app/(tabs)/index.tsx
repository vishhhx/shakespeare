import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { useContext } from "react";
import { AuthContext } from "../../context/authContext";

export default function HomeTab() {
  const { userDetails } = useContext(AuthContext);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View className="flex-1 px-6 pt-16 pb-10">
        <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">SafeSphere</Text>
        <Text className="mt-3 text-3xl font-black text-foreground">Welcome</Text>
        <Text className="mt-2 text-sm leading-6 text-muted-foreground">
          {userDetails?.name
            ? `Hi ${userDetails.name}, stay ready and stay safe.`
            : "Your safety dashboard is ready."}
        </Text>

        <View className="mt-8 rounded-3xl border border-border bg-card p-5">
          <Text className="text-lg font-bold text-foreground">Quick Actions</Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            Open emergency tools or check your full profile details.
          </Text>

          <Pressable
            className="mt-5 items-center rounded-2xl bg-primary px-4 py-4"
            onPress={() => router.push("/(tabs)/emergency")}
          >
            <Text className="text-base font-semibold text-primary-foreground">Open Emergency Screen</Text>
          </Pressable>

          <Pressable
            className="mt-3 items-center rounded-2xl border border-border bg-background px-4 py-4"
            onPress={() => router.push("/(tabs)/profile")}
          >
            <Text className="text-base font-semibold text-foreground">View Profile</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}