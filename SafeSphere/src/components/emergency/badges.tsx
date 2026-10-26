import { StyleSheet, View } from "react-native";

import { radius, space, useTheme, type Palette } from "../../theme";
import { AppText } from "../ui";
import {
  ROLE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  type ActorRole,
  type EmergencySeverity,
  type EmergencyStatus,
} from "../../lib/emergencyTypes";

type Tone = { bg: string; fg: string };

// One colour meaning per state, shared by every emergency screen.
export const statusTone = (colors: Palette, status: EmergencyStatus): Tone =>
  ({
    reported: { bg: colors.dangerSoft, fg: colors.dangerText },
    verified: { bg: colors.infoSoft, fg: colors.info },
    in_progress: { bg: colors.accentSoft, fg: colors.accentText },
    resolved: { bg: colors.successSoft, fg: colors.success },
    closed: { bg: colors.surfaceMuted, fg: colors.textMuted },
  })[status];

export const severityTone = (colors: Palette, severity: EmergencySeverity): Tone =>
  ({
    low: { bg: colors.surfaceMuted, fg: colors.textMuted },
    medium: { bg: colors.infoSoft, fg: colors.info },
    high: { bg: colors.accentSoft, fg: colors.accentText },
    critical: { bg: colors.danger, fg: "#FFFFFF" },
  })[severity];

function Pill({ label, tone, accessibilityLabel }: { label: string; tone: Tone; accessibilityLabel?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]} accessible accessibilityLabel={accessibilityLabel ?? label}>
      <AppText variant="overline" style={{ color: tone.fg }}>
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

export function StatusPill({ status }: { status: EmergencyStatus }) {
  const { colors } = useTheme();
  return <Pill label={STATUS_LABELS[status]} tone={statusTone(colors, status)} accessibilityLabel={`Status: ${STATUS_LABELS[status]}`} />;
}

export function SeverityBadge({ severity }: { severity: EmergencySeverity }) {
  const { colors } = useTheme();
  return (
    <Pill
      label={SEVERITY_LABELS[severity]}
      tone={severityTone(colors, severity)}
      accessibilityLabel={`Severity: ${SEVERITY_LABELS[severity]}`}
    />
  );
}

export function RoleTag({ role, label }: { role: ActorRole; label?: string }) {
  const { colors } = useTheme();
  return <Pill label={label ?? ROLE_LABELS[role]} tone={{ bg: colors.surfaceMuted, fg: colors.text }} />;
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", paddingHorizontal: space.xs, paddingVertical: 3, borderRadius: radius.pill },
});
