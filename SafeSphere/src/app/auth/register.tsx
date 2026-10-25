import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { normalizeIndianPhoneNumber } from "../../lib/phone";

export default function RegisterScreen() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const registerUser = async () => {
    const normalized = normalizeIndianPhoneNumber(phoneNumber);

    if (!normalized) {
      setError("Enter a valid 10-digit mobile number");
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
      const status = err?.response?.status;
      const message = err?.response?.data?.error;

      if (
        status === 400 &&
        typeof message === "string" &&
        message.includes("already exists")
      ) {
        setError("An account already exists. Please sign in instead.");
      } else {
        setError(message || "Unable to register. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

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
        {/* Brand                                                         */}
        {/* ------------------------------------------------------------ */}

        <View className="flex-row items-center">
          <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
          </View>

          <Text className="ml-2.5 text-[20px] font-extrabold tracking-tight text-foreground">
            Safe
            <Text className="text-primary">Sphere</Text>
          </Text>
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Header                                                        */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-20">
          <Text className="text-[30px] font-extrabold leading-9 tracking-tight text-foreground">
            Create your account
          </Text>

          <Text className="mt-3 max-w-[330px] text-[15px] leading-6 text-muted-foreground">
            Enter your mobile number to get started. We’ll send you a secure
            one-time verification code.
          </Text>
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Form                                                          */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-11">
          <Text className="mb-2.5 text-[13px] font-semibold text-foreground">
            Mobile number
          </Text>

          <View
            className={`flex-row items-center overflow-hidden rounded-xl border bg-white ${
              focused
                ? "border-primary"
                : error
                  ? "border-destructive"
                  : "border-border"
            }`}
          >
            {/* Country code */}

            <View className="h-[54px] items-center justify-center border-r border-border px-4">
              <Text className="text-[15px] font-semibold text-foreground">
                +91
              </Text>
            </View>

            {/* Phone number */}

            <TextInput
              value={phoneNumber}
              onChangeText={(value) => {
                setPhoneNumber(value);

                if (error) {
                  setError("");
                }
              }}
              keyboardType="phone-pad"
              placeholder="10-digit mobile number"
              placeholderTextColor="#94A3B8"
              className="h-[54px] flex-1 px-4 text-[16px] font-medium text-foreground"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={10}
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="done"
              onSubmitEditing={registerUser}
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

          {/* Helper */}

          {!error && (
            <View className="mt-3 flex-row items-center">
              <Ionicons
                name="information-circle-outline"
                size={15}
                color="#94A3B8"
              />

              <Text className="ml-1.5 text-[12px] text-muted-foreground">
                Your number will be used to verify your account.
              </Text>
            </View>
          )}
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Primary action                                                */}
        {/* ------------------------------------------------------------ */}

        <Pressable
          onPress={registerUser}
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
                Create account
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
        {/* Login                                                         */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-9 flex-row items-center">
          <View className="h-px flex-1 bg-border" />

          <Text className="mx-4 text-[12px] font-medium text-muted-foreground">
            Already have an account?
          </Text>

          <View className="h-px flex-1 bg-border" />
        </View>

        <Pressable
          onPress={() => router.replace("/auth/login")}
          className="mt-5 h-[52px] items-center justify-center rounded-xl border border-border bg-white"
        >
          <Text className="text-[14px] font-semibold text-foreground">
            Sign in instead
          </Text>
        </Pressable>

        {/* ------------------------------------------------------------ */}
        {/* Security footer                                              */}
        {/* ------------------------------------------------------------ */}

        <View className="mt-auto flex-row items-center justify-center pt-16">
          <Ionicons name="shield-checkmark-outline" size={14} color="#94A3B8" />

          <Text className="ml-1.5 text-[11px] text-muted-foreground">
            Your information is protected with secure encryption
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
