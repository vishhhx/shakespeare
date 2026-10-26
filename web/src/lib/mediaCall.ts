// Client side of a SafeSphere emergency call on the SafeSphere SFU (media-server/).
// Platform-neutral: the mobile app has a twin at SafeSphere/src/lib/mediaCall.ts that differs
// only in how it gets camera/microphone tracks. Keep the two in step.
//
// The API decides who may join (and returns a 2-minute media token); this class opens the
// media connection with that token, publishes local audio/video and plays everyone else's.
// "connected" is only reported once our transports are actually up, never optimistically.
import { Device, type types as msc } from "mediasoup-client";
import { io, type Socket } from "socket.io-client";

export type CallConnection = "idle" | "connecting" | "connected" | "reconnecting" | "failed" | "ended";

export type RemotePeer = {
  peerId: string;
  userId: string;
  name: string;
  role: string;
  organization?: string;
  audio?: MediaStreamTrack;
  video?: MediaStreamTrack;
  audioPaused: boolean;
  videoPaused: boolean;
};

export type LocalMedia = {
  stream: MediaStream | null;
  audioAvailable: boolean;
  videoAvailable: boolean;
  micOn: boolean;
  cameraOn: boolean;
  /** Plain-language note when we fell back (audio only, listen only). */
  notice: string | null;
};

export type CallSnapshot = {
  connection: CallConnection;
  error: string | null;
  endedReason: string | null;
  local: LocalMedia;
  peers: RemotePeer[];
};

export type MediaCredentials = { token: string; mediaUrl: string };

type Options = {
  /** Asks the API for a fresh media token (first join and every rejoin). */
  getCredentials: () => Promise<MediaCredentials>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  handlerName?: "ReactNative106";
};

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

const MAX_REJOIN_ATTEMPTS = 6;

