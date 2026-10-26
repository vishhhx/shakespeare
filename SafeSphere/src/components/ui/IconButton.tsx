import { Pressable, StyleSheet } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { radius, touchTarget, useTheme } from "../../theme";

type IconButtonProps = {
  icon: LucideIcon;
  /** Required: icon-only controls need an accessible name. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
};

export function IconButton({ icon: Icon, label, onPress, disabled, tone = "default" }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? colors.surfacePressed : "transparent", opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Icon size={22} color={tone === "danger" ? colors.danger : colors.text} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
