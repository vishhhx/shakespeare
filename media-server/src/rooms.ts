import * as mediasoup from "mediasoup";
import type { types as ms } from "mediasoup";

import { config } from "./config.ts";

// Media codecs offered by every room. Opus for audio; VP8 for browsers and H264 baseline for
// mobile hardware encoders.
const mediaCodecs: ms.RouterRtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 800 } },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: { "packetization-mode": 1, "profile-level-id": "42e01f", "level-asymmetry-allowed": 1 },
  },
];

export type PeerInfo = { userId: string; role: string; name: string; organization?: string };

export class Peer {
  readonly transports = new Map<string, ms.WebRtcTransport>();
  readonly producers = new Map<string, ms.Producer>();
  readonly consumers = new Map<string, ms.Consumer>();
  rtpCapabilities: ms.RtpCapabilities | null = null;
  readonly id: string;
  readonly info: PeerInfo;

  constructor(id: string, info: PeerInfo) {
    this.id = id;
    this.info = info;
  }

  close() {
    for (const transport of this.transports.values()) transport.close(); // closes producers/consumers too
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }

  publicView() {
    return {
      peerId: this.id,
      ...this.info,
      producers: [...this.producers.values()].map((producer) => ({ producerId: producer.id, kind: producer.kind, paused: producer.paused })),
    };
  }
}

export class Room {
  readonly peers = new Map<string, Peer>();
  private emptyTimer: NodeJS.Timeout | null = null;
  readonly id: string;
  readonly router: ms.Router;
  readonly webRtcServer: ms.WebRtcServer;
  private readonly onEmpty: (room: Room) => void;

  constructor(id: string, router: ms.Router, webRtcServer: ms.WebRtcServer, onEmpty: (room: Room) => void) {
    this.id = id;
    this.router = router;
    this.webRtcServer = webRtcServer;
    this.onEmpty = onEmpty;
  }

  peerByUser(userId: string) {
    return [...this.peers.values()].find((peer) => peer.info.userId === userId);
  }

  add(peer: Peer) {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.peers.set(peer.id, peer);
  }

  remove(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.close();
    this.peers.delete(peerId);
    if (this.peers.size === 0 && !this.emptyTimer) {
      this.emptyTimer = setTimeout(() => this.onEmpty(this), config.emptyRoomTtlMs);
    }
  }

  close() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.router.close();
  }

  async createTransport() {
    const transport = await this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true, // fallback for networks that block UDP
      preferUdp: true,
      initialAvailableOutgoingBitrate: 800_000,
    });
    await transport.setMaxIncomingBitrate(1_500_000).catch(() => undefined);
    return transport;
  }
}

/** mediasoup workers (one per configured core) and the rooms living on them. */
export class RoomManager {
  private workers: { worker: ms.Worker; webRtcServer: ms.WebRtcServer }[] = [];
  private next = 0;
  readonly rooms = new Map<string, Room>();

  async start() {
    for (let index = 0; index < config.workers; index += 1) {
      const worker = await mediasoup.createWorker({ logLevel: "warn" });
      worker.on("died", () => {
        // A dead worker takes its rooms' media with it; exit so the supervisor restarts us.
        console.error(`[media] worker ${worker.pid} died; exiting`);
        process.exit(1);
      });
      const port = config.rtc.port + index;
      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          { protocol: "udp", ip: config.rtc.listenIp, announcedAddress: config.rtc.announcedAddress, port },
          { protocol: "tcp", ip: config.rtc.listenIp, announcedAddress: config.rtc.announcedAddress, port },
        ],
      });
      this.workers.push({ worker, webRtcServer });
    }
    console.log(`[media] ${this.workers.length} worker(s); media on ${config.rtc.announcedAddress}:${config.rtc.port} (udp, tcp fallback)`);
  }

  async getOrCreate(roomId: string) {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const slot = this.workers[this.next++ % this.workers.length]!;
    const router = await slot.worker.createRouter({ mediaCodecs });
    const room = new Room(roomId, router, slot.webRtcServer, (empty) => {
      if (empty.peers.size === 0) this.close(empty.id);
    });
    this.rooms.set(roomId, room);
    return room;
  }

  close(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.close();
    this.rooms.delete(roomId);
  }

  async stop() {
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
    for (const { worker } of this.workers) worker.close();
  }
}
