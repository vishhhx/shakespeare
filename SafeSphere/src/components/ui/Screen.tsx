import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space, useTheme } from "../../theme";

type ScreenProps = {
  children: ReactNode;
  /** Pinned under the scroll area, above the home indicator (primary actions live here). */
  footer?: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
};

export function Screen({ children, footer, header, scroll = true }: ScreenProps) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: footer ? space.lg : insets.bottom + space.lg }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content]}>{children}</View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.background} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {header ? <View style={styles.header}>{header}</View> : null}
        {body}
        {footer ? (
          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(insets.bottom, space.md), borderTopColor: colors.border, backgroundColor: colors.background },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: space.gutter, paddingTop: space.xs },
  content: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space.lg },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
