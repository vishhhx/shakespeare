import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Plus, X } from "lucide-react-native";
import { space } from "../../theme";
import { Chip } from "./Chip";
import { IconButton } from "./IconButton";
import { TextField } from "./TextField";

type TagInputProps = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  helper?: string;
  max?: number;
};

/** Free-text list entry: type, press add/return, remove with the chip's ×. */
export function TagInput({ label, values, onChange, placeholder, helper, max = 20 }: TagInputProps) {
  const [text, setText] = useState("");

  const add = () => {
    const items = text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!items.length) return;
    const existing = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values, ...items.filter((item) => !existing.has(item.toLowerCase()))].slice(0, max);
    onChange(next);
    setText("");
  };

  return (
    <View style={styles.wrapper}>
      <TextField
        label={label}
        optional
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        helper={helper}
        returnKeyType="done"
        blurOnSubmit={false}
        onSubmitEditing={add}
        trailing={<IconButton icon={Plus} label={`Add to ${label}`} onPress={add} disabled={!text.trim()} />}
      />
      {values.length ? (
        <View style={styles.chips}>
          {values.map((value) => (
            <Chip
              key={value}
              label={value}
              icon={X}
              accessibilityLabel={`Remove ${value}`}
              onPress={() => onChange(values.filter((v) => v !== value))}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
});
