/**
 * SafeSphere Color Palette
 * 🔵 Blue → Primary actions (buttons, navigation)
 * ⚪ White → Background (light mode)
 * ⚫ Black → Dark mode + text
 * 🟢 Green → Success / safety
 * 🔴 Red → Emergency
 */

export const SafeSphereColors = {
  // Primary - Blue
  primary: {
    light: '#3B82F6', // Bright blue
    main: '#2563EB', // Standard blue
    dark: '#1D4ED8', // Dark blue
    pale: '#DBEAFE', // Pale blue background
  },

  // Background - White
  background: {
    light: '#FFFFFF', // Pure white
    lightGray: '#F9FAFB', // Off-white
    mediumGray: '#F3F4F6', // Light gray
  },

  // Text - Black
  text: {
    dark: '#000000', // Pure black
    main: '#111827', // Dark gray-black
    secondary: '#6B7280', // Medium gray
    tertiary: '#9CA3AF', // Light gray
    disabled: '#D1D5DB', // Disabled gray
  },

  // Success - Green
  success: {
    light: '#D1FAE5', // Pale green
    main: '#10B981', // Standard green
    dark: '#059669', // Dark green
  },

  // Emergency - Red
  emergency: {
    light: '#FEE2E2', // Pale red
    main: '#EF4444', // Standard red
    dark: '#DC2626', // Dark red
  },

  // Status colors
  warning: '#F59E0B', // Amber
  info: '#0EA5E9', // Cyan
  disabled: '#E5E7EB', // Gray

  // Utility
  shadow: 'rgba(0, 0, 0, 0.1)',
  shadowDark: 'rgba(0, 0, 0, 0.25)',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const themeColors = SafeSphereColors;
