import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Video, { type Room } from "twilio-video";

import { Button } from "@/components/ui/button";
import { AuthServices } from "@/services";

type Props = {
  emergencyId: string;
  autoJoin?: boolean;
  onAutoJoinHandled?: () => void;
};

type TrackLike = {
  kind?: string;
  attach?: () => HTMLElement;
  detach?: () => HTMLElement[];
};

type TrackPublicationLike = {
  track?: TrackLike | null;
};

type ParticipantLike = {
  sid?: string;
  identity?: string;
  videoTracks: {
    forEach: (callback: (publication: TrackPublicationLike) => void) => void;
  };
  audioTracks: {
    forEach: (callback: (publication: TrackPublicationLike) => void) => void;
  };
  on: (event: string, handler: (track: TrackLike) => void) => void;
};

type ParticipantItem = {
  sid: string;
  identity: string;
};

const attachTrack = (track: TrackLike, opts: { videoContainer?: HTMLDivElement | null; audioContainer?: HTMLDivElement | null }) => {
  if (!track || !track.attach) return;
  const element = track.attach();

  if (track.kind === "video") {
    const container = opts.videoContainer;
    if (!container) return;
    element.style.width = "100%";
    element.style.height = "220px";
    element.style.objectFit = "cover";
    element.setAttribute("playsinline", "true");
    (element as HTMLVideoElement).muted = true;
    (element as HTMLVideoElement).autoplay = true;
    container.appendChild(element);
    return;
  }

  if (track.kind === "audio") {
    const container = opts.audioContainer;
    if (!container) return;
    container.appendChild(element);
  }
};

const attachLocalTracks = (room: Room, localVideoRef: HTMLDivElement | null, audioRootRef: HTMLDivElement | null) => {
  if (!room || !localVideoRef) return;
  localVideoRef.innerHTML = "";

  room.localParticipant.videoTracks.forEach((publication: TrackPublicationLike) => {
    if (publication?.track) {
      attachTrack(publication.track, {
        videoContainer: localVideoRef,
        audioContainer: audioRootRef,
      });
    }
  });

  room.localParticipant.audioTracks.forEach((publication: TrackPublicationLike) => {
    if (publication?.track) {
      attachTrack(publication.track, {
        videoContainer: localVideoRef,
        audioContainer: audioRootRef,
      });
    }
  });
};

const detachTrack = (track: TrackLike) => {
  if (!track || !track.detach) return;
  const elements = track.detach();
  for (const element of elements) {
    element.remove();
  }
};

