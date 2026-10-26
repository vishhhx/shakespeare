/// <reference lib="dom" />
// Real media test for emergency calls: the API, the SafeSphere SFU (media-server/, mediasoup)
// and three headless Chrome tabs with fake camera + microphone devices, each running the
// production client (web/src/lib/mediaCall.ts). Passes only if every tab actually receives the
// others' audio (measured signal) and video (decoded frames that keep advancing).
//
// Run: bun test tests/media.e2e.test.ts   (needs Mongo + Redis, Google Chrome, Node ≥ 22.18)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { networkInterfaces, tmpdir } from "node:os";
import mongoose from "mongoose";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { io as connectSocket } from "socket.io-client";
import { env } from "../src/config/env";
import { connectToRedis } from "../src/connections/redis";
import redisService from "../src/utils/redis";
import { signToken } from "../src/utils/jwt";
import EmergencyModel from "../src/models/emergency/emergency.model";
import { EmergencyCallModel } from "../src/models/call/call.model";
import { PublicUserModel } from "../src/models/AuthpublicUser/publicUser.model";
import { ProfilePublicUserModel } from "../src/models/ProfilePublicUser/profile.model";
import { AdminUserModel } from "../src/models/AuthadminUser/adminUser.model";
import { AuthorityProfileModel } from "../src/models/ProfileAdminUser/authority.model";

const API_PORT = 4108;
const MEDIA_PORT = 4448;
const PAGE_PORT = 4109;
const API = `http://127.0.0.1:${API_PORT}`;
const MEDIA_URL = `http://127.0.0.1:${MEDIA_PORT}`;
const CHROME = process.env.CHROME_PATH || "/opt/google/chrome/chrome";
const SPOT = { lat: -44.5, lng: -131.0 }; // open ocean: nobody real nearby
const PHONE = "+916000002001";

const lanAddress = () =>
  Object.values(networkInterfaces()).flat().find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address ?? "127.0.0.1";

const processes: ReturnType<typeof Bun.spawn>[] = [];
let pageServer: ReturnType<typeof Bun.serve> | null = null;
let browser: Browser | null = null;
const ids: { reporter?: string; authority?: string; authorityProfile?: string; cc?: string; responder?: string } = {};
const tokens: Record<"reporter" | "authority" | "cc" | "responder", string> = { reporter: "", authority: "", cc: "", responder: "" };
let callId = "";

