import { useContext, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { api, getApiErrorMessage } from "../../lib/api";
import { AuthContext } from "../../context/authContext";
import { normalizeIndianPhoneNumber } from "../../lib/phone";
import { space } from "../../theme";
import { AppText, Banner, Button, FadeInView, IconButton, OtpInput, Screen } from "../../components/ui";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

const maskPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `+91 ${digits.slice(0, 2)}••• ••${digits.slice(7)}` : "your number";
};

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ phoneNumber?: string; mode?: string }>();
  const { saveAuth } = useContext(AuthContext);

  const phoneNumber = normalizeIndianPhoneNumber(String(params.phoneNumber ?? ""));
  const mode = params.mode === "register" ? "register" : "login";

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const goBack = () => router.replace(mode === "register" ? "/auth/register" : "/auth/login");

  const verify = async (value = code) => {
    if (verifying) return;
    if (!phoneNumber) {
      setError("We lost your phone number. Go back and enter it again.");
      return;
    }
    if (value.length !== CODE_LENGTH) {
      setError(`Enter all ${CODE_LENGTH} digits of the code.`);
      return;
    }

    setError("");
    setNotice("");
    setVerifying(true);
    try {
      const response = await api.post("/public-user/verify", { phoneNumber, otp: value });
      const user = response?.data?.user;
      const token = response?.data?.token;
      const userId = user?._id ?? user?.userId;
      if (!userId || typeof token !== "string") {
        throw new Error("Sign-in response was incomplete. Please try again.");
      }

      await saveAuth({
        user: {
          userId: String(userId),
          phoneNumber: String(user.phoneNumber || phoneNumber),
          name: String(user.name || ""),
          role: String(user.role || "public"),
          isVerified: Boolean(user.isVerified ?? true),
          avatarUrl: String(user.avatarUrl || ""),
          isprofileComplete: Boolean(user.isprofileComplete ?? false),
        },
        token,
      });

      router.replace(user?.isprofileComplete ? "/(tabs)" : "/onboarding");
    } catch (err: any) {
      setCode("");
      setError(getApiErrorMessage(err, "That code didn't work. Check it and try again."));
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (!phoneNumber || secondsLeft > 0) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      await api.post("/public-user/send-otp", { phoneNumber });
      setCode("");
      setSecondsLeft(RESEND_SECONDS);
      setNotice("A new code is on its way.");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "We couldn't resend the code. Please try again."));
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen
      header={<IconButton icon={ChevronLeft} label="Change phone number" onPress={goBack} />}
      footer={
        <>
          <Button label="Verify and continue" loading={verifying} disabled={code.length !== CODE_LENGTH} onPress={() => verify()} />
          <Button
            label={secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
            variant="ghost"
            loading={resending}
            disabled={secondsLeft > 0}
            onPress={resend}
          />
        </>
      }
    >
      <FadeInView style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Enter the code
        </AppText>
        <AppText tone="muted">
          We sent a 6-digit code to <AppText variant="bodyStrong">{maskPhone(phoneNumber)}</AppText>. It expires in 5 minutes.
        </AppText>
      </FadeInView>

      <View style={styles.form}>
        <OtpInput
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError("");
          }}
          onComplete={(value) => void verify(value)}
          error={Boolean(error)}
        />
        {error ? <Banner message={error} /> : null}
        {notice ? <Banner tone="success" message={notice} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: space.xs },
  form: { marginTop: space.xl, gap: space.md },
});
