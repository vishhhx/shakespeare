import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { api } from "../../lib/api";
import { useContext } from "react";
import { AuthContext } from "../../context/authContext";
import AnimatedBackground from "../../components/animated-background";
import { normalizeIndianPhoneNumber } from "../../lib/phone";

type VerifyMode = "login" | "register";

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{
    phoneNumber?: string;
    mode?: VerifyMode;
  }>();

  const { saveAuth } = useContext(AuthContext);

  const phoneNumber = useMemo(() => String(params.phoneNumber || "").trim(), [params.phoneNumber]);
  const mode = useMemo<VerifyMode>(() => (params.mode === "register" ? "register" : "login"), [params.mode]);

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const verifyOtp = async () => {
    if (!phoneNumber) {
      setError("Phone number is missing. Please restart login/register.");
      return;
    }

    if (otp.trim().length < 4) {
      setError("Enter a valid OTP");
      return;
    }

    setError("");
    setLoading(true);

    console.log("[Verify OTP] Submitting request", {
      phoneNumber,
      otpLength: otp.trim().length,
      mode,
    });

    try {
      const response = await api.post("/public-user/verify", {
        phoneNumber: normalizeIndianPhoneNumber(phoneNumber),
        otp: otp.trim(),
      });

      console.log("[Verify OTP] Success response", response.data);

      const user = response?.data?.user;
      const token = response?.data?.token;
      console.log("[Verify OTP] User payload", user);

      const userId = user?._id ?? user?.userId;
      if (!userId) {
        throw new Error("Verification succeeded but user data is missing");
      }

      await saveAuth({
        user: {
          userId: String(userId),
          phoneNumber: String(user.phoneNumber || phoneNumber),
          name: String(user.name || "User"),
          role: String(user.role || "public"),
          isVerified: Boolean(user.isVerified ?? true),
          avatarUrl: String(user.avatarUrl || ""),
          isprofileComplete: Boolean(user.isprofileComplete ?? false),
        },
        token: typeof token === "string" ? token : undefined,
      });

      router.replace(Boolean(user?.isprofileComplete) ? "/(tabs)" : "/profile/create");
    } catch (err: any) {
      console.error("[Verify OTP] Failed", {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message,
      });
      const message = err?.response?.data?.error;
      setError(message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!phoneNumber) {
      return;
    }

    setResending(true);
    setError("");

    try {
      await api.post("/public-user/send-otp", { phoneNumber: normalizeIndianPhoneNumber(phoneNumber) });
    } catch (err: any) {
      const message = err?.response?.data?.error;
      setError(message || "Unable to resend OTP");
    } finally {
      setResending(false);
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

        <Text className="z-10 mt-6 text-4xl font-black text-foreground">Verify OTP</Text>
        <Text className="z-10 mt-2 text-sm leading-6 text-muted-foreground">
          Enter the OTP sent to {phoneNumber || "your number"} to {mode === "register" ? "complete registration" : "login"}.
        </Text>

        <View className="z-10 mt-8 rounded-3xl border border-border bg-card p-5" style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}>
          <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            OTP
          </Text>
          <TextInput
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            maxLength={8}
            placeholder="Enter OTP"
            placeholderTextColor="#6b7280"
            className="rounded-2xl border border-border bg-background px-4 py-4 text-base tracking-[0.2em] text-foreground"
          />
        </View>

        {!!error && (
          <Text className="z-10 mt-3 text-sm text-destructive" selectable>
            {error}
          </Text>
        )}

        <Pressable
          className="z-10 mt-8 items-center rounded-2xl bg-primary py-4"
          onPress={verifyOtp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-primary-foreground">Verify OTP</Text>
          )}
        </Pressable>

        <Pressable
          className="z-10 mt-4 items-center rounded-2xl border border-border bg-background py-3"
          onPress={resendOtp}
          disabled={resending}
        >
          {resending ? (
            <ActivityIndicator color="#2563eb" />
          ) : (
            <Text className="text-sm font-semibold text-primary">Resend OTP</Text>
          )}
        </Pressable>

        <Pressable
          className="z-10 mt-6 items-center"
          onPress={() => router.replace(mode === "register" ? "/auth/register" : "/auth/login")}
        >
          <Text className="text-sm text-muted-foreground">Change number</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
