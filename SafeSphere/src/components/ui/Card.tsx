import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { radius, space, useTheme } from "../../theme";

export function Card({ children, style, muted = false }: { children: ReactNode; style?: ViewStyle; muted?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: muted ? colors.surfaceMuted : colors.surface, borderColor: muted ? "transparent" : colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.md, gap: space.sm },
});
