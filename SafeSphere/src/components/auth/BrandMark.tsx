import { StyleSheet, View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { radius, space, useTheme } from "../../theme";
import { AppText } from "../ui";

export function BrandMark() {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="SafeSphere">
      <View style={[styles.mark, { backgroundColor: colors.inverse }]}>
        <ShieldCheck size={18} color={colors.accent} strokeWidth={2.25} aria-hidden />
      </View>
      <AppText variant="headline" importantForAccessibility="no">
        SafeSphere
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  mark: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
