import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { useContext } from "react";
import { AuthContext } from "../../context/authContext";

export default function HomeTab() {
  const { userDetails } = useContext(AuthContext);

  return (
    <View className="flex-1 bg-background px-6 pt-16">
      <Text className="text-3xl font-black text-foreground">Welcome</Text>
      <Text className="mt-2 text-sm text-muted-foreground">
        {userDetails?.name ? `Hi, ${userDetails.name}` : "Your SafeSphere dashboard is ready."}
      </Text>

      <Pressable
        className="mt-8 items-center rounded-2xl bg-primary py-4"
        onPress={() => router.push("/profile/create")}
      >
        <Text className="text-base font-semibold text-primary-foreground">Edit Profile</Text>
      </Pressable>
    </View>
  );
}