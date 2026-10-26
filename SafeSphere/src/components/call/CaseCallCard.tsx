import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Mic, Phone, Video } from "lucide-react-native";

import { useEmergencyCall } from "../../context/call";
import { useSocketEvent } from "../../context/socketContext";
import { getCallForEmergency } from "../../lib/api";
import type { CallView } from "../../lib/callTypes";
import { space } from "../../theme";
import { AppText, Button, Card } from "../ui";

/**
 * The emergency call as seen from a case screen. The reporter can join with video or audio only
 * (their choice; the OS asks for permission the first time). Others rejoin calls they accepted.
 */
export function CaseCallCard({ emergencyId, isReporter, caseOpen }: { emergencyId: string; isReporter: boolean; caseOpen: boolean }) {
  const { active, joinForEmergency, showSheet } = useEmergencyCall();
  const [call, setCall] = useState<CallView | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      setCall((await getCallForEmergency(emergencyId)).call);
    } catch {
      setCall(null);
    }
  }, [emergencyId]);

  useEffect(() => {
    void load();
  }, [load]);
  useSocketEvent("call:updated", () => void load());
  useSocketEvent("call:answered", () => void load());
  useSocketEvent("call:ended", () => void load());

  const inThisCall = active && active.emergencyId === emergencyId && active.media.connection !== "ended" && active.media.connection !== "failed";
  const me = call?.participants.find((participant) => participant.isMe);
  const canJoin = isReporter || (me && ["accepted", "caller"].includes(me.inviteStatus));
  if (!caseOpen || call === undefined || (!call && !isReporter) || (!canJoin && !inThisCall)) return null;

  const join = async (video: boolean) => {
    setJoining(true);
    try {
      await joinForEmergency(emergencyId, { video });
    } finally {
      setJoining(false);
      void load();
    }
  };

  const controller = call?.participants.find((participant) => participant.role === "controller-center" && participant.connection === "connected");
  const status = !call
    ? "No call is open. Call the control center to talk to someone now."
    : controller
      ? `${controller.name} from the control center is on the call.`
      : call.answeredBy
        ? "The control center answered and is joining."
        : "The control center has been alerted and will answer your call.";

  return (
    <Card>
      <View style={styles.row}>
        <Phone size={18} aria-hidden />
        <AppText variant="bodyStrong">Emergency call</AppText>
      </View>
      <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">{status}</AppText>
      {inThisCall ? (
        <Button label="Open call" icon={Phone} onPress={showSheet} />
      ) : (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button label={call ? "Join with video" : "Call with video"} icon={Video} loading={joining} onPress={() => void join(true)} />
          </View>
          <View style={styles.flex}>
            <Button label="Audio only" icon={Mic} variant="secondary" disabled={joining} onPress={() => void join(false)} />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.xs },
  flex: { flex: 1 },
});
