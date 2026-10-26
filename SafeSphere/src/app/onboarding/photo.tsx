import { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ArrowRight, Camera, ImageIcon, UserRound } from "lucide-react-native";
import { AuthContext } from "../../context/authContext";
import { useOnboardingDraft } from "../../context/onboardingDraft";
import { getS3ReadUrl } from "../../lib/api";
import { StepScreen } from "../../components/onboarding/StepScreen";
import { usePhotoUpload } from "../../components/onboarding/usePhotoUpload";
import { AppText, Banner, Button } from "../../components/ui";
import { radius, space, useTheme } from "../../theme";

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

export default function ProfilePhotoStep() {
  const { colors } = useTheme();
  const { userDetails } = useContext(AuthContext);
  const { draft, update, previews, setPreview } = useOnboardingDraft();
  const { status, error, upload, retry } = usePhotoUpload("profile");
  const [permissionError, setPermissionError] = useState("");
  const [remotePreview, setRemotePreview] = useState<string>();

  // After a restart the local file is gone; show the uploaded copy instead.
  useEffect(() => {
    if (previews.profile || !draft.profilePhotoKey) return;
    getS3ReadUrl(draft.profilePhotoKey)
      .then((data: any) => setRemotePreview(data?.url))
      .catch(() => {});
  }, [draft.profilePhotoKey, previews.profile]);

  const preview = previews.profile ?? remotePreview;
  const uploading = status === "uploading";

  const handleResult = async (result: ImagePicker.ImagePickerResult) => {
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.uri || !userDetails?.userId) return;
    setPreview("profile", asset.uri);
    update({ profilePhotoKey: "", profilePhotoSkipped: false });
    const key = await upload(asset.uri, `avatar/${userDetails.userId}/${Date.now()}.jpg`);
    if (key) update({ profilePhotoKey: key });
  };

  const pick = async (source: "camera" | "library") => {
    setPermissionError("");
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPermissionError(
        source === "camera"
          ? "Camera access is off. Allow it in Settings, or choose a photo from your library."
          : "Photo library access is off. Allow it in Settings, or take a new photo.",
      );
      return;
    }
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ ...PICKER_OPTIONS, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    await handleResult(result);
  };

  const skip = () => {
    update({ profilePhotoKey: "", profilePhotoSkipped: true });
    setPreview("profile", undefined);
    router.push("/onboarding/face");
  };

  const hasPhoto = Boolean(draft.profilePhotoKey);

  return (
    <StepScreen
      step="photo"
      title="Add a profile photo"
      subtitle="Shown to responders and your contacts during an SOS so they can recognise you. This is separate from the face photo in the next step."
      backDisabled={uploading}
      footer={
        <>
          <Button
            label="Continue"
            icon={ArrowRight}
            iconPosition="right"
            disabled={!hasPhoto || uploading}
            onPress={() => router.push("/onboarding/face")}
          />
          <Button label="Skip for now" variant="ghost" disabled={uploading} onPress={skip} />
        </>
      }
    >
      <View style={styles.center}>
        <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          {preview ? (
            <Image source={{ uri: preview }} style={styles.avatarImage} contentFit="cover" accessibilityLabel="Your profile photo" transition={180} />
          ) : (
            <UserRound size={56} color={colors.textSubtle} strokeWidth={1.5} aria-hidden />
          )}
          {uploading ? (
            <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
              <ActivityIndicator color="#FFFFFF" accessibilityLabel="Uploading photo" />
            </View>
          ) : null}
        </View>
        <AppText variant="label" tone={status === "done" || (hasPhoto && status === "idle") ? "success" : "muted"} align="center">
          {uploading ? "Uploading…" : hasPhoto ? "Photo saved" : "No photo yet"}
        </AppText>
      </View>

      <View style={styles.actions}>
        <Button label={hasPhoto ? "Retake photo" : "Take a photo"} variant="secondary" icon={Camera} disabled={uploading} onPress={() => pick("camera")} />
        <Button label="Choose from library" variant="secondary" icon={ImageIcon} disabled={uploading} onPress={() => pick("library")} />
      </View>

      {status === "error" ? (
        <Banner
          title="Upload failed"
          message={error}
          actionLabel="Try again"
          onAction={async () => {
            const key = await retry();
            if (key) update({ profilePhotoKey: key });
          }}
        />
      ) : null}
      {permissionError ? (
        <Banner tone="info" message={permissionError} actionLabel="Open Settings" onAction={() => Linking.openSettings()} />
      ) : null}
    </StepScreen>
  );
}

const AVATAR = 144;

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.md },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: "100%", height: "100%" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  actions: { gap: space.sm },
});
