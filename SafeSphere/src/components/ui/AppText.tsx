import { Text, type TextProps } from "react-native";
import { type, useTheme, type Palette, type TypeVariant } from "../../theme";

type Tone = "default" | "muted" | "subtle" | "accent" | "danger" | "success" | "inverse";

const toneColor = (colors: Palette, tone: Tone) => {
  switch (tone) {
    case "muted":
      return colors.textMuted;
    case "subtle":
      return colors.textSubtle;
    case "accent":
      return colors.accentText;
    case "danger":
      return colors.dangerText;
    case "success":
      return colors.success;
    case "inverse":
      return colors.textOnInverse;
    default:
      return colors.text;
  }
};

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  tone?: Tone;
  align?: "left" | "center" | "right";
};

export function AppText({ variant = "body", tone = "default", align, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[type[variant], { color: toneColor(colors, tone), textAlign: align }, style]}
    />
  );
}