export class MediaCall {
  private readonly options: Options;
  private socket: Socket | null = null;
  private device: Device | null = null;
  private sendTransport: msc.Transport | null = null;
  private recvTransport: msc.Transport | null = null;
  private producers = new Map<"audio" | "video", msc.Producer>();
  private consumers = new Map<string, { consumer: msc.Consumer; peerId: string }>();
  private peers = new Map<string, RemotePeer>();
  private listeners = new Set<(snapshot: CallSnapshot) => void>();
  private connection: CallConnection = "idle";
  private error: string | null = null;
  private endedReason: string | null = null;
  private local: LocalMedia = { stream: null, audioAvailable: false, videoAvailable: false, micOn: false, cameraOn: false, notice: null };
  private leaving = false;
  private rejoinAttempts = 0;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: Options) {
    this.options = options;
  }

  subscribe(listener: (snapshot: CallSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): CallSnapshot {
    return {
      connection: this.connection,
      error: this.error,
      endedReason: this.endedReason,
      local: { ...this.local },
      peers: [...this.peers.values()].map((peer) => ({ ...peer })),
    };
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private setConnection(connection: CallConnection, error: string | null = null) {
    this.connection = connection;
    this.error = error;
    this.emit();
  }

  /** Join the call. Asks for camera + microphone, falling back to audio-only or listen-only. */
  async start({ video = true }: { video?: boolean } = {}) {
    this.leaving = false;
    this.setConnection("connecting");
    await this.acquireMedia(video);
    await this.connect();
  }

  private async acquireMedia(wantVideo: boolean) {
    const getUserMedia =
      this.options.getUserMedia ??
      (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
        ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
        : null);
    if (!getUserMedia) {
      this.local = { ...this.local, notice: "This device can't use a camera or microphone here. You can still see and hear others." };
      return;
    }
    const attempts: { constraints: MediaStreamConstraints; notice: string | null }[] = [
      ...(wantVideo
        ? [{ constraints: { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } }, notice: null }]
        : []),
      { constraints: { audio: true, video: false }, notice: wantVideo ? "Camera unavailable, so you're on audio only." : null },
    ];
    for (const attempt of attempts) {
      try {
        const stream = await getUserMedia(attempt.constraints);
        const hasVideo = stream.getVideoTracks().length > 0;
        this.local = { stream, audioAvailable: stream.getAudioTracks().length > 0, videoAvailable: hasVideo, micOn: true, cameraOn: hasVideo, notice: attempt.notice };
        this.emit();
        return;
      } catch {
        // try the next, smaller request
      }
    }
    this.local = {
      stream: null,
      audioAvailable: false,
      videoAvailable: false,
      micOn: false,
      cameraOn: false,
      notice: "Camera and microphone are blocked. Allow them in settings to talk; you can still see and hear others.",
    };
    this.emit();
  }

  private request<T>(event: string, data: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("Not connected"));
      this.socket.timeout(10000).emit(event, data, (timeoutError: Error | null, response: Ack<T>) => {
        if (timeoutError) return reject(new Error("The media server didn't answer in time"));
        if (!response?.ok) return reject(new Error((response as { error?: string })?.error || "Request failed"));
        resolve(response.data);
      });
    });
  }

  private async connect() {
    let credentials: MediaCredentials;
    try {
      credentials = await this.options.getCredentials();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "You can't join this call.");
      return;
    }

    const socket = io(credentials.mediaUrl, {
      auth: { token: credentials.token },
      transports: ["websocket"],
      reconnection: false, // tokens are short-lived: every reconnect fetches a fresh one (rejoin)
      timeout: 10000,
    });
    this.socket = socket;

    socket.on("connect_error", () => this.scheduleRejoin("Can't reach the call server"));
    socket.on("disconnect", () => {
      if (this.socket === socket && !this.leaving && this.connection !== "ended") this.scheduleRejoin("Connection lost");
    });
    socket.on("roomClosed", ({ reason }: { reason?: string }) => this.finish(reason || "ended"));
    socket.on("replaced", () => this.finish("joined_elsewhere"));
    socket.on("fatal", ({ error }: { error?: string }) => this.fail(error || "The call couldn't continue."));
    socket.on("peerJoined", (peer: RemotePeer & { producers: unknown[] }) => {
      this.peers.set(peer.peerId, { peerId: peer.peerId, userId: peer.userId, name: peer.name, role: peer.role, organization: peer.organization, audioPaused: false, videoPaused: false });
      this.emit();
    });
    socket.on("peerLeft", ({ peerId }: { peerId: string }) => {
      this.peers.delete(peerId);
      for (const [id, entry] of this.consumers) {
        if (entry.peerId === peerId) {
          entry.consumer.close();
          this.consumers.delete(id);
        }
      }
      this.emit();
    });
    socket.on("newProducer", ({ producerId }: { producerId: string }) => void this.consume(producerId));
    socket.on("consumerClosed", ({ consumerId }: { consumerId: string }) => this.dropConsumer(consumerId));
    socket.on("producerPaused", ({ peerId, kind }: { peerId: string; kind: "audio" | "video" }) => this.markPaused(peerId, kind, true));
    socket.on("producerResumed", ({ peerId, kind }: { peerId: string; kind: "audio" | "video" }) => this.markPaused(peerId, kind, false));

    socket.once("connect", () => void this.setup(socket));
  }

  private async setup(socket: Socket) {
    try {
      const joined = await this.request<{
        routerRtpCapabilities: msc.RtpCapabilities;
        peers: { peerId: string; userId: string; name: string; role: string; organization?: string; producers: { producerId: string; kind: string; paused: boolean }[] }[];
      }>("join");

      this.device = await Device.factory(this.options.handlerName ? { handlerName: this.options.handlerName } : undefined);
      await this.device.load({ routerRtpCapabilities: joined.routerRtpCapabilities });

      this.sendTransport = await this.createTransport("send");
      this.recvTransport = await this.createTransport("recv");
      await this.request("ready", { rtpCapabilities: this.device.rtpCapabilities });

      // Merge rather than replace: someone may have joined (peerJoined) since the join reply.
      for (const peer of joined.peers) {
        if (this.peers.has(peer.peerId)) continue;
        this.peers.set(peer.peerId, { peerId: peer.peerId, userId: peer.userId, name: peer.name, role: peer.role, organization: peer.organization, audioPaused: false, videoPaused: false });
      }

      await this.publish();
      for (const peer of joined.peers) {
        for (const producer of peer.producers) await this.consume(producer.producerId);
      }
      if (this.socket !== socket) return; // superseded by a rejoin
      this.rejoinAttempts = 0;
      this.setConnection("connected");
    } catch (error) {
      this.scheduleRejoin(error instanceof Error ? error.message : "Couldn't set up the call");
    }
  }

  private async createTransport(direction: "send" | "recv") {
    const params = await this.request<{ id: string; iceParameters: msc.IceParameters; iceCandidates: msc.IceCandidate[]; dtlsParameters: msc.DtlsParameters }>(
      "createTransport",
      { direction },
    );
    const transport =
      direction === "send" ? this.device!.createSendTransport(params) : this.device!.createRecvTransport(params);

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.request("connectTransport", { transportId: transport.id, dtlsParameters }).then(() => callback(), errback);
    });
    if (direction === "send") {
      transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        this.request<{ producerId: string }>("produce", { transportId: transport.id, kind, rtpParameters, appData })
          .then(({ producerId }) => callback({ id: producerId }), errback);
      });
    }
    let restarted = false;
    transport.on("connectionstatechange", (state) => {
      if (state === "disconnected" && this.connection === "connected") this.setConnection("reconnecting");
      if (state === "connected" && this.connection === "reconnecting") this.setConnection("connected");
      if (state === "failed") {
        // One ICE restart (network change), then a full rejoin.
        if (!restarted) {
          restarted = true;
          this.request<{ iceParameters: msc.IceParameters }>("restartIce", { transportId: transport.id })
            .then(({ iceParameters }) => transport.restartIce({ iceParameters }))
            .catch(() => this.scheduleRejoin("The media connection failed"));
        } else {
          this.scheduleRejoin("The media connection failed");
        }
      }
    });
    return transport;
  }

  private async publish() {
    const stream = this.local.stream;
    if (!stream || !this.sendTransport) return;
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];
    if (audioTrack && this.device?.canProduce("audio")) {
      const producer = await this.sendTransport.produce({ track: audioTrack, codecOptions: { opusStereo: false, opusDtx: true }, appData: { source: "mic" } });
      this.producers.set("audio", producer);
      if (!this.local.micOn) await this.pause("audio");
    }
    if (videoTrack && this.device?.canProduce("video")) {
      const producer = await this.sendTransport.produce({
        track: videoTrack,
        // Simple two-layer simulcast lets weak receivers fall back to a lighter stream.
        encodings: [
          { scaleResolutionDownBy: 2, maxBitrate: 200_000 },
          { scaleResolutionDownBy: 1, maxBitrate: 700_000 },
        ],
        appData: { source: "camera" },
      });
      this.producers.set("video", producer);
      if (!this.local.cameraOn) await this.pause("video");
    }
  }

  private async consume(producerId: string) {
    if (!this.recvTransport || !this.device) return;
    try {
      const params = await this.request<{ consumerId: string; producerId: string; peerId: string; kind: "audio" | "video"; rtpParameters: msc.RtpParameters; producerPaused: boolean }>(
        "consume",
        { producerId, transportId: this.recvTransport.id },
      );
      if ([...this.consumers.values()].some((entry) => entry.consumer.producerId === params.producerId)) return;
      const consumer = await this.recvTransport.consume({ id: params.consumerId, producerId: params.producerId, kind: params.kind, rtpParameters: params.rtpParameters });
      this.consumers.set(consumer.id, { consumer, peerId: params.peerId });
      const peer = this.peers.get(params.peerId);
      if (peer) {
        if (params.kind === "audio") {
          peer.audio = consumer.track;
          peer.audioPaused = params.producerPaused;
        } else {
          peer.video = consumer.track;
          peer.videoPaused = params.producerPaused;
        }
      }
      await this.request("resumeConsumer", { consumerId: consumer.id });
      this.emit();
    } catch {
      // The producer may have gone away meanwhile; nothing to show.
    }
  }

  private dropConsumer(consumerId: string) {
    const entry = this.consumers.get(consumerId);
    if (!entry) return;
    entry.consumer.close();
    this.consumers.delete(consumerId);
    const peer = this.peers.get(entry.peerId);
    if (peer) {
      if (entry.consumer.kind === "audio") peer.audio = undefined;
      else peer.video = undefined;
    }
    this.emit();
  }

  private markPaused(peerId: string, kind: "audio" | "video", paused: boolean) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (kind === "audio") peer.audioPaused = paused;
    else peer.videoPaused = paused;
    this.emit();
  }

  private async pause(kind: "audio" | "video") {
    const producer = this.producers.get(kind);
    if (!producer) return;
    producer.pause();
    await this.request("pauseProducer", { producerId: producer.id }).catch(() => undefined);
  }

  private async resume(kind: "audio" | "video") {
    const producer = this.producers.get(kind);
    if (!producer) return;
    producer.resume();
    await this.request("resumeProducer", { producerId: producer.id }).catch(() => undefined);
  }

  async setMicEnabled(enabled: boolean) {
    if (!this.local.audioAvailable) return;
    this.local = { ...this.local, micOn: enabled };
    this.local.stream?.getAudioTracks().forEach((track) => (track.enabled = enabled));
    this.emit();
    await (enabled ? this.resume("audio") : this.pause("audio"));
  }

  async setCameraEnabled(enabled: boolean) {
    if (!this.local.videoAvailable) return;
    this.local = { ...this.local, cameraOn: enabled };
    this.local.stream?.getVideoTracks().forEach((track) => (track.enabled = enabled));
    this.emit();
    await (enabled ? this.resume("video") : this.pause("video"));
  }

  private scheduleRejoin(reason: string) {
    if (this.leaving || this.connection === "ended" || this.rejoinTimer) return;
    if (this.rejoinAttempts >= MAX_REJOIN_ATTEMPTS) {
      this.fail(`${reason}. Check your connection and join again.`);
      return;
    }
    this.rejoinAttempts += 1;
    this.teardownMedia();
    this.setConnection("reconnecting", reason);
    const delay = Math.min(8000, 800 * 2 ** (this.rejoinAttempts - 1));
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      void this.connect();
    }, delay);
  }

  /** Drop transports/consumers but keep the local camera/mic so a rejoin is seamless. */
  private teardownMedia() {
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.disconnect();
    for (const producer of this.producers.values()) producer.close();
    this.producers.clear();
    for (const { consumer } of this.consumers.values()) consumer.close();
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.peers.clear();
  }

  private stopLocal() {
    this.local.stream?.getTracks().forEach((track) => track.stop());
    this.local = { ...this.local, stream: null, micOn: false, cameraOn: false };
  }

  private fail(message: string) {
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    this.teardownMedia();
    this.stopLocal();
    this.setConnection("failed", message);
  }

  private finish(reason: string) {
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    this.leaving = true;
    this.teardownMedia();
    this.stopLocal();
    this.endedReason = reason;
    this.setConnection("ended");
  }

  /** Leave the call (others stay connected). Releases the camera and microphone. */
  async leave() {
    this.leaving = true;
    try {
      await this.request("leave");
    } catch {
      // already disconnected
    }
    this.finish("left");
  }
}
