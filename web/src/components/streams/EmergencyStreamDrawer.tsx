import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";

import { useSocket } from "@/context/socket";
import { AuthServices } from "@/services";
import { useAppSelector } from "@/store/hooks";

type PublisherAvailable = {
  emergencyId: string;
  publisherSocketId: string;
  userId: string;
  role: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
};

type MediaFrameEvent = {
  emergencyId: string;
  publisherSocketId: string;
  dataUrl: string;
  mimeType?: string;
  width?: number;
  height?: number;
  capturedAt?: string;
};

type MediaAudioEvent = {
  emergencyId: string;
  publisherSocketId: string;
  dataUrl: string;
  mimeType?: string;
  durationMs?: number;
  capturedAt?: string;
};

type MediaVideoEvent = {
  emergencyId: string;
  publisherSocketId: string;
  dataUrl: string;
  mimeType?: string;
  durationMs?: number;
  capturedAt?: string;
};

type StreamPresenceTile = {
  key: string;
  emergencyId: string;
  publisherSocketId: string;
  userId: string;
  role: string;
  startedAt: string;
  lastHeartbeatAt: string;
  metadata: Record<string, unknown>;
  latestFrameUrl?: string;
  latestFrameAt?: string;
  latestVideoUrl?: string;
  latestVideoAt?: string;
  latestVideoBytes?: number;
  latestVideoMime?: string;
  latestVideoDurationMs?: number;
  latestAudioAt?: string;
};

const emitAck = <T,>(socket: Socket, event: string, payload: Record<string, unknown>) => {
  return new Promise<T>((resolve, reject) => {
    socket.emit(event, payload, (response: { ok?: boolean; error?: string } & T) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Socket request failed"));
        return;
      }
      resolve(response);
    });
  });
};

