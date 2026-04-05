import type { Server, Socket } from "socket.io";
import { Types } from "mongoose";

import EmergencyModel from "../models/emergency/emergency.model";

type SocketRole = "public" | "volunteer" | "responder" | "authority" | "controller-center";

type SocketAuthUser = {
  userId: string;
  role: SocketRole;
};

type PublisherState = {
  emergencyId: string;
  socketId: string;
  userId: string;
  role: SocketRole;
  startedAt: string;
  lastHeartbeatAt: string;
};

type MediaFramePayload = {
  emergencyId?: string;
  publisherSocketId?: string;
  dataUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  capturedAt?: string;
};

type MediaAudioPayload = {
  emergencyId?: string;
  publisherSocketId?: string;
  dataUrl?: string;
  mimeType?: string;
  durationMs?: number;
  capturedAt?: string;
};

type MediaVideoPayload = {
  emergencyId?: string;
  publisherSocketId?: string;
  dataUrl?: string;
  mimeType?: string;
  durationMs?: number;
  capturedAt?: string;
};

const publisherByEmergency = new Map<string, PublisherState>();
const emergencyByPublisherSocket = new Map<string, string>();
const watchedEmergenciesByViewer = new Map<string, Set<string>>();

const isViewerRole = (role: SocketRole) => role === "controller-center" || role === "authority" || role === "responder";
const isPublisherRole = (role: SocketRole) => role === "public" || role === "volunteer";

const canAccessEmergency = async (emergencyId: string, authUser: SocketAuthUser) => {
  if (!Types.ObjectId.isValid(emergencyId)) {
    return false;
  }

  const emergency = await EmergencyModel.findById(emergencyId)
    .select("reportedBy responders")
    .lean();

  if (!emergency) {
    return false;
  }

  if (authUser.role === "controller-center") {
    return true;
  }

  const isReporter = String(emergency.reportedBy) === authUser.userId;
  const isResponder = Array.isArray(emergency.responders)
    ? emergency.responders.some((responder: any) => String(responder.userId) === authUser.userId)
    : false;

  return isReporter || isResponder;
};

const emergencyRoom = (emergencyId: string) => `stream:emergency:${emergencyId}`;

const emitPublisherAvailable = (io: Server, state: PublisherState) => {
  const payload = {
    emergencyId: state.emergencyId,
    publisherSocketId: state.socketId,
    userId: state.userId,
    role: state.role,
    startedAt: state.startedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
  };

  io.to("controller-center").emit("stream:publisher-available", payload);
  io.to(emergencyRoom(state.emergencyId)).emit("stream:publisher-available", payload);
};

const emitPublisherLeft = (io: Server, state: PublisherState) => {
  const payload = {
    emergencyId: state.emergencyId,
    publisherSocketId: state.socketId,
    userId: state.userId,
    role: state.role,
  };

  io.to("controller-center").emit("stream:publisher-left", payload);
  io.to(emergencyRoom(state.emergencyId)).emit("stream:publisher-left", payload);
};

const emitMediaFrame = (io: Server, payload: Required<Pick<MediaFramePayload, "emergencyId" | "publisherSocketId" | "dataUrl" | "capturedAt">> & Partial<Pick<MediaFramePayload, "mimeType" | "width" | "height">>) => {
  const message = {
    emergencyId: payload.emergencyId,
    publisherSocketId: payload.publisherSocketId,
    dataUrl: payload.dataUrl,
    mimeType: payload.mimeType || "image/jpeg",
    width: payload.width,
    height: payload.height,
    capturedAt: payload.capturedAt,
  };

  io.to("controller-center").emit("stream:media-frame", message);
  io.to(emergencyRoom(payload.emergencyId)).emit("stream:media-frame", message);
};

const emitMediaAudio = (io: Server, payload: Required<Pick<MediaAudioPayload, "emergencyId" | "publisherSocketId" | "dataUrl" | "capturedAt">> & Partial<Pick<MediaAudioPayload, "mimeType" | "durationMs">>) => {
  const message = {
    emergencyId: payload.emergencyId,
    publisherSocketId: payload.publisherSocketId,
    dataUrl: payload.dataUrl,
    mimeType: payload.mimeType || "audio/mp4",
    durationMs: payload.durationMs,
    capturedAt: payload.capturedAt,
  };

  io.to("controller-center").emit("stream:media-audio", message);
  io.to(emergencyRoom(payload.emergencyId)).emit("stream:media-audio", message);
};

const emitMediaVideo = (io: Server, payload: Required<Pick<MediaVideoPayload, "emergencyId" | "publisherSocketId" | "dataUrl" | "capturedAt">> & Partial<Pick<MediaVideoPayload, "mimeType" | "durationMs">>) => {
  const message = {
    emergencyId: payload.emergencyId,
    publisherSocketId: payload.publisherSocketId,
    dataUrl: payload.dataUrl,
    mimeType: payload.mimeType || "video/mp4",
    durationMs: payload.durationMs,
    capturedAt: payload.capturedAt,
  };

  io.to("controller-center").emit("stream:media-video", message);
  io.to(emergencyRoom(payload.emergencyId)).emit("stream:media-video", message);
};

