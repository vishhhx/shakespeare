import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { useActiveCase } from "../context/activeCase";
import { STATUS_LABELS } from "../lib/emergencyTypes";
import { space, useTheme } from "../theme";
import { AppText, Button, Card, Screen } from "../components/ui";

/**
 * "Resume my emergency": lists the open cases the server knows about for this user (as reporter
 * or responder). With exactly one, it goes straight to it.
 */
export default function OngoingCaseScreen() {
  const { colors } = useTheme();
  const { active, loading, refresh } = useActiveCase();

  useEffect(() => {
    void refresh().then((next) => {
      const cases = [...(next?.asReporter ? [next.asReporter] : []), ...(next?.asResponder ?? [])];
      if (cases.length === 1) {
        router.replace({ pathname: "/case", params: { emergencyId: cases[0]!.emergencyId } });
      }
    });
  }, [refresh]);

  const cases = [
    ...(active?.asReporter ? [{ ...active.asReporter, label: "You reported" }] : []),
    ...(active?.asResponder ?? []).map((item) => ({ ...item, label: "You're helping" })),
  ];

  return (
    <Screen header={<AppText variant="title">Open emergencies</AppText>}>
      <View style={styles.stack}>
        {loading && !active ? (
          <ActivityIndicator color={colors.text} accessibilityLabel="Loading your open emergencies" />
        ) : cases.length === 0 ? (
          <>
            <AppText variant="body" tone="muted">You don’t have any open emergencies.</AppText>
            <Button label="Go to Emergency" onPress={() => router.replace("/(tabs)/emergency")} />
          </>
        ) : (
          cases.map((item) => (
            <Card key={item.emergencyId}>
              <AppText variant="overline" tone="muted">{item.label.toUpperCase()}</AppText>
              <AppText variant="headline">{item.title}</AppText>
              <AppText variant="caption" tone="muted">{STATUS_LABELS[item.status]}</AppText>
              <Button label="Open" onPress={() => router.push({ pathname: "/case", params: { emergencyId: item.emergencyId } })} />
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
