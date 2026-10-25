import { useMemo, useState, useContext } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { AuthContext } from "../../context/authContext";
import { normalizeIndianPhoneNumber } from "../../lib/phone";

type VerifyMode = "login" | "register";

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{
    phoneNumber?: string;
    mode?: VerifyMode;
  }>();

  const { saveAuth } = useContext(AuthContext);

  const phoneNumber = useMemo(
    () => String(params.phoneNumber || "").trim(),
    [params.phoneNumber],
  );

  const mode = useMemo(
    () => (params.mode === "register" ? "register" : "login"),
    [params.mode],
  );

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [focused, setFocused] = useState(false);

  const verifyOtp = async () => {
    if (!phoneNumber) {
      setError("Phone number missing. Please restart.");
      return;
    }

    if (otp.trim().length < 4) {
      setError("Please enter a valid OTP");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await api.post("/public-user/verify", {
        phoneNumber: normalizeIndianPhoneNumber(phoneNumber),
        otp: otp.trim(),
      });

      const user = response?.data?.user;
      const token = response?.data?.token;
      const userId = user?._id ?? user?.userId;

      if (!userId) {
        throw new Error("User data missing after verification");
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

      router.replace(
        Boolean(user?.isprofileComplete) ? "/(tabs)" : "/profile/create",
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          "Invalid OTP. Please check the code and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!phoneNumber) return;

    setResending(true);
    setError("");
    setResendSuccess(false);

    try {
      await api.post("/public-user/send-otp", {
        phoneNumber: normalizeIndianPhoneNumber(phoneNumber),
      });

      setResendSuccess(true);

      setTimeout(() => {
        setResendSuccess(false);
      }, 4000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Unable to resend OTP");
    } finally {
      setResending(false);
    }
  };

  // Mask phone number:
  // +91XXXXXXXXXX -> +91 ••••• X1234
  const displayPhone = phoneNumber
    ? phoneNumber.replace(/(\d{5})(\d{5})/, "••••• $2")
    : "your number";

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{
        flexGrow: 1,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-1 px-6 pb-8 pt-14">
        {/* ------------------------------------------------------------ */}
        {/* Header navigation                                             */}
        {/* ------------------------------------------------------------ */}

        <View className="flex-row items-center">
          <Pressable
            onPress={() =>
              router.replace(
                mode === "register" ? "/auth/register" : "/auth/login",
              )
            }
            hitSlop={10}
            className="flex-row items-center"
          >
            <Ionicons name="chevron-back" size={18} color="#2563EB" />

            <Text className="ml-1 text-[14px] font-semibold text-primary">
              Back
            </Text>
          </Pressable>
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Header                                                        */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-16">
          <View className="mb-5 h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Ionicons
              name="shield-checkmark-outline"
              size={21}
              color="#2563EB"
            />
          </View>

          <Text className="text-[30px] font-extrabold leading-9 tracking-tight text-foreground">
            Verify your number
          </Text>

          <Text className="mt-3 max-w-[340px] text-[15px] leading-6 text-muted-foreground">
            Enter the verification code we sent to{" "}
            <Text className="font-semibold text-foreground">
              +91 {displayPhone}
            </Text>
            .
          </Text>
        </View>

        {/* ------------------------------------------------------------ */}
        {/* OTP form                                                      */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-11">
          <Text className="mb-2.5 text-[13px] font-semibold text-foreground">
            Verification code
          </Text>

          <View
            className={`overflow-hidden rounded-xl border bg-white ${
              focused
                ? "border-primary"
                : error
                  ? "border-destructive"
                  : "border-border"
            }`}
          >
            <TextInput
              value={otp}
              onChangeText={(value) => {
                // Only allow numbers
                const numericValue = value.replace(/[^0-9]/g, "");

                setOtp(numericValue);

                if (error) {
                  setError("");
                }

                if (resendSuccess) {
                  setResendSuccess(false);
                }
              }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="Enter 6-digit code"
              placeholderTextColor="#94A3B8"
              className="h-[58px] px-4 text-center text-[20px] font-bold tracking-[6px] text-foreground"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="done"
              onSubmitEditing={verifyOtp}
            />
          </View>

          {/* Error */}

          {!!error && (
            <View className="mt-3 flex-row items-start">
              <Ionicons
                name="alert-circle-outline"
                size={16}
                color="#DC2626"
                style={{ marginTop: 1 }}
              />

              <Text className="ml-2 flex-1 text-[13px] leading-5 text-destructive">
                {error}
              </Text>
            </View>
          )}

          {/* Success */}

          {resendSuccess && !error && (
            <View className="mt-3 flex-row items-center">
              <Ionicons
                name="checkmark-circle-outline"
                size={16}
                color="#16A34A"
              />

              <Text className="ml-2 text-[13px] text-green-600">
                A new verification code has been sent.
              </Text>
            </View>
          )}
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Primary action                                                */}
        {/* ------------------------------------------------------------ */}

        <Pressable
          onPress={verifyOtp}
          disabled={loading}
          className={`mt-8 h-[54px] flex-row items-center justify-center rounded-xl bg-primary ${
            loading ? "opacity-60" : ""
          }`}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Text className="text-[15px] font-bold text-primary-foreground">
                {mode === "register"
                  ? "Verify and create account"
                  : "Verify and sign in"}
              </Text>

              <Ionicons
                name="arrow-forward"
                size={17}
                color="#FFFFFF"
                style={{ marginLeft: 8 }}
              />
            </>
          )}
        </Pressable>

        {/* ------------------------------------------------------------ */}
        {/* Resend                                                        */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-7 items-center">
          <Text className="text-[13px] text-muted-foreground">
            Didn't receive the code?
          </Text>

          <Pressable
            onPress={resendOtp}
            disabled={resending}
            hitSlop={8}
            className="mt-2 min-h-[36px] items-center justify-center"
          >
            {resending ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Text className="text-[14px] font-semibold text-primary">
                Resend code
              </Text>
            )}
          </Pressable>
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Security information                                         */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-auto pt-16">
          <View className="flex-row items-start justify-center">
            <Ionicons
              name="shield-checkmark-outline"
              size={14}
              color="#94A3B8"
              style={{ marginTop: 1 }}
            />

            <Text className="ml-1.5 max-w-[290px] text-center text-[11px] leading-4 text-muted-foreground">
              Your verification code expires in 10 minutes. Never share it with
              anyone.
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
