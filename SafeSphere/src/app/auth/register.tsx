import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { router } from "expo-router";
import { api } from "../../lib/api";
import AnimatedBackground from "../../components/animated-background";

export default function RegisterScreen() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const registerUser = async () => {
    const normalized = phoneNumber.trim();

    if (normalized.length < 10) {
      setError("Enter a valid mobile number");
      return;
    }

    setError("");
    setLoading(true);

    try {
      await api.post("/public-user/register", {
        phoneNumber: normalized,
        role: "public",
      });

      await api.post("/public-user/send-otp", {
        phoneNumber: normalized,
      });

      router.push({
        pathname: "/auth/verify-otp",
        params: {
          phoneNumber: normalized,
          mode: "register",
        },
      });
    } catch (err: any) {
        console.error("Registration error:", err);
      const status = err?.response?.status;
      const message = err?.response?.data?.error;

      if (status === 400 && typeof message === "string" && message.includes("already exists")) {
        setError("User already exists. Please login instead.");
      } else {
        setError(message || "Unable to register user. Please try again.");
      }
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
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">SafeSphere</Text>
        </View>

        <Text className="z-10 mt-6 text-4xl font-black text-foreground">Register</Text>
        <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
          Create your public account with mobile OTP verification.
        </Text>

        <View className="z-10 mt-8 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
          <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Mobile Number
          </Text>
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
            placeholder="Enter phone number"
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
          onPress={registerUser}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-primary-foreground">Register and Send OTP</Text>
          )}
        </Pressable>

        <View className="z-10 mt-6 flex-row items-center justify-center gap-2">
          <Text className="text-sm text-muted-foreground">Already registered?</Text>
          <Pressable onPress={() => router.push("/auth/login")}>
            <Text className="text-sm font-semibold text-primary">Login</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
