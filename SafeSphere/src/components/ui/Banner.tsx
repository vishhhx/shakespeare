import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { AlertCircle, CheckCircle2, Info } from "lucide-react-native";
import { radius, space, useTheme } from "../../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

type BannerProps = {
  tone?: "danger" | "success" | "info";
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function Banner({ tone = "danger", title, message, actionLabel, onAction }: BannerProps) {
  const { colors } = useTheme();
  const config = {
    danger: { bg: colors.dangerSoft, fg: colors.dangerText, Icon: AlertCircle },
    success: { bg: colors.successSoft, fg: colors.success, Icon: CheckCircle2 },
    info: { bg: colors.infoSoft, fg: colors.info, Icon: Info },
  }[tone];
  const { Icon } = config;

  return (
    <Animated.View
      entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
      accessibilityRole={tone === "danger" ? "alert" : "summary"}
      accessibilityLiveRegion="polite"
      style={[styles.container, { backgroundColor: config.bg }]}
    >
      <Icon size={20} color={config.fg} strokeWidth={2} aria-hidden />
      <View style={styles.body}>
        {title ? (
          <AppText variant="bodyStrong" style={{ color: config.fg }}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="label" style={{ color: config.fg }}>
          {message}
        </AppText>
        {actionLabel && onAction ? (
          <View style={styles.action}>
            <Button label={actionLabel} variant="secondary" fullWidth={false} onPress={onAction} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md },
  body: { flex: 1, gap: space.xxs },
  action: { marginTop: space.xs, alignItems: "flex-start" },
});
