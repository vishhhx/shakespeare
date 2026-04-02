/** @type {import('tailwindcss').Config} */
const theme = require('./theme-tokens');

module.exports = {
  content: [
    './src/app/**/*.{js,jsx,ts,tsx}',
    './src/components/**/*.{js,jsx,ts,tsx}',
    './App.tsx',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: theme.background,
        foreground: theme.foreground,
        card: theme.card,
        'card-foreground': theme.cardForeground,
        popover: theme.popover,
        'popover-foreground': theme.popoverForeground,
        primary: {
          DEFAULT: theme.primary,
          foreground: theme.primaryForeground,
          pale: theme.primaryPale,
          light: theme.primaryLight,
          dark: theme.primaryDark,
        },
        secondary: {
          DEFAULT: theme.secondary,
          foreground: theme.secondaryForeground,
        },
        muted: {
          DEFAULT: theme.muted,
          foreground: theme.mutedForeground,
        },
        accent: {
          DEFAULT: theme.accent,
          foreground: theme.accentForeground,
        },
        destructive: theme.destructive,
        border: theme.border,
        input: theme.input,
        ring: theme.ring,
        success: {
          light: theme.successLight,
          main: theme.successMain,
          dark: theme.successDark,
        },
        emergency: {
          light: theme.emergencyLight,
          main: theme.emergencyMain,
          dark: theme.emergencyDark,
        },
      },
    },
  },
  plugins: [],
};
