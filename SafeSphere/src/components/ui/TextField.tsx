import { forwardRef, useState, type ReactNode } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { radius, space, type, useTheme } from "../../theme";
import { AppText } from "./AppText";

export type TextFieldProps = TextInputProps & {
  label: string;
  helper?: string;
  error?: string;
  optional?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helper, error, optional, leading, trailing, multiline, onFocus, onBlur, style, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.text : colors.borderStrong;

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <AppText variant="label">{label}</AppText>
        {optional ? (
          <AppText variant="caption" tone="subtle">
            Optional
          </AppText>
        ) : null}
      </View>

      <View
        style={[
          styles.field,
          multiline && styles.multilineField,
          { borderColor, backgroundColor: colors.surface },
        ]}
      >
        {leading}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error || helper}
          placeholderTextColor={colors.textSubtle}
          selectionColor={colors.accent}
          multiline={multiline}
          maxFontSizeMultiplier={1.6}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            type.body,
            styles.input,
            multiline && styles.multilineInput,
            { color: colors.text },
            style,
          ]}
          {...rest}
        />
        {trailing}
      </View>

      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="caption" tone="muted">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { gap: space.xs },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  field: {
    minHeight: 52,
    borderWidth: 1.5,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  multilineField: { alignItems: "flex-start", paddingVertical: space.sm },
  input: { flex: 1, paddingVertical: space.sm, includeFontPadding: false },
  multilineInput: { minHeight: 88, textAlignVertical: "top", paddingVertical: 0 },
});
