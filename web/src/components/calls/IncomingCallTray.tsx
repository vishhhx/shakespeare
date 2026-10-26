import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Phone, PhoneIncoming, PhoneOff, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/emergency/badges";
import { useCalls } from "@/context/calls";
import { useAppSelector } from "@/store/hooks";
import { TYPE_LABELS, timeAgo, type EmergencyType } from "@/lib/emergency";
import type { CallView } from "@/services/callServices";

const INVITE_TTL_MS = 2 * 60 * 1000;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function CaseLine({ call }: { call: CallView }) {
  const emergency = call.emergency;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {emergency && <SeverityBadge severity={emergency.severity} />}
        <span className="text-xs text-muted-foreground">Case #{call.emergencyId.slice(-6).toUpperCase()}</span>
      </div>
      <p className="font-semibold leading-tight">{emergency?.title ?? "Emergency call"}</p>
      <p className="text-xs text-muted-foreground">
        {emergency ? `${TYPE_LABELS[emergency.type as EmergencyType] ?? emergency.type} · from ${emergency.reporterName}` : ""}
        {emergency?.location?.address ? ` · ${emergency.location.address}` : emergency?.location ? ` · ${emergency.location.lat.toFixed(4)}, ${emergency.location.lng.toFixed(4)}` : ""}
      </p>
    </div>
  );
}

/** Bottom-right stack: ringing emergency calls (control center), invitations, and calls to rejoin. */
export default function IncomingCallTray() {
  const { incoming, invitations, resumable, active, busy, answer, decline, respond, rejoin } = useCalls();
  const now = useNow();
  const myId = useAppSelector((state) => state.auth.authData?._id);
  const [confirmDecline, setConfirmDecline] = useState<string | null>(null);

  const ringing = incoming.filter((call) => call.status === "ringing" && !call.participants.some((p) => p.role === "controller-center" && p.inviteStatus === "accepted"));
  if (!ringing.length && !invitations.length && !resumable.length) return null;

  return (
    <aside aria-label="Emergency calls" aria-live="assertive" className="fixed bottom-4 right-4 z-40 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3">
      {ringing.map((call) => {
        const declinedByMe = call.declinedBy.some((entry) => entry.userId === myId);
        const callerOnline = call.participants.some((p) => p.inviteStatus === "caller" && p.connection === "connected");
        return (
          <div key={call.callId} className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border-2 border-red-500 bg-card p-4 shadow-xl">
            <div className="mb-2 flex items-center gap-2 text-red-600 dark:text-red-400">
              <PhoneIncoming className="h-4 w-4 animate-pulse" />
              <span className="text-xs font-semibold uppercase tracking-wide">Incoming emergency call</span>
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(call.createdAt)}</span>
            </div>
            <CaseLine call={call} />
            <p className="mt-2 text-xs text-muted-foreground">
              {callerOnline ? "The caller is on the line." : "The caller hasn't connected their camera or microphone yet."}
              {call.declinedBy.length ? ` Passed by ${call.declinedBy.map((entry) => entry.name).join(", ")}.` : ""}
            </p>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1 bg-green-600 text-white hover:bg-green-700" disabled={busy === `answer:${call.callId}` || Boolean(active)} onClick={() => void answer(call.callId)}>
                <Phone /> {busy === `answer:${call.callId}` ? "Connecting…" : "Answer"}
              </Button>
              {confirmDecline === call.callId ? (
                <Button variant="destructive" onClick={() => { setConfirmDecline(null); void decline(call.callId); }}>
                  Confirm pass
                </Button>
              ) : (
                <Button variant="outline" disabled={declinedByMe} onClick={() => setConfirmDecline(call.callId)}>
                  <PhoneOff /> Decline
                </Button>
              )}
            </div>
            {active && <p className="mt-2 text-xs text-muted-foreground">Leave your current call to answer this one.</p>}
            <Link to={`/emergency/${call.emergencyId}`} className="mt-2 inline-block text-xs text-blue-700 underline dark:text-blue-300">Open the case</Link>
          </div>
        );
      })}

      {invitations.map((call) => {
        const me = call.participants.find((participant) => participant.isMe);
        const inviter = call.participants.find((participant) => participant.inviteStatus === "accepted" && participant.role === me?.invitedByRole);
        const msLeft = me?.invitedAt ? new Date(me.invitedAt).getTime() + INVITE_TTL_MS - now : INVITE_TTL_MS;
        const inCall = call.participants.filter((participant) => participant.connection === "connected");
        return (
          <div key={call.callId} className="rounded-xl border-2 border-amber-500 bg-card p-4 shadow-xl">
            <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <PhoneIncoming className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Invitation to an emergency call</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{msLeft > 0 ? `${Math.ceil(msLeft / 1000)}s` : "expired"}</span>
            </div>
            <CaseLine call={call} />
            <p className="mt-2 text-xs text-muted-foreground">
              Invited by {inviter?.name ?? (me?.invitedByRole === "authority" ? "an authority" : "the control center")}.
              {inCall.length ? ` In the call: ${inCall.map((participant) => participant.name).join(", ")}.` : ""}
            </p>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1" disabled={msLeft <= 0 || busy === `respond:${call.callId}` || Boolean(active)} onClick={() => void respond(call.callId, true)}>
                <Phone /> Join call
              </Button>
              <Button variant="outline" disabled={busy === `respond:${call.callId}`} onClick={() => void respond(call.callId, false)}>
                Decline
              </Button>
            </div>
          </div>
        );
      })}

      {!active &&
        resumable.map((call) => (
          <div key={call.callId} className="rounded-xl border border-border bg-card p-4 shadow-lg">
            <CaseLine call={call} />
            <p className="mt-2 text-xs text-muted-foreground">You're part of this call but not connected.</p>
            <Button className="mt-3 w-full" variant="outline" disabled={busy === `rejoin:${call.callId}`} onClick={() => void rejoin(call.callId)}>
              <RotateCcw /> Rejoin call
            </Button>
          </div>
        ))}
    </aside>
  );
}
