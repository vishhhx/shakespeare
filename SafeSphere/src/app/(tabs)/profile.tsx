import { View, Text, Image, Pressable } from "react-native";
import { router } from "expo-router";
import { useContext } from "react";
import { AuthContext } from "../../context/authContext";

export default function ProfileTab() {
  const { userDetails } = useContext(AuthContext);

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

      <Pressable
        className="mt-8 items-center rounded-2xl bg-primary py-4"
        onPress={() => router.push("/profile/create")}
      >
        <Text className="text-base font-semibold text-primary-foreground">Update Profile</Text>
      </Pressable>
    </View>
  );
}