export default function TwilioEmergencyCallPanel({ emergencyId, autoJoin = false, onAutoJoinHandled }: Props) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState("");
  const [roomName, setRoomName] = useState("");
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [allowedParticipants, setAllowedParticipants] = useState<Array<{ userId: string; role: string }>>([]);

  const localVideoRef = useRef<HTMLDivElement | null>(null);
  const audioRootRef = useRef<HTMLDivElement | null>(null);
  const remoteRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const clearAllVideoNodes = () => {
    if (localVideoRef.current) {
      localVideoRef.current.innerHTML = "";
    }
    if (audioRootRef.current) {
      audioRootRef.current.innerHTML = "";
    }
    Object.values(remoteRefs.current).forEach((node) => {
      if (node) {
        node.innerHTML = "";
      }
    });
  };

  const subscribeParticipantTracks = useCallback((participant: ParticipantLike) => {
    const sid = String(participant.sid || "");
    if (!sid) return;

    const attachCurrent = () => {
      const container = remoteRefs.current[sid];
      if (!container) return;

      participant.videoTracks.forEach((publication: TrackPublicationLike) => {
        if (publication.track) {
          attachTrack(publication.track, {
            videoContainer: container,
            audioContainer: audioRootRef.current,
          });
        }
      });

      participant.audioTracks.forEach((publication: TrackPublicationLike) => {
        if (publication.track) {
          attachTrack(publication.track, {
            videoContainer: container,
            audioContainer: audioRootRef.current,
          });
        }
      });
    };

    attachCurrent();

    participant.on("trackSubscribed", (track: TrackLike) => {
      const container = remoteRefs.current[sid];
      attachTrack(track, {
        videoContainer: container,
        audioContainer: audioRootRef.current,
      });
    });

    participant.on("trackUnsubscribed", (track: TrackLike) => {
      detachTrack(track);
    });
  }, []);

  const handleParticipantConnected = useCallback((participant: ParticipantLike) => {
    const sid = String(participant.sid || "");
    const identity = String(participant.identity || sid.slice(-6));

    setParticipants((prev) => {
      if (prev.some((item) => item.sid === sid)) return prev;
      return [...prev, { sid, identity }];
    });

    subscribeParticipantTracks(participant);
  }, [subscribeParticipantTracks]);

  const handleParticipantDisconnected = useCallback((participant: ParticipantLike) => {
    const sid = String(participant.sid || "");
    setParticipants((prev) => prev.filter((item) => item.sid !== sid));
    const container = remoteRefs.current[sid];
    if (container) {
      container.innerHTML = "";
    }
  }, []);

  const leaveCall = () => {
    room?.disconnect();
    setRoom(null);
    setRoomName("");
    setParticipants([]);
    clearAllVideoNodes();
  };

  const joinCall = useCallback(async () => {
    if (!emergencyId) return;

    try {
      setError("");
      setMediaWarning("");
      setConnecting(true);
      const payload = await AuthServices.getEmergencyVideoToken(emergencyId);
      setRoomName(payload.roomName);
      setAllowedParticipants(payload.participants || []);

      const supportsGetUserMedia =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function";

      const nextRoom = await Video.connect(payload.token, {
        name: payload.roomName,
        audio: supportsGetUserMedia,
        video: supportsGetUserMedia ? { width: 640 } : false,
      });

      if (!supportsGetUserMedia) {
        setMediaWarning("Camera/microphone are not available in this browser context. Joined as viewer-only mode.");
      }

      setRoom(nextRoom);
      setConnecting(false);

      attachLocalTracks(nextRoom, localVideoRef.current, audioRootRef.current);

      const handleLocalTrackPublished = () => {
        attachLocalTracks(nextRoom, localVideoRef.current, audioRootRef.current);
      };

      const handleLocalTrackUnpublished = () => {
        attachLocalTracks(nextRoom, localVideoRef.current, audioRootRef.current);
      };

      nextRoom.localParticipant.on("trackPublished", handleLocalTrackPublished);
      nextRoom.localParticipant.on("trackUnpublished", handleLocalTrackUnpublished);

      nextRoom.participants.forEach((participant: ParticipantLike) => {
        handleParticipantConnected(participant);
      });

      nextRoom.on("participantConnected", handleParticipantConnected);
      nextRoom.on("participantDisconnected", handleParticipantDisconnected);
      nextRoom.on("disconnected", () => {
        nextRoom.localParticipant.tracks.forEach((publication: TrackPublicationLike) => {
          if (publication.track) {
            detachTrack(publication.track);
          }
        });
        nextRoom.localParticipant.off("trackPublished", handleLocalTrackPublished);
        nextRoom.localParticipant.off("trackUnpublished", handleLocalTrackUnpublished);
        setRoom(null);
        setParticipants([]);
        setMediaWarning("");
        clearAllVideoNodes();
      });
    } catch (joinError: unknown) {
      const maybeError = joinError as { response?: { data?: { error?: string } }; message?: string };
      setConnecting(false);
      setError(maybeError?.response?.data?.error || maybeError?.message || "Unable to join emergency call.");
    }
  }, [emergencyId, handleParticipantConnected, handleParticipantDisconnected]);

  useEffect(() => {
    return () => {
      room?.disconnect();
      clearAllVideoNodes();
    };
  }, [room]);

  useEffect(() => {
    if (!autoJoin || room || connecting) return;
    queueMicrotask(() => {
      void joinCall();
    });
    onAutoJoinHandled?.();
  }, [autoJoin, room, connecting, joinCall, onAutoJoinHandled]);

  const allowedCount = useMemo(() => allowedParticipants.length, [allowedParticipants.length]);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Emergency Video Call</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Join room with reporter, accepted responders, and assigned authorities.
          </p>
          {!!roomName && <p className="mt-1 text-xs text-muted-foreground">Room: {roomName}</p>}
          {allowedCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Allowed participants: {allowedCount}</p>
          )}
        </div>
        {room ? (
          <Button variant="destructive" onClick={leaveCall}>
            Leave Call
          </Button>
        ) : (
          <Button onClick={() => void joinCall()} disabled={connecting}>
            {connecting ? "Joining..." : "Join Emergency Call"}
          </Button>
        )}
      </div>

      {!!error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {!!mediaWarning && <p className="mt-3 text-sm text-amber-500">{mediaWarning}</p>}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div ref={audioRootRef} className="hidden" aria-hidden />
        <article className="overflow-hidden rounded-md border border-border bg-black">
          <p className="px-3 py-2 text-xs font-semibold text-white">Your Camera</p>
          <div ref={localVideoRef} className="h-55 w-full" />
          {!room && !!mediaWarning && (
            <p className="px-3 py-2 text-xs text-amber-300">
              Open the app on HTTPS or localhost to publish your own camera.
            </p>
          )}
        </article>

        {participants.length === 0 ? (
          <article className="rounded-md border border-border bg-background p-4">
            <p className="text-sm text-muted-foreground">Waiting for participants to join.</p>
          </article>
        ) : (
          participants.map((participant) => (
            <article key={participant.sid} className="overflow-hidden rounded-md border border-border bg-black">
              <p className="px-3 py-2 text-xs font-semibold text-white">{participant.identity}</p>
              <div
                ref={(node) => {
                  remoteRefs.current[participant.sid] = node;
                  const roomParticipant = room?.participants?.get?.(participant.sid);
                  if (node && roomParticipant) {
                    roomParticipant.videoTracks.forEach((publication: TrackPublicationLike) => {
                      if (publication.track) {
                        attachTrack(publication.track, {
                          videoContainer: node,
                          audioContainer: audioRootRef.current,
                        });
                      }
                    });

                    roomParticipant.audioTracks.forEach((publication: TrackPublicationLike) => {
                      if (publication.track) {
                        attachTrack(publication.track, {
                          videoContainer: node,
                          audioContainer: audioRootRef.current,
                        });
                      }
                    });
                  }
                }}
                className="h-55 w-full"
              />
            </article>
          ))
        )}
      </div>
    </section>
  );
}
