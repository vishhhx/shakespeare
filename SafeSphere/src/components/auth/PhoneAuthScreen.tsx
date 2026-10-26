import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ArrowRight, ChevronLeft } from "lucide-react-native";
import { api, getApiErrorMessage } from "../../lib/api";
import { normalizeIndianPhoneNumber } from "../../lib/phone";
import { radius, space, touchTarget, useTheme } from "../../theme";
import { AppText, Banner, Button, FadeInView, IconButton, Screen, TextField } from "../ui";
import { BrandMark } from "./BrandMark";

type Mode = "login" | "register";

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  login: {
    title: "Welcome back",
    subtitle: "Enter your mobile number and we'll text you a 6-digit code to sign in.",
    cta: "Send code",
  },
  register: {
    title: "Create your account",
    subtitle: "Your mobile number is how responders and your contacts reach you. We'll text you a code to confirm it.",
    cta: "Create account",
  },
};

type Problem = { message: string; switchTo?: Mode };

export function PhoneAuthScreen({ initialMode }: { initialMode: Mode }) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phone, setPhone] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);

  const copy = COPY[mode];

  const switchMode = (next: Mode) => {
    setMode(next);
    setProblem(null);
    setFieldError("");
  };

  const submit = async () => {
    const normalized = normalizeIndianPhoneNumber(phone);
    if (!normalized) {
      setFieldError("Enter a valid 10-digit Indian mobile number.");
      return;
    }

    setFieldError("");
    setProblem(null);
    setLoading(true);

    try {
      if (mode === "register") {
        await api.post("/public-user/register", { phoneNumber: normalized, role: "public" });
      }
      await api.post("/public-user/send-otp", { phoneNumber: normalized });
      router.push({ pathname: "/auth/verify-otp", params: { phoneNumber: normalized, mode } });
    } catch (error: any) {
      const status = error?.response?.status;
      const serverMessage = String(error?.response?.data?.error ?? "");
      if (mode === "register" && status === 400 && /already exists/i.test(serverMessage)) {
        setProblem({ message: "This number already has an account.", switchTo: "login" });
      } else if (mode === "login" && status === 404) {
        setProblem({ message: "No account uses this number yet.", switchTo: "register" });
      } else {
        setProblem({ message: getApiErrorMessage(error, "We couldn't send the code. Please try again.") });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      header={
        <IconButton
          icon={ChevronLeft}
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      }
      footer={
        <Button label={copy.cta} icon={ArrowRight} iconPosition="right" loading={loading} onPress={submit} />
      }
    >
      <BrandMark />

      <View style={[styles.segment, { backgroundColor: colors.surfaceMuted }]} accessibilityRole="tablist">
        {(["login", "register"] as const).map((option) => {
          const selected = option === mode;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => switchMode(option)}
              style={[styles.segmentItem, selected && [styles.segmentSelected, { backgroundColor: colors.surface }]]}
            >
              <AppText variant="label" tone={selected ? "default" : "muted"}>
                {option === "login" ? "Sign in" : "Create account"}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <FadeInView key={mode} style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          {copy.title}
        </AppText>
        <AppText tone="muted">{copy.subtitle}</AppText>
      </FadeInView>

      <View style={styles.form}>
        <TextField
          label="Mobile number"
          value={phone}
          onChangeText={(text) => {
            setPhone(text.replace(/[^\d\s]/g, ""));
            if (fieldError) setFieldError("");
          }}
          placeholder="98765 43210"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={12}
          returnKeyType="send"
          onSubmitEditing={submit}
          error={fieldError}
          helper="Standard SMS rates may apply."
          leading={
            <View style={[styles.prefix, { borderRightColor: colors.border }]}>
              <AppText variant="bodyStrong">+91</AppText>
            </View>
          }
        />

        {problem ? (
          <Banner
            message={problem.message}
            actionLabel={problem.switchTo === "login" ? "Sign in instead" : problem.switchTo === "register" ? "Create an account" : undefined}
            onAction={problem.switchTo ? () => switchMode(problem.switchTo!) : undefined}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", marginTop: space.xl, padding: space.xxs, borderRadius: radius.md },
  segmentItem: {
    flex: 1,
    minHeight: touchTarget - 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  segmentSelected: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  heading: { marginTop: space.xl, gap: space.xs },
  form: { marginTop: space.lg, gap: space.md },
  prefix: { paddingRight: space.sm, borderRightWidth: 1, alignSelf: "stretch", justifyContent: "center" },
});
