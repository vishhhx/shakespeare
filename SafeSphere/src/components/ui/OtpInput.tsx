import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { radius, space, useTheme } from "../../theme";
import { AppText } from "./AppText";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: boolean;
  autoFocus?: boolean;
  onComplete?: (value: string) => void;
};

/**
 * One hidden TextInput drives the cells, so paste and SMS autofill
 * (iOS oneTimeCode / Android sms-otp) fill every cell at once.
 */
export function OtpInput({ value, onChange, length = 6, error, autoFocus = true, onComplete }: OtpInputProps) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) {
      onComplete?.(digits);
    }
  };

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessibilityRole="none"
      accessibilityLabel={`Verification code, ${value.length} of ${length} digits entered`}
    >
      <View style={styles.row} importantForAccessibility="no-hide-descendants">
        {Array.from({ length }, (_, index) => {
          const char = value[index] ?? "";
          const isActive = focused && index === Math.min(value.length, length - 1);
          const borderColor = error ? colors.danger : isActive ? colors.text : colors.borderStrong;
          return (
            <View
              key={index}
              style={[styles.cell, { borderColor, backgroundColor: char ? colors.surface : colors.surfaceMuted }]}
            >
              <AppText variant="title">{char}</AppText>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        accessibilityLabel="Verification code"
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.xs },
  cell: {
    flex: 1,
    maxWidth: 56,
    aspectRatio: 0.86,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