const call = async (method: string, path: string, token: string, body?: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

const waitForHttp = async (url: string, what: string) => {
  for (let i = 0; i < 80; i++) {
    if (await fetch(url).then((r) => r.ok).catch(() => false)) return;
    await Bun.sleep(250);
  }
  throw new Error(`${what} did not start (${url})`);
};

const cleanup = async () => {
  const users = await PublicUserModel.find({ phoneNumber: PHONE }).select("_id").lean();
  const admins = await AdminUserModel.find({ email: /@media\.safesphere\.test$/ }).select("_id").lean();
  const emergencies = await EmergencyModel.find({ reportedBy: { $in: users.map((u) => u._id) } }).select("_id").lean();
  await EmergencyCallModel.deleteMany({ emergencyId: { $in: emergencies.map((e) => e._id) } });
  await EmergencyModel.deleteMany({ _id: { $in: emergencies.map((e) => e._id) } });
  await ProfilePublicUserModel.deleteMany({ userId: { $in: users.map((u) => u._id) } });
  await PublicUserModel.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  const profiles = await AuthorityProfileModel.find({ userId: { $in: admins.map((a) => a._id) } }).select("_id").lean();
  for (const profile of profiles) await redisService.redis.zRem("authorities", String(profile._id));
  for (const user of users) await redisService.redis.zRem("public-users", String(user._id));
  await AuthorityProfileModel.deleteMany({ userId: { $in: admins.map((a) => a._id) } });
  await AdminUserModel.deleteMany({ _id: { $in: admins.map((a) => a._id) } });
};

/** A browser tab running the production call client, fed with tokens from the API. */
const openParticipant = async (who: keyof typeof tokens, firstMedia: { token: string; mediaUrl: string }) => {
  const page = await browser!.newPage();
  page.on("pageerror", (error) => console.error(`[${who} page]`, error));
  let pending: typeof firstMedia | null = firstMedia;
  await page.exposeFunction("getCreds", async () => {
    if (pending) {
      const media = pending;
      pending = null;
      return media;
    }
    const response = await call("POST", `/api/${who === "reporter" ? "public" : "admin"}-user/calls/${callId}/token`, tokens[who]);
    if (response.status !== 200) throw new Error(response.body.error || "no token");
    return response.body.media;
  });
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/`);
  await page.evaluate(() => (window as any).startCall());
  await page.waitForFunction(() => (window as any).__snap?.connection === "connected", { timeout: 20000, polling: 250 });
  return page;
};

/** In-page measurement of what this tab receives from each remote participant. */
const measure = (page: Page) =>
  page.evaluate(async () => {
    const snap = (window as any).__call.snapshot();
    const out: any[] = [];
    for (const peer of snap.peers) {
      const result: any = { name: peer.name, role: peer.role, hasAudio: Boolean(peer.audio), hasVideo: Boolean(peer.video) };
      if (peer.video) {
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = new MediaStream([peer.video]);
        document.body.append(video);
        await video.play().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1500));
        const t0 = video.currentTime;
        await new Promise((r) => setTimeout(r, 1200));
        result.videoWidth = video.videoWidth;
        result.videoHeight = video.videoHeight;
        result.videoAdvanced = video.currentTime > t0;
      }
      if (peer.audio) {
        // Chrome only starts remote WebRTC audio when it is also attached to a media element.
        const sink = document.createElement("audio");
        sink.muted = true;
        sink.srcObject = new MediaStream([peer.audio]);
        document.body.append(sink);
        await sink.play().catch(() => undefined);
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(new MediaStream([peer.audio])).connect(analyser);
        await new Promise((r) => setTimeout(r, 800));
        const buffer = new Float32Array(analyser.fftSize);
        let peak = 0;
        for (let i = 0; i < 15; i++) {
          analyser.getFloatTimeDomainData(buffer);
          for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
          await new Promise((r) => setTimeout(r, 100));
        }
        result.audioPeak = peak;
        await context.close();
      }
      out.push(result);
    }
    return out;
  });

const pages: Partial<Record<keyof typeof tokens, Page>> = {};

beforeAll(async () => {
  if (!env.MEDIA_TOKEN_SECRET || !env.MEDIA_INTERNAL_SECRET) throw new Error("MEDIA_TOKEN_SECRET / MEDIA_INTERNAL_SECRET must be set in backend/.env");
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await connectToRedis();
  await cleanup();

  for (const url of [API, MEDIA_URL]) {
    if (await fetch(url).then(() => true).catch(() => false)) throw new Error(`${url} is already in use; stop the old test server`);
  }
  const log = Bun.file(`${tmpdir()}/safesphere-media-e2e.log`);
  processes.push(
    Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: `${import.meta.dir}/..`,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        NOTIFY_DRY_RUN: "true",
        DISABLE_SQS_WORKERS: "true",
        MEDIA_SERVER_PUBLIC_URL: MEDIA_URL,
        MEDIA_SERVER_INTERNAL_URL: MEDIA_URL,
      },
      stdout: log,
      stderr: log,
    }),
    Bun.spawn(["node", "src/index.ts"], {
      cwd: `${import.meta.dir}/../../media-server`,
      env: {
        ...process.env,
        MEDIA_PORT: String(MEDIA_PORT),
        API_INTERNAL_URL: API,
        RTC_PORT: "40020",
        // A real interface address, as phones and browsers use. (Chrome gathers no loopback
        // candidates, so announcing 127.0.0.1 would silently push media onto the TCP fallback.)
        RTC_ANNOUNCED_ADDRESS: lanAddress(),
        MEDIA_TOKEN_SECRET: env.MEDIA_TOKEN_SECRET!,
        MEDIA_INTERNAL_SECRET: env.MEDIA_INTERNAL_SECRET!,
      },
      stdout: log,
      stderr: log,
    }),
  );
  await waitForHttp(API, "API");
  await waitForHttp(`${MEDIA_URL}/health`, "media server");

  // The production client, bundled for the browser.
  const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/../../web/src/lib/mediaCall.ts`], target: "browser", format: "esm", minify: false });
  if (!bundle.success) throw new Error(bundle.logs.join("\n"));
  const clientJs = (await bundle.outputs[0]!.text()).replace(/export\s*\{[^}]*\};?\s*$/m, "");
  const html = `<!doctype html><html><body><script type="module">
// Keep every peer connection so the test can read which transport (UDP/TCP) carried media.
const NativePC = window.RTCPeerConnection;
window.__pcs = [];
window.RTCPeerConnection = class extends NativePC { constructor(...args) { super(...args); window.__pcs.push(this); } };
window.mediaProtocols = async () => {
  const protocols = [];
  for (const pc of window.__pcs) {
    if (pc.connectionState !== "connected") continue;
    const stats = await pc.getStats();
    stats.forEach((entry) => {
      if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded") {
        protocols.push(stats.get(entry.localCandidateId)?.protocol);
      }
    });
  }
  return protocols;
};
${clientJs}
window.startCall = async () => {
  const call = new MediaCall({ getCredentials: () => window.getCreds() });
  window.__call = call;
  call.subscribe((snapshot) => { window.__snap = snapshot; });
  await call.start({ video: true });
};
</script></body></html>`;
  pageServer = Bun.serve({ port: PAGE_PORT, fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  // Fixtures: reporter, a nearby hospital authority, a control-center agent.
  const reporter = await PublicUserModel.create({ phoneNumber: PHONE, role: "public", isVerified: true, name: "Media Caller" });
  await ProfilePublicUserModel.create({ userId: reporter._id, name: "Media Caller", phoneNumber: PHONE, contacts: [], medicalRecord: { bloodGroup: "A+" } });
  const authority = await AdminUserModel.create({ email: "authority@media.safesphere.test", passwordHash: "x", name: "Dr. Media", role: "authority", publicKey: "k", isverified: true, isprofileComplete: true });
  const profile = await AuthorityProfileModel.create({ userId: authority._id, organizationName: "Media Test Hospital", authorityType: "hospital", contactNumber: "+916000002900", officialEmail: "office@media.safesphere.test", address: "Test", location: SPOT, verificationStatus: "verified", isActive: true });
  const cc = await AdminUserModel.create({ email: "cc@media.safesphere.test", passwordHash: "x", name: "Agent Media", role: "controller-center", isverified: true, isprofileComplete: true });
  ids.reporter = String(reporter._id);
  ids.authority = String(authority._id);
  ids.authorityProfile = String(profile._id);
  ids.cc = String(cc._id);
  const responder = await AdminUserModel.create({ email: "responder@media.safesphere.test", passwordHash: "x", name: "Paramedic Media", role: "responder", isverified: true, isprofileComplete: true, authorityProfileId: profile._id });
  ids.responder = String(responder._id);
  const base = { phoneNumber: "", isVerified: true, avatarUrl: "", isprofileComplete: true };
  tokens.reporter = signToken({ ...base, userId: ids.reporter, phoneNumber: PHONE, role: "public", name: "Media Caller" });
  tokens.authority = signToken({ ...base, userId: ids.authority, email: "authority@media.safesphere.test", role: "authority", name: "Dr. Media" });
  tokens.cc = signToken({ ...base, userId: ids.cc, email: "cc@media.safesphere.test", role: "controller-center", name: "Agent Media" });
  tokens.responder = signToken({ ...base, userId: ids.responder, email: "responder@media.safesphere.test", role: "responder", name: "Paramedic Media" });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  pageServer?.stop(true);
  for (const child of processes) {
    child.kill("SIGTERM");
    const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
    if (!exited) child.kill("SIGKILL");
  }
  await cleanup();
  await mongoose.disconnect();
}, 30_000);

