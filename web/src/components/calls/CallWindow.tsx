import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Maximize2, Mic, MicOff, Minimize2, PhoneOff, UserPlus, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/emergency/badges";
import { useCalls } from "@/context/calls";
import { ROLE_LABELS, errorMessage, type ActorRole } from "@/lib/emergency";
import type { RemotePeer } from "@/lib/mediaCall";
import { CallServices, type CallParticipantView, type InviteCandidate } from "@/services/callServices";
import { cn } from "@/lib/utils";

function TrackVideo({ track, mirrored, label }: { track?: MediaStreamTrack; mirrored?: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = track ? new MediaStream([track]) : null;
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted aria-label={label} className={cn("h-full w-full object-cover", mirrored && "-scale-x-100")} />;
}

/** Remote audio plays through its own element so muting video never mutes sound. */
function TrackAudio({ track }: { track?: MediaStreamTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = track ? new MediaStream([track]) : null;
    void ref.current.play().catch(() => undefined);
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function Tile({ name, subtitle, track, audioOff, videoOff, mirrored, highlight }: { name: string; subtitle?: string; track?: MediaStreamTrack; audioOff: boolean; videoOff: boolean; mirrored?: boolean; highlight?: boolean }) {
  const showVideo = track && !videoOff;
  return (
    <figure className={cn("relative aspect-video overflow-hidden rounded-lg bg-neutral-900", highlight && "ring-2 ring-red-500")}>
      {showVideo ? (
        <TrackVideo track={track} mirrored={mirrored} label={`${name} video`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-700 text-lg font-semibold text-white">
            {name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
          </span>
        </div>
      )}
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-white">
        <span className="truncate text-sm font-medium">{name}</span>
        {subtitle && <span className="truncate text-xs text-white/70">{subtitle}</span>}
        <span className="ml-auto flex gap-1">
          {audioOff && <MicOff className="h-3.5 w-3.5" aria-label="Microphone off" />}
          {videoOff && <VideoOff className="h-3.5 w-3.5" aria-label="Camera off" />}
        </span>
      </figcaption>
    </figure>
  );
}

const STATUS_TEXT: Record<string, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
  ended: "Call ended",
  idle: "",
};

const inviteLabel = (participant: CallParticipantView) =>
  participant.connection === "connected"
    ? "In the call"
    : participant.connection === "reconnecting"
      ? "Reconnecting"
      : participant.inviteStatus === "invited"
        ? "Invited, waiting"
        : participant.inviteStatus === "declined"
          ? "Declined"
          : participant.inviteStatus === "expired"
            ? "Didn't answer"
            : participant.connection === "left"
              ? "Left"
              : participant.inviteStatus === "caller"
                ? "Caller, not connected"
                : "Joining…";

export default function CallWindow() {
  const { active, leave, endForEveryone, setMic, setCamera, busy } = useCalls();
  const [expanded, setExpanded] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [candidates, setCandidates] = useState<InviteCandidate[] | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);

  const view = active?.view ?? null;
  const media = active?.media;
  const me = view?.participants.find((participant) => participant.isMe);
  const canInvite = me?.inviteStatus === "accepted" && (me.role === "controller-center" || me.role === "authority");
  const canEnd = me?.role === "controller-center" && me.inviteStatus === "accepted";

  useEffect(() => {
    if (!showInvite || !active) return;
    setCandidates(null);
    CallServices.invitable(active.callId)
      .then((response) => setCandidates(response.candidates))
      .catch((error) => {
        toast.error(errorMessage(error, "Couldn't load people to invite."));
        setCandidates([]);
      });
  }, [showInvite, active?.callId, view?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const byUser = useMemo(() => new Map((view?.participants ?? []).map((participant) => [participant.userId, participant])), [view?.participants]);

  if (!active || !media) return null;

  const invite = async (candidate: InviteCandidate) => {
    setInviting(candidate.userId);
    try {
      await CallServices.invite(active.callId, candidate.userId);
      toast.success(`Invited ${candidate.name}.`);
      setCandidates((current) => current?.filter((item) => item.userId !== candidate.userId) ?? null);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't send the invitation."));
    } finally {
      setInviting(null);
    }
  };

  const callerPeer = media.peers.find((peer) => byUser.get(peer.userId)?.inviteStatus === "caller");
  const ordered: RemotePeer[] = [...(callerPeer ? [callerPeer] : []), ...media.peers.filter((peer) => peer !== callerPeer)];
  const groups: { title: string; roles: ActorRole[] }[] = [
    { title: "Authorities", roles: ["authority"] },
    { title: "Field responders", roles: ["responder"] },
    { title: "Volunteers and helpers on this case", roles: ["volunteer", "public"] },
  ];

  return (
    <section
      aria-label="Emergency call"
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all",
        expanded ? "inset-4" : "bottom-4 right-4 h-[min(640px,calc(100vh-2rem))] w-[min(560px,calc(100vw-2rem))]",
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            media.connection === "connected" ? "bg-green-500" : media.connection === "failed" || media.connection === "ended" ? "bg-red-500" : "animate-pulse bg-amber-500",
          )}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{view?.emergency?.title ?? "Emergency call"}</p>
          <p className="text-xs text-muted-foreground">
            {STATUS_TEXT[media.connection]}
            {media.error && media.connection !== "connected" ? ` · ${media.error}` : ""}
          </p>
        </div>
        {view?.emergency && <SeverityBadge severity={view.emergency.severity} className="ml-1" />}
        <div className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/emergency/${view?.emergencyId ?? ""}`}>Case</Link>
          </Button>
          <Button variant="ghost" size="icon" aria-label={expanded ? "Shrink call" : "Expand call"} onClick={() => setExpanded((value) => !value)}>
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          {media.local.notice && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{media.local.notice}</p>}
          {ordered.length === 0 && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {media.connection === "connected" ? "Waiting for the caller and others to connect…" : "Joining the call…"}
            </p>
          )}
          <div className={cn("grid gap-2", ordered.length > 1 ? "sm:grid-cols-2" : "grid-cols-1")}>
            {ordered.map((peer) => (
              <div key={peer.peerId}>
                <Tile
                  name={peer.name}
                  subtitle={byUser.get(peer.userId)?.inviteStatus === "caller" ? "Caller" : peer.organization ?? ROLE_LABELS[peer.role as ActorRole]}
                  track={peer.video}
                  videoOff={!peer.video || peer.videoPaused}
                  audioOff={!peer.audio || peer.audioPaused}
                  highlight={byUser.get(peer.userId)?.inviteStatus === "caller"}
                />
                <TrackAudio track={peer.audioPaused ? undefined : peer.audio} />
              </div>
            ))}
          </div>
          <div className="w-40">
            <Tile name="You" track={media.local.stream?.getVideoTracks()[0]} videoOff={!media.local.cameraOn} audioOff={!media.local.micOn} mirrored />
          </div>
        </div>

        <aside className="space-y-3">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants</h3>
            <ul className="space-y-1.5">
              {(view?.participants ?? []).filter((p) => p.inviteStatus !== "cancelled").map((participant) => (
                <li key={participant.userId} className="flex items-start gap-2 text-sm">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", participant.connection === "connected" ? "bg-green-500" : participant.inviteStatus === "invited" ? "bg-amber-500" : "bg-neutral-400")} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{participant.isMe ? `${participant.name} (you)` : participant.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {participant.inviteStatus === "caller" ? "Caller" : ROLE_LABELS[participant.role]}
                      {participant.organization ? ` · ${participant.organization}` : ""} · {inviteLabel(participant)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {canInvite && (
            <div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setShowInvite((value) => !value)}>
                <UserPlus /> {showInvite ? "Hide invite list" : "Invite to call"}
              </Button>
              {showInvite && (
                <div className="mt-2 space-y-3">
                  {candidates === null ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nobody else is eligible to invite right now.</p>
                  ) : (
                    groups.map((group) => {
                      const list = candidates.filter((candidate) => group.roles.includes(candidate.role));
                      if (!list.length) return null;
                      return (
                        <div key={group.title}>
                          <p className="text-xs font-semibold text-muted-foreground">{group.title}</p>
                          <ul className="mt-1 space-y-1">
                            {list.map((candidate) => (
                              <li key={candidate.userId} className="flex items-center gap-2 rounded-md border border-border p-2">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{candidate.name}</span>
                                  {candidate.detail && <span className="block truncate text-xs text-muted-foreground">{candidate.detail}</span>}
                                </span>
                                <Button size="sm" disabled={inviting === candidate.userId} onClick={() => void invite(candidate)}>
                                  Invite
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-3">
        <Button variant={media.local.micOn ? "outline" : "destructive"} disabled={!media.local.audioAvailable} onClick={() => setMic(!media.local.micOn)} aria-pressed={!media.local.micOn}>
          {media.local.micOn ? <Mic /> : <MicOff />} {media.local.micOn ? "Mute" : "Unmute"}
        </Button>
        <Button variant={media.local.cameraOn ? "outline" : "destructive"} disabled={!media.local.videoAvailable} onClick={() => setCamera(!media.local.cameraOn)} aria-pressed={!media.local.cameraOn}>
          {media.local.cameraOn ? <Video /> : <VideoOff />} {media.local.cameraOn ? "Stop video" : "Start video"}
        </Button>
        <Button variant="destructive" disabled={busy === "leave"} onClick={() => void leave()}>
          <PhoneOff /> Leave
        </Button>
        {canEnd && (
          <Button variant="outline" disabled={busy === "end"} onClick={() => void endForEveryone()} title="Ends the call for everyone. The emergency stays open.">
            End for everyone
          </Button>
        )}
      </footer>
    </section>
  );
}
