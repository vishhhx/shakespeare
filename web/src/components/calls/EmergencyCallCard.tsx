import { useCallback, useEffect, useState } from "react";
import { Phone, PhoneCall } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/emergency/badges";
import { useCalls } from "@/context/calls";
import { useSocketEvents } from "@/context/socket";
import { useAppSelector } from "@/store/hooks";
import { CallServices, type CallView } from "@/services/callServices";

const EVENTS = ["call:incoming", "call:answered", "call:updated", "call:ended"] as const;

/** The case page's view of its emergency call: status, who is on it, and the right action. */
export default function EmergencyCallCard({ emergencyId, caseOpen }: { emergencyId: string; caseOpen: boolean }) {
  const role = useAppSelector((state) => state.auth.authData?.role);
  const { active, busy, answer, rejoin, startForEmergency } = useCalls();
  const [call, setCall] = useState<CallView | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setCall((await CallServices.forEmergency(emergencyId)).call);
    } catch {
      setCall(null);
    }
  }, [emergencyId]);

  useEffect(() => {
    let cancelled = false;
    CallServices.forEmergency(emergencyId)
      .then((response) => !cancelled && setCall(response.call))
      .catch(() => !cancelled && setCall(null));
    return () => {
      cancelled = true;
    };
  }, [emergencyId]);
  useSocketEvents(EVENTS, () => void load());

  const inThisCall = active && call && active.callId === call.callId;
  const me = call?.participants.find((participant) => participant.isMe);
  const connected = call?.participants.filter((participant) => participant.connection === "connected") ?? [];

  return (
    <Panel title="Emergency call">
      {call === undefined ? (
        <p className="text-sm text-muted-foreground">Checking for a call…</p>
      ) : !call ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">No call is open for this case.</p>
          {role === "controller-center" && caseOpen && (
            <Button disabled={busy === `start:${emergencyId}` || Boolean(active)} onClick={() => void startForEmergency(emergencyId)}>
              <PhoneCall /> Call the reporter
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{call.status === "ringing" ? "Ringing the control center" : "Call in progress"}</span>
            {call.answeredBy ? ` · answered by ${call.answeredBy.name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {connected.length ? `Connected: ${connected.map((participant) => participant.name).join(", ")}` : "Nobody is connected yet."}
          </p>
          {inThisCall ? (
            <p className="text-xs font-medium text-green-700 dark:text-green-400">You're in this call.</p>
          ) : role === "controller-center" && (!me || me.inviteStatus !== "accepted") ? (
            <Button disabled={Boolean(active) || busy === `answer:${call.callId}`} onClick={() => void answer(call.callId)}>
              <Phone /> {call.status === "ringing" ? "Answer" : "Join call"}
            </Button>
          ) : me && ["accepted", "caller"].includes(me.inviteStatus) ? (
            <Button variant="outline" disabled={Boolean(active)} onClick={() => void rejoin(call.callId)}>
              <Phone /> Rejoin call
            </Button>
          ) : me?.inviteStatus === "invited" ? (
            <p className="text-xs text-muted-foreground">You've been invited. Use the invitation in the corner to join.</p>
          ) : (
            <p className="text-xs text-muted-foreground">You join this call when the control center or your authority invites you.</p>
          )}
        </div>
      )}
    </Panel>
  );
}