describe("multi-party emergency call over the SafeSphere SFU", () => {
  test("the media server refuses connections without a valid media token", async () => {
    const forged = connectSocket(MEDIA_URL, { auth: { token: "not-a-token" }, transports: ["websocket"], reconnection: false });
    const refused = await new Promise<boolean>((resolve) => {
      forged.on("connect", () => resolve(false));
      forged.on("connect_error", () => resolve(true));
    });
    forged.disconnect();
    expect(refused).toBe(true);
  });

  test("SOS → caller connects; control center answers; authority is invited and joins; everyone sees and hears everyone", async () => {
    const created = await call("POST", "/api/public-user/emergency/initiate", tokens.reporter, {
      title: "Media test emergency",
      type: "medical",
      severity: "critical",
      isForSelf: true,
      location: SPOT,
      clientRequestId: "media-e2e-000001",
    });
    expect(created.status).toBe(201);
    callId = created.body.call.callId;

    const callerToken = await call("POST", `/api/public-user/calls/${callId}/token`, tokens.reporter);
    pages.reporter = await openParticipant("reporter", callerToken.body.media);

    const answered = await call("POST", `/api/admin-user/calls/${callId}/answer`, tokens.cc);
    expect(answered.status).toBe(200);
    pages.cc = await openParticipant("cc", answered.body.media);

    // The call becomes "active" only once the control center's media actually joined.
    let status = "";
    for (let i = 0; i < 20 && status !== "active"; i++) {
      status = (await call("GET", `/api/admin-user/calls/${callId}`, tokens.cc)).body.call.status;
      if (status !== "active") await Bun.sleep(250);
    }
    expect(status).toBe("active");

    expect((await call("POST", `/api/admin-user/calls/${callId}/invite`, tokens.cc, { userId: ids.authority })).status).toBe(201);
    const accepted = await call("POST", `/api/admin-user/calls/${callId}/respond`, tokens.authority, { accept: true });
    expect(accepted.status).toBe(200);
    pages.authority = await openParticipant("authority", accepted.body.media);

    // The authority brings in its own field responder: same call, same room.
    expect((await call("POST", `/api/admin-user/calls/${callId}/invite`, tokens.authority, { userId: ids.responder })).status).toBe(201);
    const responderAccepted = await call("POST", `/api/admin-user/calls/${callId}/respond`, tokens.responder, { accept: true });
    expect(responderAccepted.status).toBe(200);
    pages.responder = await openParticipant("responder", responderAccepted.body.media);

    for (const who of ["reporter", "cc", "authority", "responder"] as const) {
      await pages[who]!.waitForFunction(
        () => (window as any).__snap.peers.length === 3 && (window as any).__snap.peers.every((p: any) => p.audio && p.video),
        { timeout: 20000, polling: 250 },
      );
      const received = await measure(pages[who]!);
      console.log(`[media] ${who} receives:`, JSON.stringify(received));
      expect(received.length).toBe(3);
      for (const remote of received) {
        expect(remote.videoWidth).toBeGreaterThan(0);
        expect(remote.videoAdvanced).toBe(true);
        expect(remote.audioPeak).toBeGreaterThan(0.01);
      }
    }

    // Media must flow over UDP (TCP is only the fallback for networks that block UDP).
    for (const who of ["reporter", "cc", "authority", "responder"] as const) {
      const protocols = await pages[who]!.evaluate(() => (window as any).mediaProtocols());
      console.log(`[media] ${who} transport protocols:`, protocols.join(", "));
      expect(protocols.length).toBe(2); // send + receive transport
      expect(protocols.every((protocol: string) => protocol === "udp")).toBe(true);
    }

    const view = (await call("GET", `/api/admin-user/calls/${callId}`, tokens.cc)).body.call;
    expect(view.participants.filter((p: any) => p.connection === "connected").length).toBe(4);
  }, 120_000);

  test("mute and camera-off reach the other participants", async () => {
    await pages.cc!.evaluate(() => (window as any).__call.setMicEnabled(false));
    await pages.cc!.evaluate(() => (window as any).__call.setCameraEnabled(false));
    await pages.reporter!.waitForFunction(
      () => {
        const agent = (window as any).__snap.peers.find((p: any) => p.role === "controller-center");
        return agent?.audioPaused && agent?.videoPaused;
      },
      { timeout: 8000, polling: 250 },
    );
    await pages.cc!.evaluate(() => (window as any).__call.setMicEnabled(true));
    await pages.reporter!.waitForFunction(
      () => (window as any).__snap.peers.find((p: any) => p.role === "controller-center")?.audioPaused === false,
      { timeout: 8000, polling: 250 },
    );
  }, 30_000);

  test("a participant who leaves disappears for the others; the call and the case stay open", async () => {
    await pages.authority!.evaluate(() => (window as any).__call.leave());
    await pages.reporter!.waitForFunction(() => (window as any).__snap.peers.length === 2, { timeout: 8000, polling: 250 });
    let connection = "";
    for (let i = 0; i < 20 && connection !== "left"; i++) {
      const view = (await call("GET", `/api/admin-user/calls/${callId}`, tokens.cc)).body.call;
      connection = view.participants.find((p: any) => p.role === "authority")?.connection;
      if (connection !== "left") await Bun.sleep(250);
    }
    expect(connection).toBe("left");
    const emergency = (await call("GET", `/api/public-user/calls/${callId}`, tokens.reporter)).body.call;
    expect(emergency.status).toBe("active");
  }, 30_000);

  test("a browser refresh rejoins the same call without creating another session", async () => {
    await pages.reporter!.reload();
    await pages.reporter!.evaluate(() => (window as any).startCall());
    try {
      await pages.reporter!.waitForFunction(() => (window as any).__snap?.connection === "connected" && (window as any).__snap.peers.length === 2, { timeout: 20000, polling: 250 });
    } catch (error) {
      console.log("[media] reporter after refresh:", await pages.reporter!.evaluate(() => JSON.stringify({ c: (window as any).__snap?.connection, e: (window as any).__snap?.error, peers: (window as any).__snap?.peers?.map((p: any) => p.name) })));
      throw error;
    }
    expect(await EmergencyCallModel.countDocuments({ _id: callId, isOpen: true })).toBe(1);
    const emergencyId = (await EmergencyCallModel.findById(callId).lean())!.emergencyId;
    expect(await EmergencyCallModel.countDocuments({ emergencyId })).toBe(1);
  }, 40_000);

  test("ending the call for everyone disconnects all media but leaves the emergency open", async () => {
    const ended = await call("POST", `/api/admin-user/calls/${callId}/end`, tokens.cc);
    expect(ended.body.call.status).toBe("ended");
    await pages.reporter!.waitForFunction(() => (window as any).__snap.connection === "ended", { timeout: 8000, polling: 250 });
    await pages.cc!.waitForFunction(() => (window as any).__snap.connection === "ended", { timeout: 8000, polling: 250 });
    const emergencyId = String((await EmergencyCallModel.findById(callId).lean())!.emergencyId);
    expect((await EmergencyModel.findById(emergencyId).lean())!.status).not.toBe("closed");
    const health = await fetch(`${MEDIA_URL}/health`).then((r) => r.json());
    expect((health as { rooms: number }).rooms).toBe(0);
  }, 30_000);
});
