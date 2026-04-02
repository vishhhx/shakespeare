import { useContext, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { router } from "expo-router";
import { api } from "../../lib/api";
import AnimatedBackground from "../../components/animated-background";
import ProfileImagePicker from "../../components/profile-image-picker";
import { AuthContext } from "../../context/authContext";

export default function CreateProfileScreen() {
  const { userDetails, authToken, saveAuth, isAuthenticated } = useContext(AuthContext);
  const [name, setName] = useState(userDetails?.name || "");
  const [avatarUrl, setAvatarUrl] = useState(userDetails?.avatarUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated || !userDetails) {
      router.replace("/");
    }
  }, [isAuthenticated, userDetails]);

  const submitProfile = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    if (!avatarUrl.trim()) {
      setError("Please add a profile image");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await api.patch("/public-user/profile", {
        name: name.trim(),
        avatarUrl: avatarUrl.trim(),
      });

      const updatedUser = response?.data?.user;
      if (!updatedUser?._id && !updatedUser?.userId) {
        throw new Error("Profile update failed");
      }

      await saveAuth({
        user: {
          userId: String(updatedUser.userId ?? updatedUser._id),
          phoneNumber: String(updatedUser.phoneNumber ?? userDetails?.phoneNumber ?? ""),
          name: String(updatedUser.name ?? name.trim()),
          role: String(updatedUser.role ?? userDetails?.role ?? "public"),
          isVerified: Boolean(updatedUser.isVerified ?? userDetails?.isVerified ?? false),
          avatarUrl: String(updatedUser.avatarUrl ?? avatarUrl.trim()),
          isprofileComplete: Boolean(updatedUser.isprofileComplete ?? true),
        },
        token: authToken ?? undefined,
      });

      router.replace("/(tabs)");
    } catch (err: any) {
      const message = err?.response?.data?.error;
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
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Profile setup</Text>
        </View>

        <Text className="z-10 mt-6 text-4xl font-black text-foreground">Complete Profile</Text>
        <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
          Add your name and profile image so your account is ready for the app.
        </Text>

        <View className="z-10 mt-8 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
          <ProfileImagePicker
            initialImageUrl={avatarUrl}
            onUploadComplete={(key) => setAvatarUrl(key)}
          />

          <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Name
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            placeholderTextColor="#6b7280"
            className="rounded-2xl border border-border bg-background px-4 py-4 text-base text-foreground"
          />
        </View>

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
            <Text className="text-base font-semibold text-primary-foreground">Continue</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}