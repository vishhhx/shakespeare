import { Pressable, StyleSheet, Switch, View } from "react-native";
import { space, touchTarget, useTheme } from "../../theme";
import { AppText } from "./AppText";

type SwitchRowProps = {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export function SwitchRow({ title, description, value, onValueChange }: SwitchRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={title}
      accessibilityHint={description}
      onPress={() => onValueChange(!value)}
      style={styles.row}
    >
      <View style={styles.text}>
        <AppText variant="bodyStrong">{title}</AppText>
        {description ? (
          <AppText variant="label" tone="muted">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.borderStrong, true: colors.inverse }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.borderStrong}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: touchTarget },
  text: { flex: 1, gap: space.xxs },
});
