/**
 * SafeSphere design tokens.
 *
 * White canvas, near-black type, SafeSphere orange as an accent only.
 * Every text/background pair below meets WCAG AA (4.5:1) for body text:
 * orange is never used for small text — `accentText` is the darkened variant for that.
 */

export type ColorScheme = "light" | "dark";

const light = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F5F5F4",
  surfacePressed: "#EDEDEC",
  border: "#E5E5E5",
  /** Outlines of interactive controls: ≥3:1 against the background (WCAG 1.4.11). */
  borderStrong: "#8A8A8A",

  text: "#0A0A0A",
  textMuted: "#525252",
  textSubtle: "#737373",
  textOnInverse: "#FFFFFF",

  inverse: "#0A0A0A",
  inversePressed: "#262626",

  accent: "#FF7A1A",
  accentText: "#C2410C",
  accentSoft: "#FFF4EB",

  danger: "#DC2626",
  dangerText: "#B91C1C",
  dangerSoft: "#FEF2F2",

  success: "#15803D",
  successSoft: "#F0FDF4",

  info: "#1D4ED8",
  infoSoft: "#EFF6FF",

  scrim: "rgba(10,10,10,0.55)",
};

const dark: typeof light = {
  background: "#0A0A0A",
  surface: "#141414",
  surfaceMuted: "#1C1C1C",
  surfacePressed: "#262626",
  border: "#2A2A2A",
  borderStrong: "#6E6E6E",

  text: "#FAFAFA",
  textMuted: "#A3A3A3",
  textSubtle: "#8A8A8A",
  textOnInverse: "#0A0A0A",

  inverse: "#FAFAFA",
  inversePressed: "#E5E5E5",

  accent: "#FF8A33",
  accentText: "#FFA463",
  accentSoft: "#2A1607",

  danger: "#F87171",
  dangerText: "#FCA5A5",
  dangerSoft: "#2A0F0F",

  success: "#4ADE80",
  successSoft: "#0D2016",

  info: "#93C5FD",
  infoSoft: "#0E1A2E",

  scrim: "rgba(0,0,0,0.7)",
};

export const palettes = { light, dark };
export type Palette = typeof light;

/** 4-pt spacing grid. */
export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  gutter: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Inter, embedded at build time by the expo-font config plugin (see app.json). */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.6 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, letterSpacing: -0.4 },
  headline: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.8 },
} as const;

export type TypeVariant = keyof typeof type;

export const motion = {
  press: 120,
  fast: 180,
  base: 240,
  pressScale: 0.97,
} as const;

/** Minimum interactive size (iOS 44pt / Android 48dp — we use the larger). */
export const touchTarget = 48;

export const shadow = {
  shadowColor: "#000000",
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