export default function EmergencyStreamDrawer() {
  const { socket, connected } = useSocket();
  const authUser = useAppSelector((state) => state.auth.authData);

  const [open, setOpen] = useState(true);
  const [tiles, setTiles] = useState<StreamPresenceTile[]>([]);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const canViewStreams = useMemo(() => {
    return authUser?.role === "controller-center" || authUser?.role === "authority" || authUser?.role === "responder";
  }, [authUser?.role]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!socket || !connected || !canViewStreams) {
      return;
    }

    const peerKey = (emergencyId: string, publisherSocketId: string) => `${emergencyId}:${publisherSocketId}`;

    const upsertTile = (params: {
      emergencyId: string;
      publisherSocketId: string;
      userId: string;
      role: string;
      startedAt?: string;
      lastHeartbeatAt?: string;
      metadata?: Record<string, unknown>;
      latestFrameUrl?: string;
      latestFrameAt?: string;
      latestVideoUrl?: string;
      latestVideoAt?: string;
      latestVideoBytes?: number;
      latestVideoMime?: string;
      latestVideoDurationMs?: number;
      latestAudioAt?: string;
    }) => {
      const key = peerKey(params.emergencyId, params.publisherSocketId);
      setTiles((prev) => {
        const idx = prev.findIndex((tile) => tile.key === key);
        const nowIso = new Date().toISOString();

        if (idx === -1) {
          return [
            ...prev,
            {
              key,
              emergencyId: params.emergencyId,
              publisherSocketId: params.publisherSocketId,
              userId: params.userId,
              role: params.role,
              startedAt: params.startedAt || nowIso,
              lastHeartbeatAt: params.lastHeartbeatAt || nowIso,
              metadata: params.metadata || {},
              latestFrameUrl: params.latestFrameUrl,
              latestFrameAt: params.latestFrameAt,
              latestVideoUrl: params.latestVideoUrl,
              latestVideoAt: params.latestVideoAt,
              latestVideoBytes: params.latestVideoBytes,
              latestVideoMime: params.latestVideoMime,
              latestVideoDurationMs: params.latestVideoDurationMs,
              latestAudioAt: params.latestAudioAt,
            },
          ];
        }

        const next = [...prev];
        next[idx] = {
          ...next[idx],
          userId: params.userId,
          role: params.role,
          startedAt: params.startedAt || next[idx].startedAt,
          lastHeartbeatAt: params.lastHeartbeatAt || next[idx].lastHeartbeatAt,
          metadata: params.metadata || next[idx].metadata,
          latestFrameUrl: params.latestFrameUrl || next[idx].latestFrameUrl,
          latestFrameAt: params.latestFrameAt || next[idx].latestFrameAt,
          latestVideoUrl: params.latestVideoUrl || next[idx].latestVideoUrl,
          latestVideoAt: params.latestVideoAt || next[idx].latestVideoAt,
          latestVideoBytes: params.latestVideoBytes || next[idx].latestVideoBytes,
          latestVideoMime: params.latestVideoMime || next[idx].latestVideoMime,
          latestVideoDurationMs: params.latestVideoDurationMs || next[idx].latestVideoDurationMs,
          latestAudioAt: params.latestAudioAt || next[idx].latestAudioAt,
        };
        return next;
      });
    };

    const removePeer = (emergencyId: string, publisherSocketId: string) => {
      const key = peerKey(emergencyId, publisherSocketId);
      setTiles((prev) => prev.filter((tile) => tile.key !== key));
    };

    const handlePublisherAvailable = (payload: PublisherAvailable) => {
      if (!payload?.emergencyId || !payload?.publisherSocketId) {
        return;
      }

      upsertTile({
        emergencyId: payload.emergencyId,
        publisherSocketId: payload.publisherSocketId,
        userId: payload.userId,
        role: payload.role,
        startedAt: payload.startedAt,
        lastHeartbeatAt: payload.lastHeartbeatAt,
      });
    };

    const handlePublisherHeartbeat = (payload: {
      emergencyId?: string;
      publisherSocketId?: string;
      userId?: string;
      role?: string;
      lastHeartbeatAt?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const emergencyId = String(payload?.emergencyId || "");
      const publisherSocketId = String(payload?.publisherSocketId || "");
      if (!emergencyId || !publisherSocketId) {
        return;
      }

      upsertTile({
        emergencyId,
        publisherSocketId,
        userId: String(payload?.userId || "unknown"),
        role: String(payload?.role || "unknown"),
        lastHeartbeatAt: payload?.lastHeartbeatAt,
        metadata: payload?.metadata || {},
      });
    };

    const handleMediaFrame = (payload: MediaFrameEvent) => {
      const emergencyId = String(payload?.emergencyId || "");
      const publisherSocketId = String(payload?.publisherSocketId || "");
      
      console.log("[🎥 Web Drawer] Received media frame event:", {
        emergencyId,
        publisherSocketId,
        dataUrlLength: payload?.dataUrl?.length,
        capturedAt: payload?.capturedAt,
      });

      if (!emergencyId || !publisherSocketId || !payload?.dataUrl) {
        console.warn("[🎥 Web Drawer] Missing required frame data");
        return;
      }

      console.log("[🎥 Web Drawer] Updating tile with frame");
      upsertTile({
        emergencyId,
        publisherSocketId,
        userId: "unknown",
        role: "publisher",
        latestFrameUrl: payload.dataUrl,
        latestFrameAt: payload.capturedAt,
      });
    };

    const handleMediaAudio = (payload: MediaAudioEvent) => {
      const emergencyId = String(payload?.emergencyId || "");
      const publisherSocketId = String(payload?.publisherSocketId || "");
      
      console.log("[🎙️ Web Drawer] Received media audio event:", {
        emergencyId,
        publisherSocketId,
        dataUrlLength: payload?.dataUrl?.length,
        capturedAt: payload?.capturedAt,
      });

      if (!emergencyId || !publisherSocketId || !payload?.dataUrl) {
        console.warn("[🎙️ Web Drawer] Missing required audio data");
        return;
      }

      upsertTile({
        emergencyId,
        publisherSocketId,
        userId: "unknown",
        role: "publisher",
        latestAudioAt: payload.capturedAt,
      });

      try {
        const audio = new Audio(payload.dataUrl);
        console.log("[🎙️ Web Drawer] Playing audio");
        void audio.play().catch((err) => {
          console.error("[🎙️ Web Drawer] Failed to play audio:", err instanceof Error ? err.message : String(err));
        });
      } catch (error) {
        console.error("[🎙️ Web Drawer] Error creating audio element:", error instanceof Error ? error.message : String(error));
      }
    };

    const handleMediaVideo = (payload: MediaVideoEvent) => {
      const emergencyId = String(payload?.emergencyId || "");
      const publisherSocketId = String(payload?.publisherSocketId || "");
      
      console.log("[🎬 Web Drawer] Received media video event:", {
        emergencyId,
        publisherSocketId,
        dataUrlLength: payload?.dataUrl?.length,
        durationMs: payload?.durationMs,
        mimeType: payload?.mimeType,
        prefix: payload?.dataUrl?.slice(0, 32),
        capturedAt: payload?.capturedAt,
      });

      if (!emergencyId || !publisherSocketId || !payload?.dataUrl) {
        console.warn("[🎬 Web Drawer] Missing required video data");
        return;
      }

      console.log("[🎬 Web Drawer] Updating tile with video");
      upsertTile({
        emergencyId,
        publisherSocketId,
        userId: "unknown",
        role: "publisher",
        latestVideoUrl: payload.dataUrl,
        latestVideoAt: payload.capturedAt,
        latestVideoBytes: payload.dataUrl.length,
        latestVideoMime: payload.mimeType || "video/mp4",
        latestVideoDurationMs: payload.durationMs,
      });
    };

    const handlePublisherLeft = (payload: { emergencyId?: string; publisherSocketId?: string }) => {
      const emergencyId = String(payload?.emergencyId || "");
      const publisherSocketId = String(payload?.publisherSocketId || "");
      if (!emergencyId || !publisherSocketId) return;
      removePeer(emergencyId, publisherSocketId);
    };

    const handleCaseClosed = (payload: { emergencyId?: string }) => {
      const emergencyId = String(payload?.emergencyId || "");
      if (!emergencyId) return;

      console.log("[🎥 Web Drawer] Emergency case closed:", emergencyId);
      setTiles((prev) => prev.filter((tile) => tile.emergencyId !== emergencyId));
      toast.info(`Emergency ${emergencyId.slice(-6)} closed. Stream stopped.`);
    };

    socket.on("stream:publisher-available", handlePublisherAvailable);
    socket.on("stream:publisher-heartbeat", handlePublisherHeartbeat);
    socket.on("stream:media-frame", handleMediaFrame);
    socket.on("stream:media-audio", handleMediaAudio);
    socket.on("stream:media-video", handleMediaVideo);
    socket.on("stream:publisher-left", handlePublisherLeft);
    socket.on("emergency-case-closed", handleCaseClosed);

    // Sync with backend: remove tiles for emergencies that no longer exist
    const syncEmergencies = async () => {
      try {
        const ongoing = await AuthServices.getControlCenterOngoingEmergencies();
        const emergencies = (ongoing?.emergencies as Array<{ emergencyId: string }> | undefined) ?? [];
        const ongoingIds = new Set(emergencies.map(e => e.emergencyId));

        setTiles((prev) => {
          const filtered = prev.filter((tile) => ongoingIds.has(tile.emergencyId));
          
          // Log if we removed any tiles
          if (filtered.length < prev.length) {
            const removed = prev.filter((tile) => !ongoingIds.has(tile.emergencyId));
            console.log("[🎥 Web Drawer] Removed tiles for deleted emergencies:", removed.map(t => t.emergencyId));
            removed.forEach((tile) => {
              toast.warning(`Emergency ${tile.emergencyId.slice(-6)} deleted.`);
            });
          }
          
          return filtered;
        });
      } catch (error) {
        console.error("[🎥 Web Drawer] Failed to sync emergencies:", error instanceof Error ? error.message : String(error));
      }
    };

    void (async () => {
      try {
        const ongoing = await AuthServices.getControlCenterOngoingEmergencies();
        const emergencies = (ongoing?.emergencies as Array<{ emergencyId: string }> | undefined) ?? [];

        console.log("[🎥 Web Drawer] Initializing viewers for emergencies:", emergencies.map(e => e.emergencyId));

        for (const emergency of emergencies) {
          const emergencyId = String(emergency.emergencyId || "");
          if (!emergencyId) continue;

          try {
            await emitAck<{ ok: true; emergencyId: string; publisher: PublisherAvailable | null }>(
              socket,
              "stream:viewer:join",
              { emergencyId },
            ).then((response) => {
              if (response.publisher) {
                handlePublisherAvailable(response.publisher);
              }
            });
          } catch (error) {
            console.error("[🎥 Web Drawer] Failed to join emergency:", emergencyId, error instanceof Error ? error.message : String(error));
            // Remove this tile if we can't join
            setTiles((prev) => prev.filter((tile) => tile.emergencyId !== emergencyId));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to initialize stream activity";
        console.error("[🎥 Web Drawer]", message);
      }
    })();

    // Sync emergencies every 30 seconds
    const syncInterval = setInterval(() => {
      void syncEmergencies();
    }, 30000);

    return () => {
      clearInterval(syncInterval);
      socket.off("stream:publisher-available", handlePublisherAvailable);
      socket.off("stream:publisher-heartbeat", handlePublisherHeartbeat);
      socket.off("stream:media-frame", handleMediaFrame);
      socket.off("stream:media-audio", handleMediaAudio);
      socket.off("stream:media-video", handleMediaVideo);
      socket.off("stream:publisher-left", handlePublisherLeft);
      socket.off("emergency-case-closed", handleCaseClosed);
      setTiles([]);
    };
  }, [socket, connected, canViewStreams]);

  if (!canViewStreams) {
    return null;
  }

  const getHeartbeatBadge = (lastHeartbeatAt: string) => {
    const ageMs = nowTs - new Date(lastHeartbeatAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > 25000) {
      return "stale";
    }
    if (ageMs > 12000) {
      return "delayed";
    }
    return "live";
  };

  return (
    <aside className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 p-4">
      <div className="pointer-events-auto mx-auto max-w-7xl rounded-xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Control Center Stream Activity</p>
            <p className="text-sm font-semibold text-foreground">{tiles.length} active publisher(s)</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-xs text-foreground"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>

        {open && (
          <div className="mt-3 grid max-h-64 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {tiles.length === 0 && (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                Waiting for emergency publishers...
              </div>
            )}

            {tiles.map((tile) => (
              <article key={tile.key} className="rounded-md border border-border bg-background p-2">
                <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Emergency {tile.emergencyId.slice(-6)}</span>
                  <div className="flex items-center gap-2">
                    <span>{tile.role}</span>
                    <button
                      onClick={() => {
                        console.log("[🎥 Web Drawer] Manually removing tile:", tile.emergencyId);
                        setTiles((prev) => prev.filter((t) => t.key !== tile.key));
                      }}
                      className="text-[10px] font-semibold text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove this emergency from view"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="overflow-hidden rounded border border-border/60 bg-black">
                  {tile.latestVideoUrl ? (
                    <video
                      key={tile.latestVideoAt || tile.latestVideoUrl.length}
                      src={tile.latestVideoUrl}
                      className="h-40 w-full object-cover"
                      autoPlay
                      muted
                      controls
                      playsInline
                    />
                  ) : tile.latestFrameUrl ? (
                    <img
                      src={tile.latestFrameUrl}
                      alt={`Live emergency feed ${tile.emergencyId}`}
                      className="h-40 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center text-[11px] text-muted-foreground">
                      Waiting for video chunk...
                    </div>
                  )}
                </div>
                <div className="rounded border border-border/60 bg-card p-2 text-[11px] text-muted-foreground">
                  <p>Status: {getHeartbeatBadge(tile.lastHeartbeatAt)}</p>
                  <p>Started: {new Date(tile.startedAt).toLocaleTimeString()}</p>
                  <p>Heartbeat: {new Date(tile.lastHeartbeatAt).toLocaleTimeString()}</p>
                  <p>Source: {String(tile.metadata.source || "unknown")}</p>
                  {tile.latestVideoAt && <p>Video: {new Date(tile.latestVideoAt).toLocaleTimeString()}</p>}
                  {tile.latestVideoBytes && <p>Video bytes: {tile.latestVideoBytes}</p>}
                  {tile.latestVideoMime && <p>Video mime: {tile.latestVideoMime}</p>}
                  {tile.latestVideoDurationMs && <p>Video duration: {tile.latestVideoDurationMs}ms</p>}
                  {tile.latestFrameAt && <p>Frame: {new Date(tile.latestFrameAt).toLocaleTimeString()}</p>}
                  {tile.latestAudioAt && <p>Mic: {new Date(tile.latestAudioAt).toLocaleTimeString()}</p>}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">User: {tile.userId.slice(-8)}</p>
                <p className="text-[11px] text-muted-foreground">Socket: {tile.publisherSocketId.slice(-8)}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
