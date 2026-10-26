import { Pressable, StyleSheet } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { radius, space, touchTarget, useTheme } from "../../theme";
import { AppText } from "./AppText";

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  accessibilityLabel?: string;
};

export function Chip({ label, selected = false, onPress, icon: Icon, accessibilityLabel }: ChipProps) {
  const { colors } = useTheme();
  const fg = selected ? colors.textOnInverse : colors.text;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: selected ? colors.inverse : pressed ? colors.surfacePressed : colors.surface,
          borderColor: selected ? colors.inverse : colors.border,
        },
      ]}
    >
      <AppText variant="label" style={{ color: fg }}>
        {label}
      </AppText>
      {Icon ? <Icon size={16} color={fg} strokeWidth={2} aria-hidden /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget - 8,
    minWidth: touchTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xxs,
  },
});
