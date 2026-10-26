import { useContext, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { CameraView, useCameraPermissions } from "expo-camera";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Eye,
  Lock,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Square,
  SquareCheck,
  type LucideIcon,
} from "lucide-react-native";
import { AuthContext } from "../../context/authContext";
import { useOnboardingDraft } from "../../context/onboardingDraft";
import { StepScreen } from "../../components/onboarding/StepScreen";
import { usePhotoUpload } from "../../components/onboarding/usePhotoUpload";
import { AppText, Banner, Button, Card } from "../../components/ui";
import { motion, radius, space, touchTarget, useTheme } from "../../theme";

type Phase = "consent" | "camera" | "review";

const PRIVACY_POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ScanFace,
    title: "Why we need it",
    body: "If you're found unable to respond, a responder can photograph you and SafeSphere matches it to your profile, so your contacts and medical details reach the right people.",
  },
  {
    icon: Lock,
    title: "How it's stored",
    body: "The photo goes to private storage, never a public link. We turn it into a face template that is used only for this emergency match.",
  },
  {
    icon: Eye,
    title: "Who can see it",
    body: "It is not shown on your profile. Matching runs only when a responder submits a photo during an active emergency.",
  },
];

export default function FaceStep() {
  const { colors } = useTheme();
  const { userDetails } = useContext(AuthContext);
  const { draft, update, previews, setPreview } = useOnboardingDraft();
  const { status, error, upload, retry, reset } = usePhotoUpload("face");
  const [permission, requestPermission] = useCameraPermissions();

  const hasConsent = Boolean(draft.faceConsentAt);
  const [agreed, setAgreed] = useState(hasConsent);
  const [phase, setPhase] = useState<Phase>(hasConsent ? (draft.facePhotoKey ? "review" : "camera") : "consent");
  const [captured, setCaptured] = useState<string | undefined>(previews.face);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const uploading = status === "uploading";
  const uploaded = Boolean(draft.facePhotoKey) && status !== "uploading" && status !== "error";

  /* ---------------------------------------------------------------- */

  const giveConsent = async () => {
    update({ faceConsentAt: new Date().toISOString() });
    if (!permission?.granted) {
      await requestPermission();
    }
    setPhase(draft.facePhotoKey ? "review" : "camera");
  };

  const openCamera = async () => {
    setCameraError("");
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setCameraReady(false);
    setPhase("camera");
  };

  const capture = async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    setCapturing(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, shutterSound: false });
      if (!photo?.uri) throw new Error("No photo returned");
      setCaptured(photo.uri);
      reset();
      setPhase("review");
    } catch {
      setCameraError("We couldn't take the photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  const accept = async () => {
    if (!captured || !userDetails?.userId) return;
    update({ facePhotoKey: "" });
    const key = await upload(captured, `${userDetails.userId}.jpg`);
    if (key) {
      setPreview("face", captured);
      update({ facePhotoKey: key });
    }
  };

  const retryUpload = async () => {
    const key = await retry();
    if (key) {
      setPreview("face", captured);
      update({ facePhotoKey: key });
    }
  };

  /* ---------------------------------------------------------------- */
  /* Consent                                                           */
  /* ---------------------------------------------------------------- */

  if (phase === "consent") {
    return (
      <StepScreen
        step="face"
        title="Your face photo"
        subtitle="SafeSphere needs one clear photo of your face to finish setting up. Here's exactly how it's used."
        footer={
          <>
            <Button label="Agree and continue" icon={ArrowRight} iconPosition="right" disabled={!agreed} onPress={giveConsent} />
            <Button label="Not now" variant="ghost" onPress={() => router.back()} />
          </>
        }
      >
        <View style={styles.points}>
          {PRIVACY_POINTS.map(({ icon: Icon, title, body }) => (
            <View key={title} style={styles.point}>
              <View style={[styles.pointIcon, { backgroundColor: colors.surfaceMuted }]}>
                <Icon size={20} color={colors.text} strokeWidth={2} aria-hidden />
              </View>
              <View style={styles.pointText}>
                <AppText variant="bodyStrong">{title}</AppText>
                <AppText variant="label" tone="muted">
                  {body}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((value) => !value)}
          style={[styles.consentRow, { borderColor: agreed ? colors.text : colors.borderStrong, backgroundColor: colors.surface }]}
        >
          {agreed ? (
            <SquareCheck size={24} color={colors.text} strokeWidth={2} aria-hidden />
          ) : (
            <Square size={24} color={colors.textMuted} strokeWidth={2} aria-hidden />
          )}
          <AppText variant="label" style={styles.consentText}>
            I agree to SafeSphere storing my face photo and using it to identify me during an emergency.
          </AppText>
        </Pressable>
      </StepScreen>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Live camera                                                        */
  /* ---------------------------------------------------------------- */

  if (phase === "camera") {
    const denied = permission && !permission.granted;
    return (
      <StepScreen
        step="face"
        title="Take your face photo"
        subtitle="Face the camera in good light. Remove sunglasses, masks and hats."
        footer={
          denied ? (
            permission.canAskAgain ? (
              <Button label="Allow camera access" icon={Camera} onPress={openCamera} />
            ) : (
              <Button label="Open Settings" onPress={() => Linking.openSettings()} />
            )
          ) : (
            <View style={styles.shutterRow}>
              <ShutterButton disabled={!cameraReady || capturing || Boolean(cameraError)} onPress={capture} />
            </View>
          )
        }
      >
        {denied ? (
          <Card muted>
            <CameraOff size={28} color={colors.textMuted} strokeWidth={1.75} aria-hidden />
            <AppText variant="bodyStrong">Camera access is off</AppText>
            <AppText variant="label" tone="muted">
              {permission.canAskAgain
                ? "SafeSphere needs the camera only to take this photo. Nothing is recorded until you press the shutter."
                : "You've turned off camera access for SafeSphere. Turn it on in Settings, then come back to this screen."}
            </AppText>
          </Card>
        ) : cameraError && !cameraReady ? (
          <Card muted>
            <CameraOff size={28} color={colors.textMuted} strokeWidth={1.75} aria-hidden />
            <AppText variant="bodyStrong">Camera unavailable</AppText>
            <AppText variant="label" tone="muted">
              {cameraError}
            </AppText>
            <Button label="Try again" variant="secondary" fullWidth={false} onPress={openCamera} />
          </Card>
        ) : (
          <View style={[styles.viewfinder, { backgroundColor: colors.inverse }]}>
            {permission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="front"
                // Not mirrored: the stored photo should match how a bystander's camera sees the face.
                mirror={false}
                animateShutter
                onCameraReady={() => setCameraReady(true)}
                onMountError={(event) =>
                  setCameraError(event?.message || "Your camera couldn't be started. Close other apps using it and try again.")
                }
              />
            ) : null}
            <View pointerEvents="none" style={styles.guideWrap}>
              <View style={styles.guideOval} />
            </View>
            <View pointerEvents="none" style={styles.guideHint}>
              <AppText variant="label" style={styles.onCamera}>
                Fit your face inside the oval
              </AppText>
            </View>
          </View>
        )}
        {cameraError && cameraReady ? <Banner message={cameraError} /> : null}
      </StepScreen>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Review + upload                                                    */
  /* ---------------------------------------------------------------- */

  return (
    <StepScreen
      step="face"
      title={uploaded ? "Face photo saved" : "Check your photo"}
      subtitle={
        uploaded
          ? "Stored privately. You can retake it at any time before finishing."
          : "Make sure your whole face is visible, in focus and not covered."
      }
      backDisabled={uploading}
      footer={
        uploaded ? (
          <>
            <Button label="Continue" icon={ArrowRight} iconPosition="right" onPress={() => router.push("/onboarding/review")} />
            <Button label="Retake photo" variant="ghost" icon={RotateCcw} onPress={openCamera} />
          </>
        ) : (
          <>
            <Button label="Use this photo" loading={uploading} disabled={!captured} onPress={accept} />
            <Button label="Retake" variant="secondary" icon={RotateCcw} disabled={uploading} onPress={openCamera} />
            <Button label="Cancel" variant="ghost" disabled={uploading} onPress={() => router.back()} />
          </>
        )
      }
    >
      <View style={[styles.reviewFrame, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
        {captured ? (
          <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Your face photo" transition={180} />
        ) : (
          <View style={styles.reviewPlaceholder}>
            <ShieldCheck size={40} color={colors.success} strokeWidth={1.75} aria-hidden />
            <AppText variant="label" tone="muted" align="center">
              {"Your face photo is stored privately and isn't downloaded back to this device."}
            </AppText>
          </View>
        )}
        {uploaded ? (
          <View style={[styles.savedBadge, { backgroundColor: colors.surface }]}>
            <CheckCircle2 size={16} color={colors.success} strokeWidth={2.25} aria-hidden />
            <AppText variant="caption" tone="success">
              Uploaded
            </AppText>
          </View>
        ) : null}
      </View>

      {status === "error" ? <Banner title="Upload failed" message={error} actionLabel="Try again" onAction={retryUpload} /> : null}
    </StepScreen>
  );
}

function ShutterButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take photo"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => scale.set(withTiming(0.92, { duration: motion.press }))}
        onPressOut={() => scale.set(withTiming(1, { duration: motion.fast }))}
        style={[styles.shutterOuter, { borderColor: colors.text, opacity: disabled ? 0.4 : 1 }]}
      >
        <View style={[styles.shutterInner, { backgroundColor: colors.text }]} />
      </Pressable>
    </Animated.View>
  );
}

const SHUTTER = 72;

const styles = StyleSheet.create({
  points: { gap: space.lg },
  point: { flexDirection: "row", gap: space.md },
  pointIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  pointText: { flex: 1, gap: space.xxs },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
    minHeight: touchTarget,
  },
  consentText: { flex: 1 },
  viewfinder: { aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: "hidden" },
  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  guideOval: {
    width: "64%",
    aspectRatio: 0.78,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    borderStyle: "dashed",
  },
  guideHint: { position: "absolute", left: 0, right: 0, bottom: space.md, alignItems: "center" },
  onCamera: {
    color: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  shutterRow: { alignItems: "center" },
  shutterOuter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: SHUTTER - 14, height: SHUTTER - 14, borderRadius: (SHUTTER - 14) / 2 },
  reviewFrame: { aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: "hidden", borderWidth: 1 },
  reviewPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.lg },
  savedBadge: {
    position: "absolute",
    top: space.sm,
    right: space.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xxs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
  },
});