export const registerWebRtcSocketHandlers = (socket: Socket, io: Server, authUser: SocketAuthUser) => {
  socket.on("stream:publisher:join", async (payload: { emergencyId?: string }, ack?: (response: any) => void) => {
    try {
      const emergencyId = String(payload?.emergencyId || "");
      if (!emergencyId) {
        throw new Error("emergencyId is required");
      }

      if (!isPublisherRole(authUser.role)) {
        throw new Error("Only public/volunteer can publish emergency stream presence");
      }

      const allowed = await canAccessEmergency(emergencyId, authUser);
      if (!allowed) {
        throw new Error("Not authorized for this emergency stream");
      }

      const previous = publisherByEmergency.get(emergencyId);
      if (previous && previous.socketId !== socket.id) {
        io.to(previous.socketId).emit("stream:publisher-replaced", { emergencyId });
        emergencyByPublisherSocket.delete(previous.socketId);
      }

      const now = new Date().toISOString();
      const state: PublisherState = {
        emergencyId,
        socketId: socket.id,
        userId: authUser.userId,
        role: authUser.role,
        startedAt: now,
        lastHeartbeatAt: now,
      };

      publisherByEmergency.set(emergencyId, state);
      emergencyByPublisherSocket.set(socket.id, emergencyId);
      socket.join(emergencyRoom(emergencyId));

      emitPublisherAvailable(io, state);

      if (ack) {
        ack({ ok: true, emergencyId, publisherSocketId: socket.id });
      }
    } catch (error) {
      if (ack) {
        ack({ ok: false, error: error instanceof Error ? error.message : "Failed to join publisher" });
      }
    }
  });

  socket.on(
    "stream:publisher:heartbeat",
    (payload: { emergencyId?: string; metadata?: Record<string, unknown> }, ack?: (response: any) => void) => {
      const emergencyId = String(payload?.emergencyId || emergencyByPublisherSocket.get(socket.id) || "");
      if (!emergencyId) {
        if (ack) ack({ ok: true });
        return;
      }

      const state = publisherByEmergency.get(emergencyId);
      if (!state || state.socketId !== socket.id) {
        if (ack) ack({ ok: true });
        return;
      }

      state.lastHeartbeatAt = new Date().toISOString();
      publisherByEmergency.set(emergencyId, state);

      io.to("controller-center").emit("stream:publisher-heartbeat", {
        emergencyId,
        publisherSocketId: socket.id,
        userId: state.userId,
        role: state.role,
        lastHeartbeatAt: state.lastHeartbeatAt,
        metadata: payload?.metadata || {},
      });

      if (ack) {
        ack({ ok: true });
      }
    },
  );

  socket.on("stream:viewer:join", async (payload: { emergencyId?: string }, ack?: (response: any) => void) => {
    try {
      const emergencyId = String(payload?.emergencyId || "");
      if (!emergencyId) {
        throw new Error("emergencyId is required");
      }

      if (!isViewerRole(authUser.role)) {
        throw new Error("Only control-center, authority, and responders can view emergency streams");
      }

      const allowed = await canAccessEmergency(emergencyId, authUser);
      if (!allowed) {
        throw new Error("Not authorized for this emergency stream");
      }

      socket.join(emergencyRoom(emergencyId));
      const watched = watchedEmergenciesByViewer.get(socket.id) || new Set<string>();
      watched.add(emergencyId);
      watchedEmergenciesByViewer.set(socket.id, watched);

      const publisher = publisherByEmergency.get(emergencyId);

      if (ack) {
        ack({
          ok: true,
          emergencyId,
          publisher: publisher
            ? {
                publisherSocketId: publisher.socketId,
                userId: publisher.userId,
                role: publisher.role,
                startedAt: publisher.startedAt,
                lastHeartbeatAt: publisher.lastHeartbeatAt,
              }
            : null,
        });
      }

      if (publisher) {
        emitPublisherAvailable(io, publisher);
      }
    } catch (error) {
      if (ack) {
        ack({ ok: false, error: error instanceof Error ? error.message : "Failed to join viewer" });
      }
    }
  });

  socket.on("stream:publisher:leave", (payload: { emergencyId?: string }, ack?: (response: any) => void) => {
    const emergencyId = String(payload?.emergencyId || emergencyByPublisherSocket.get(socket.id) || "");
    if (!emergencyId) {
      if (ack) {
        ack({ ok: true });
      }
      return;
    }

    const current = publisherByEmergency.get(emergencyId);
    if (current && current.socketId === socket.id) {
      publisherByEmergency.delete(emergencyId);
      emergencyByPublisherSocket.delete(socket.id);
      emitPublisherLeft(io, current);
    }

    if (ack) {
      ack({ ok: true });
    }
  });

  socket.on("stream:media:frame", (payload: MediaFramePayload) => {
    const emergencyId = String(payload?.emergencyId || emergencyByPublisherSocket.get(socket.id) || "");
    if (!emergencyId) {
      console.warn("[🎥 Backend] Frame event received but no emergencyId");
      return;
    }

    const state = publisherByEmergency.get(emergencyId);
    if (!state || state.socketId !== socket.id) {
      console.warn("[🎥 Backend] Frame event from unauthorized publisher for emergency:", emergencyId);
      return;
    }

    if (typeof payload?.dataUrl !== "string" || !payload.dataUrl.startsWith("data:image/")) {
      console.warn("[🎥 Backend] Invalid frame data URL");
      return;
    }

    console.log("[🎥 Backend] Relaying media frame:", {
      emergencyId,
      publisherSocketId: socket.id,
      dataUrlLength: payload.dataUrl.length,
      capturedAt: payload.capturedAt,
    });

    emitMediaFrame(io, {
      emergencyId,
      publisherSocketId: socket.id,
      dataUrl: payload.dataUrl,
      mimeType: payload.mimeType || "image/jpeg",
      width: payload.width,
      height: payload.height,
      capturedAt: payload.capturedAt || new Date().toISOString(),
    });
  });

  socket.on("stream:media:audio", (payload: MediaAudioPayload) => {
    const emergencyId = String(payload?.emergencyId || emergencyByPublisherSocket.get(socket.id) || "");
    if (!emergencyId) {
      console.warn("[🎙️ Backend] Audio event received but no emergencyId");
      return;
    }

    const state = publisherByEmergency.get(emergencyId);
    if (!state || state.socketId !== socket.id) {
      console.warn("[🎙️ Backend] Audio event from unauthorized publisher for emergency:", emergencyId);
      return;
    }

    if (typeof payload?.dataUrl !== "string" || !payload.dataUrl.startsWith("data:audio/")) {
      console.warn("[🎙️ Backend] Invalid audio data URL");
      return;
    }

    console.log("[🎙️ Backend] Relaying media audio:", {
      emergencyId,
      publisherSocketId: socket.id,
      dataUrlLength: payload.dataUrl.length,
      capturedAt: payload.capturedAt,
    });

    emitMediaAudio(io, {
      emergencyId,
      publisherSocketId: socket.id,
      dataUrl: payload.dataUrl,
      mimeType: payload.mimeType || "audio/mp4",
      durationMs: payload.durationMs,
      capturedAt: payload.capturedAt || new Date().toISOString(),
    });
  });

  socket.on("stream:media:video", (payload: MediaVideoPayload, ack?: (response: { ok: boolean; error?: string }) => void) => {
    const emergencyId = String(payload?.emergencyId || emergencyByPublisherSocket.get(socket.id) || "");
    if (!emergencyId) {
      console.warn("[🎬 Backend] Video event received but no emergencyId");
      if (ack) ack({ ok: false, error: "missing-emergency-id" });
      return;
    }

    const state = publisherByEmergency.get(emergencyId);
    if (!state || state.socketId !== socket.id) {
      console.warn("[🎬 Backend] Video event from unauthorized publisher for emergency:", emergencyId);
      if (ack) ack({ ok: false, error: "unauthorized-publisher" });
      return;
    }

    if (typeof payload?.dataUrl !== "string" || !payload.dataUrl.startsWith("data:video/")) {
      console.warn("[🎬 Backend] Invalid video data URL");
      if (ack) ack({ ok: false, error: "invalid-video-data-url" });
      return;
    }

    console.log("[🎬 Backend] Relaying media video:", {
      emergencyId,
      publisherSocketId: socket.id,
      dataUrlLength: payload.dataUrl.length,
      durationMs: payload.durationMs,
      capturedAt: payload.capturedAt,
    });

    emitMediaVideo(io, {
      emergencyId,
      publisherSocketId: socket.id,
      dataUrl: payload.dataUrl,
      mimeType: payload.mimeType || "video/mp4",
      durationMs: payload.durationMs,
      capturedAt: payload.capturedAt || new Date().toISOString(),
    });

    if (ack) ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const emergencyId = emergencyByPublisherSocket.get(socket.id);
    if (emergencyId) {
      const state = publisherByEmergency.get(emergencyId);
      if (state && state.socketId === socket.id) {
        publisherByEmergency.delete(emergencyId);
        emergencyByPublisherSocket.delete(socket.id);
        emitPublisherLeft(io, state);
      }
    }

    watchedEmergenciesByViewer.delete(socket.id);
  });
};
