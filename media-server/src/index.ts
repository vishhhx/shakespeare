// SafeSphere media server: a mediasoup SFU for emergency calls.
//
// Who may join which room is decided by the API (backend/src/models/call). It hands each
// participant a 2-minute media token; this server only accepts a Socket.IO connection that
// presents a valid one, and only ever lets that connection act inside the room named in it.
// Media itself flows over UDP (TCP fallback) through one WebRtcServer port per worker.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";
import type { types as ms } from "mediasoup";

import { config } from "./config.ts";
import { Peer, RoomManager, type Room } from "./rooms.ts";

type MediaClaims = { kind: "media"; callId: string; roomId: string; userId: string; role: string; name: string; organization?: string };
type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: string }) => void;

const rooms = new RoomManager();
await rooms.start();

/** Join/leave reports to the API, which owns participant state. Retried a few times. */
const report = async (roomId: string, userId: string, peerId: string, event: "joined" | "left") => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${config.apiInternalUrl}/api/internal/media-events`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-media-secret": config.internalSecret },
        body: JSON.stringify({ roomId, userId, peerId, event }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status === 404) return;
    } catch {
      // retry below
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  console.warn(`[media] could not report ${event} for a participant in ${roomId}`);
};

// ── Internal HTTP (API → media server) ────────────────────────────────────────────────────

const readJson = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const httpServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, rooms: rooms.rooms.size });
  }
  if (req.method === "POST" && req.url?.startsWith("/internal/")) {
    if (req.headers["x-media-secret"] !== config.internalSecret) return send(res, 401, { error: "Unauthorized" });
    const body = await readJson(req);
    const roomId = String(body.roomId || "");
    if (req.url === "/internal/rooms/close") {
      io.to(roomId).emit("roomClosed", { reason: String(body.reason || "ended") });
      io.in(roomId).disconnectSockets(true);
      rooms.close(roomId);
      return send(res, 200, { ok: true });
    }
    if (req.url === "/internal/peers/kick") {
      const peer = rooms.rooms.get(roomId)?.peerByUser(String(body.userId || ""));
      if (peer) io.sockets.sockets.get(peer.id)?.disconnect(true);
      return send(res, 200, { ok: true, kicked: Boolean(peer) });
    }
  }
  // Anything else falls through to Socket.IO (which handles its own path).
  if (!req.url?.startsWith("/socket.io")) send(res, 404, { error: "Not found" });
});

// ── Signaling ─────────────────────────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: { origin: config.corsOrigins.includes("*") ? true : config.corsOrigins },
  maxHttpBufferSize: 200_000,
});

io.use((socket, next) => {
  const token = String(socket.handshake.auth?.token || "");
  try {
    const claims = jwt.verify(token, config.tokenSecret, { audience: "safesphere-media", issuer: "safesphere-api" }) as MediaClaims;
    if (claims.kind !== "media" || !claims.roomId || !claims.userId) throw new Error("bad claims");
    socket.data.claims = claims;
    next();
  } catch {
    next(new Error("Your call link has expired. Rejoining…"));
  }
});

const wrap =
  (socket: Socket, handler: (payload: any) => Promise<unknown>) =>
  async (payload: unknown, ack?: Ack) => {
    try {
      const data = await handler(payload ?? {});
      ack?.({ ok: true, data });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Request failed" });
    }
  };

io.on("connection", async (socket) => {
  const claims = socket.data.claims as MediaClaims;
  let room: Room;
  try {
    room = await rooms.getOrCreate(claims.roomId);
  } catch (error) {
    socket.emit("fatal", { error: "The call couldn't start on the media server." });
    socket.disconnect(true);
    return;
  }

  // One connection per person: a refresh or second device replaces the old one.
  const previous = room.peerByUser(claims.userId);
  if (previous) {
    io.sockets.sockets.get(previous.id)?.emit("replaced", {});
    io.sockets.sockets.get(previous.id)?.disconnect(true);
    room.remove(previous.id);
    socket.to(room.id).emit("peerLeft", { peerId: previous.id, userId: claims.userId });
  }
  if (room.peers.size >= config.maxPeersPerRoom) {
    socket.emit("fatal", { error: "This call is full." });
    socket.disconnect(true);
    return;
  }

  const peer = new Peer(socket.id, { userId: claims.userId, role: claims.role, name: claims.name, organization: claims.organization });
  room.add(peer);
  socket.join(room.id);
  let announced = false;

  const transportOf = (transportId: unknown) => {
    const transport = peer.transports.get(String(transportId));
    if (!transport) throw new Error("Unknown transport");
    return transport;
  };

  /** Create a paused consumer for `producer` on this peer's receive transport. */
  const consume = async (producerPeer: Peer, producer: ms.Producer, transportId: string) => {
    if (!peer.rtpCapabilities || !room.router.canConsume({ producerId: producer.id, rtpCapabilities: peer.rtpCapabilities })) {
      throw new Error("Your device can't receive this stream");
    }
    const consumer = await transportOf(transportId).consume({
      producerId: producer.id,
      rtpCapabilities: peer.rtpCapabilities,
      paused: true, // resumed once the client has wired it up, so no keyframe is lost
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
    consumer.on("producerclose", () => {
      peer.consumers.delete(consumer.id);
      socket.emit("consumerClosed", { consumerId: consumer.id, producerId: producer.id });
    });
    consumer.on("producerpause", () => socket.emit("producerPaused", { producerId: producer.id, peerId: producerPeer.id, kind: producer.kind }));
    consumer.on("producerresume", () => socket.emit("producerResumed", { producerId: producer.id, peerId: producerPeer.id, kind: producer.kind }));
    return {
      consumerId: consumer.id,
      producerId: producer.id,
      peerId: producerPeer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      producerPaused: consumer.producerPaused,
    };
  };

  socket.on(
    "join",
    wrap(socket, async () => ({
      routerRtpCapabilities: room.router.rtpCapabilities,
      self: { peerId: peer.id, ...peer.info },
      peers: [...room.peers.values()].filter((other) => other.id !== peer.id).map((other) => other.publicView()),
    })),
  );

  // After the client loaded its device: it can now receive, so tell the room and the API.
  socket.on(
    "ready",
    wrap(socket, async ({ rtpCapabilities }) => {
      if (!rtpCapabilities || typeof rtpCapabilities !== "object") throw new Error("rtpCapabilities required");
      peer.rtpCapabilities = rtpCapabilities as ms.RtpCapabilities;
      if (!announced) {
        announced = true;
        socket.to(room.id).emit("peerJoined", { peerId: peer.id, ...peer.info, producers: [] });
        void report(room.id, peer.info.userId, peer.id, "joined");
      }
      return {};
    }),
  );

  socket.on(
    "createTransport",
    wrap(socket, async ({ direction }) => {
      if (direction !== "send" && direction !== "recv") throw new Error("direction must be send or recv");
      if (peer.transports.size >= 2) throw new Error("Transports already created");
      const transport = await room.createTransport();
      transport.appData.direction = direction;
      peer.transports.set(transport.id, transport);
      transport.on("dtlsstatechange", (state) => {
        if (state === "failed" || state === "closed") socket.emit("transportFailed", { transportId: transport.id });
      });
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    }),
  );

  socket.on(
    "connectTransport",
    wrap(socket, async ({ transportId, dtlsParameters }) => {
      await transportOf(transportId).connect({ dtlsParameters });
      return {};
    }),
  );

  socket.on(
    "restartIce",
    wrap(socket, async ({ transportId }) => ({ iceParameters: await transportOf(transportId).restartIce() })),
  );

  socket.on(
    "produce",
    wrap(socket, async ({ transportId, kind, rtpParameters, appData }) => {
      const transport = transportOf(transportId);
      if (transport.appData.direction !== "send") throw new Error("Not a send transport");
      if (kind !== "audio" && kind !== "video") throw new Error("kind must be audio or video");
      if ([...peer.producers.values()].some((existing) => existing.kind === kind)) throw new Error(`Already sending ${kind}`);
      const producer = await transport.produce({ kind, rtpParameters, appData: { source: appData?.source ?? kind } });
      peer.producers.set(producer.id, producer);
      producer.on("transportclose", () => peer.producers.delete(producer.id));
      socket.to(room.id).emit("newProducer", { peerId: peer.id, userId: peer.info.userId, producerId: producer.id, kind });
      return { producerId: producer.id };
    }),
  );

  socket.on(
    "consume",
    wrap(socket, async ({ producerId, transportId }) => {
      for (const other of room.peers.values()) {
        const producer = other.producers.get(String(producerId));
        if (producer && other.id !== peer.id) return consume(other, producer, String(transportId));
      }
      throw new Error("That stream is no longer available");
    }),
  );

  socket.on(
    "resumeConsumer",
    wrap(socket, async ({ consumerId }) => {
      await peer.consumers.get(String(consumerId))?.resume();
      return {};
    }),
  );

  // Mute / camera off: pausing the producer stops forwarding and tells everyone.
  socket.on(
    "pauseProducer",
    wrap(socket, async ({ producerId }) => {
      await peer.producers.get(String(producerId))?.pause();
      return {};
    }),
  );
  socket.on(
    "resumeProducer",
    wrap(socket, async ({ producerId }) => {
      await peer.producers.get(String(producerId))?.resume();
      return {};
    }),
  );
  socket.on(
    "closeProducer",
    wrap(socket, async ({ producerId }) => {
      const producer = peer.producers.get(String(producerId));
      producer?.close();
      peer.producers.delete(String(producerId));
      socket.to(room.id).emit("producerClosed", { producerId, peerId: peer.id });
      return {};
    }),
  );

  // Connection quality for the UI ("weak connection" badges), from the server's point of view.
  socket.on(
    "stats",
    wrap(socket, async () => {
      const result: Record<string, unknown> = {};
      for (const [id, consumer] of peer.consumers) result[id] = (await consumer.getStats()).find((entry) => entry.type === "outbound-rtp");
      return result;
    }),
  );

  socket.on("leave", (_payload: unknown, ack?: Ack) => {
    ack?.({ ok: true });
    socket.disconnect(true);
  });

  socket.on("disconnect", () => {
    const stillMine = room.peers.get(peer.id);
    room.remove(peer.id);
    if (stillMine) {
      socket.to(room.id).emit("peerLeft", { peerId: peer.id, userId: peer.info.userId });
      if (announced) void report(room.id, peer.info.userId, peer.id, "left");
    }
  });
});

httpServer.listen(config.port, () => {
  console.log(`[media] signaling on :${config.port}`);
});

const shutdown = async () => {
  io.close();
  await rooms.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
