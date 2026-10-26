import { StyleSheet, View } from "react-native";
import { MapPin, MapPinOff, RefreshCw } from "lucide-react-native";

import { radius, space, useTheme } from "../../theme";
import { AppText, Button } from "../ui";
import type { CurrentLocation } from "../../hooks/useCurrentLocation";

const ageLabel = (fixedAt: number | null) => {
  if (!fixedAt) return "";
  const seconds = Math.max(0, Math.round((Date.now() - fixedAt) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

/** Location readiness for sending an SOS, with the one action that fixes each problem. */
export function LocationStatusCard({ location }: { location: CurrentLocation }) {
  const { colors } = useTheme();
  const { status, coords, accuracy, fixedAt, canAskAgain } = location;

  const content = {
    locating: { Icon: MapPin, title: "Finding your location…", body: "This usually takes a few seconds.", tone: colors.textMuted },
    ready: {
      Icon: MapPin,
      title: "Location ready",
      body: `Accurate to about ${Math.max(5, Math.round(accuracy ?? 0))} m · updated ${ageLabel(fixedAt)}`,
      tone: colors.success,
    },
    denied: {
      Icon: MapPinOff,
      title: "Location is off for SafeSphere",
      body: "Responders need your location to find you. You can still call 112.",
      tone: colors.dangerText,
    },
    unavailable: {
      Icon: MapPinOff,
      title: "Can't get a location fix",
      body: "Turn on location services or move near a window, then try again.",
      tone: colors.dangerText,
    },
  }[status];

  return (
    <View
      style={[styles.card, { borderColor: status === "ready" ? colors.border : colors.borderStrong, backgroundColor: colors.surface }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <content.Icon size={20} color={content.tone} aria-hidden />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{content.title}</AppText>
          <AppText variant="caption" tone="muted">{content.body}</AppText>
          {status === "ready" && coords && (
            <AppText variant="caption" tone="subtle">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</AppText>
          )}
        </View>
      </View>
      {status === "denied" && (
        <Button
          label={canAskAgain ? "Allow location" : "Open settings"}
          variant="secondary"
          onPress={() => (canAskAgain ? void location.refresh() : location.openSettings())}
        />
      )}
      {status === "unavailable" && <Button label="Try again" icon={RefreshCw} variant="secondary" onPress={() => void location.refresh()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  flex: { flex: 1, gap: 2 },
});
