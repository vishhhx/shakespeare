// End-to-end tests for the emergency workflow against a real server process, real MongoDB,
// Redis and Socket.IO. Notifications run in dry-run mode (NOTIFY_DRY_RUN=true): no SMS or email
// leaves the machine, and each would-be delivery is read back from Redis. SQS workers are off.
//
// Run: bun test tests/emergency.e2e.test.ts   (needs the docker stack: Mongo + Redis)
//
// All fixtures sit around a point in the South Pacific so no real user can be "nearby", use
// phone numbers +91600000 1xxx and emails @safesphere.test, and are deleted in afterAll.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import mongoose from "mongoose";
import { io as connectSocket, type Socket } from "socket.io-client";
import { env } from "../src/config/env";
import { connectToRedis } from "../src/connections/redis";
import redisService from "../src/utils/redis";
import { NOTIFY_DRY_RUN_KEY } from "../src/utils/notifyDryRun";
import { signToken } from "../src/utils/jwt";
import EmergencyModel from "../src/models/emergency/emergency.model";
import { PublicUserModel } from "../src/models/AuthpublicUser/publicUser.model";
import { ProfilePublicUserModel } from "../src/models/ProfilePublicUser/profile.model";
import { AdminUserModel } from "../src/models/AuthadminUser/adminUser.model";
import { AuthorityProfileModel } from "../src/models/ProfileAdminUser/authority.model";

const PORT = 4107;
const BASE = `http://localhost:${PORT}`;
const INCIDENT = { lat: -45.0, lng: -130.0 };
const NEAR = { lat: -45.01, lng: -130.01 }; // ~1.4 km away
const FAR = { lat: -46.0, lng: -130.0 }; // ~111 km away
const PHONE = (n: number) => `+91600000${1000 + n}`;
const EXTERNAL_CONTACT_PHONE = PHONE(99); // emergency contact without the app

let server: ReturnType<typeof Bun.spawn> | null = null;
const sockets: Socket[] = [];
const people: Record<string, { id: string; token: string; profileId?: string }> = {};

const adminToken = (user: { _id: unknown; email: string; role: string; name: string }) =>
  signToken({
    userId: String(user._id),
    email: user.email,
    role: user.role,
    name: user.name,
    phoneNumber: "",
    isVerified: true,
    avatarUrl: "",
    isprofileComplete: true,
  });

const appToken = (user: { _id: unknown; phoneNumber: string; role: string }) =>
  signToken({
    userId: String(user._id),
    phoneNumber: user.phoneNumber,
    role: user.role,
    name: "",
    isVerified: true,
    avatarUrl: "",
    isprofileComplete: true,
  });

type Reply = { status: number; body: any };
const call = async (method: string, path: string, token?: string, body?: unknown): Promise<Reply> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const pub = (path: string) => `/api/public-user${path}`;
const adm = (path: string) => `/api/admin-user${path}`;

const openSocket = async (token: string) => {
  const socket = connectSocket(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  // Give the server a moment to store the socket id and join rooms.
  await Bun.sleep(150);
  return socket;
};

/** Collects every payload of `event` on a socket so tests can assert on arrivals (or their absence). */
const record = (socket: Socket, event: string) => {
  const received: any[] = [];
  socket.on(event, (payload: any) => received.push(payload));
  return received;
};

const waitFor = async (check: () => boolean, timeoutMs = 4000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) return false;
    await Bun.sleep(50);
  }
  return true;
};

const dryRunDeliveries = async () =>
  (await redisService.redis.lRange(NOTIFY_DRY_RUN_KEY, 0, -1)).map((entry) => JSON.parse(entry));

const createAppUser = async (key: string, n: number, role: "public" | "volunteer", at?: { lat: number; lng: number }) => {
  const user = await PublicUserModel.create({ phoneNumber: PHONE(n), role, isVerified: true, name: `Test ${key}` });
  if (at) await redisService.addLocation("public-users", String(user._id), at.lng, at.lat);
  people[key] = { id: String(user._id), token: appToken(user) };
  return user;
};

const createAuthority = async (key: string, at: { lat: number; lng: number }) => {
  const admin = await AdminUserModel.create({
    email: `${key.toLowerCase()}@safesphere.test`,
    passwordHash: "x",
    name: `Authority ${key}`,
    role: "authority",
    publicKey: "test",
    isverified: true,
    isprofileComplete: true,
  });
  const profile = await AuthorityProfileModel.create({
    userId: admin._id,
    organizationName: `${key} Hospital`,
    authorityType: "hospital",
    contactNumber: "+916000001900",
    officialEmail: `${key.toLowerCase()}-office@safesphere.test`,
    address: "Test address",
    location: at,
    verificationStatus: "verified",
    isActive: true,
  });
  await redisService.addLocation("authorities", String(profile._id), at.lng, at.lat);
  people[key] = { id: String(admin._id), token: adminToken(admin as any), profileId: String(profile._id) };
};

const sos = (token: string, extra: Record<string, unknown> = {}) =>
  call("POST", pub("/emergency/initiate"), token, {
    title: "Test emergency",
    type: "medical",
    severity: "high",
    isForSelf: true,
    location: INCIDENT,
    ...extra,
  });

const cleanup = async () => {
  const phones = Array.from({ length: 100 }, (_, n) => PHONE(n));
  const users = await PublicUserModel.find({ phoneNumber: { $in: phones } }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const admins = await AdminUserModel.find({ email: /@safesphere\.test$/ }).select("_id").lean();
  const adminIds = admins.map((a) => a._id);
  const profiles = await AuthorityProfileModel.find({ userId: { $in: adminIds } }).select("_id").lean();
  await EmergencyModel.deleteMany({ reportedBy: { $in: userIds } });
  await ProfilePublicUserModel.deleteMany({ userId: { $in: userIds } });
  await PublicUserModel.deleteMany({ _id: { $in: userIds } });
  await AuthorityProfileModel.deleteMany({ userId: { $in: adminIds } });
  await AdminUserModel.deleteMany({ _id: { $in: adminIds } });
  for (const id of userIds) await redisService.redis.zRem("public-users", String(id));
  for (const p of profiles) await redisService.redis.zRem("authorities", String(p._id));
  await redisService.redis.del(NOTIFY_DRY_RUN_KEY);
};

beforeAll(async () => {
  const failAfter = (ms: number, what: string) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} not reachable; is the docker stack up?`)), ms));
  await Promise.race([mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 }), failAfter(6000, "MongoDB")]);
  await Promise.race([connectToRedis(), failAfter(5000, "Redis")]);
  await cleanup();

  // A server left over from an earlier run would answer instead of this code; refuse to run.
  if (await fetch(BASE).then(() => true).catch(() => false)) {
    throw new Error(`Port ${PORT} is already in use; stop the old test server first`);
  }
  const logFile = Bun.file(`${tmpdir()}/safesphere-e2e-server.log`);
  server = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: String(PORT), NOTIFY_DRY_RUN: "true", DISABLE_SQS_WORKERS: "true" },
    stdout: logFile,
    stderr: logFile,
  });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    ready = await fetch(BASE).then((r) => r.ok).catch(() => false);
    if (!ready) await Bun.sleep(250);
  }
  if (!ready) throw new Error(`Test server did not start on port ${PORT}; see ${logFile.name}`);

  // Fixtures
  const reporter = await createAppUser("R", 1, "public", INCIDENT);
  await createAppUser("V", 2, "volunteer", NEAR);
  await createAppUser("P2", 3, "public", FAR);
  const contact = await createAppUser("C", 4, "public"); // app-user contact, offline, not nearby
  await createAppUser("P3", 5, "public", NEAR);
  await createAppUser("R2", 6, "public", INCIDENT);
  await ProfilePublicUserModel.create({
    userId: reporter._id,
    name: "Test Reporter",
    phoneNumber: reporter.phoneNumber,
    contacts: [
      { name: "Mum", phoneNumber: EXTERNAL_CONTACT_PHONE, relation: "mother", isPrimary: true },
      { name: "Brother", phoneNumber: contact.phoneNumber, relation: "brother" },
    ],
    medicalRecord: { bloodGroup: "O+", allergies: ["penicillin"] },
    sosMessage: "I need help, call me",
    autoShareMedical: false,
  });
  await createAuthority("A", NEAR);
  await createAuthority("A2", FAR);
  const cc = await AdminUserModel.create({
    email: "cc@safesphere.test",
    passwordHash: "x",
    name: "Test Control Center",
    role: "controller-center",
    isverified: true,
    isprofileComplete: true,
  });
  people.CC = { id: String(cc._id), token: adminToken(cc as any) };
  const rs2 = await AdminUserModel.create({
    email: "rs2@safesphere.test",
    passwordHash: "x",
    name: "Responder of A2",
    role: "responder",
    isverified: true,
    isprofileComplete: true,
    authorityProfileId: new mongoose.Types.ObjectId(people.A2!.profileId),
  });
  people.RS2 = { id: String(rs2._id), token: adminToken(rs2 as any) };
}, 60_000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  server?.kill("SIGTERM");
  const exited = await Promise.race([server?.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
  if (!exited) server?.kill("SIGKILL");
  await cleanup();
  await mongoose.disconnect();
});

describe("admin account provisioning", () => {
  const body = (extra: Record<string, unknown>) => ({
    email: "rs@safesphere.test",
    password: "correct-horse-1",
    name: "Field Responder",
    role: "responder",
    ...extra,
  });

  test("unauthenticated registration is refused, whatever role is requested", async () => {
    for (const role of ["controller-center", "authority", "responder"]) {
      const r = await call("POST", adm("/register"), undefined, body({ role, publicKey: "k" }));
      expect(r.status).toBe(401);
    }
  });

  test("app users and authorities cannot create admin accounts", async () => {
    expect((await call("POST", adm("/register"), people.R!.token, body({}))).status).toBe(403);
    expect((await call("POST", adm("/register"), people.A!.token, body({ role: "controller-center" }))).status).toBe(403);
  });

  test("control center cannot mint another control center (seed script only)", async () => {
    const r = await call("POST", adm("/register"), people.CC!.token, body({ role: "controller-center", email: "cc2@safesphere.test" }));
    expect(r.status).toBe(403);
    expect(await AdminUserModel.countDocuments({ email: "cc2@safesphere.test" })).toBe(0);
  });

  test("responders must belong to an existing authority", async () => {
    expect((await call("POST", adm("/register"), people.CC!.token, body({}))).status).toBe(400);
    const bogus = new mongoose.Types.ObjectId().toString();
    expect((await call("POST", adm("/register"), people.CC!.token, body({ authorityProfileId: bogus }))).status).toBe(400);
  });

  test("only the control center can list authorities for linking responders", async () => {
    expect((await call("GET", adm("/authorities"), people.A!.token)).status).toBe(403);
    const r = await call("GET", adm("/authorities"), people.CC!.token);
    expect(r.status).toBe(200);
    expect(r.body.authorities.map((a: any) => a.authorityProfileId)).toContain(people.A!.profileId);
  });

  test("control center creates a responder linked to authority A", async () => {
    const r = await call("POST", adm("/register"), people.CC!.token, body({ authorityProfileId: people.A!.profileId }));
    expect(r.status).toBe(201);
    const created = await AdminUserModel.findOne({ email: "rs@safesphere.test" }).lean();
    expect(String(created?.authorityProfileId)).toBe(people.A!.profileId!);
    expect(String(created?.createdBy)).toBe(people.CC!.id);
    // Verification email went to dry-run, not SNS.
    const deliveries = await dryRunDeliveries();
    expect(deliveries.some((d) => d.channel === "email" && d.to === "rs@safesphere.test")).toBe(true);
    // Mark verified so the responder can act in later tests.
    await AdminUserModel.updateOne({ _id: created!._id }, { isverified: true });
    people.RS = { id: String(created!._id), token: adminToken(created as any) };
  });
});

describe("socket hardening", () => {
  test("live locations are no longer broadcast to everyone", async () => {
    const sender = await openSocket(people.P3!.token);
    const listener = await openSocket(people.P2!.token);
    const leaked = record(listener, "delivery_partner_location");
    sender.emit("location_update", { lat: 1, lng: 2 });
    await Bun.sleep(500);
    expect(leaked.length).toBe(0);
    sender.disconnect();
    listener.disconnect();
  });

  test("a public user cannot join an authority's room", async () => {
    const intruder = await openSocket(people.P2!.token);
    const errors = record(intruder, "error");
    intruder.emit("join-authority", { authorityId: people.A!.profileId });
    expect(await waitFor(() => errors.length > 0)).toBe(true);
    intruder.disconnect();
  });
});

describe("SOS lifecycle", () => {
  let emergencyId = "";
  let reporterSocket: Socket;
  let volunteerSocket: Socket;
  let authoritySocket: Socket;
  let responderSocket: Socket;
  let intruderSocket: Socket;
  let reporterUpdates: any[];
  let reporterClosed: any[];
  let volunteerAlerts: any[];
  let authorityAlerts: any[];
  let intruderAlerts: any[];
  let responderAssigned: any[];

  beforeAll(async () => {
    reporterSocket = await openSocket(people.R!.token);
    volunteerSocket = await openSocket(people.V!.token);
    authoritySocket = await openSocket(people.A!.token);
    responderSocket = await openSocket(people.RS!.token);
    intruderSocket = await openSocket(people.P2!.token);
    intruderSocket.emit("join-authority", { authorityId: people.A!.profileId });
    reporterUpdates = record(reporterSocket, "emergency-case-updated");
    reporterClosed = record(reporterSocket, "emergency-case-closed");
    volunteerAlerts = record(volunteerSocket, "emergency-nearby-alert");
    authorityAlerts = record(authoritySocket, "emergency-authority-alert");
    intruderAlerts = [
      ...record(intruderSocket, "emergency-authority-alert"),
      ...record(intruderSocket, "emergency-nearby-alert"),
    ];
    responderAssigned = record(responderSocket, "emergency-assigned");
    await redisService.redis.del(NOTIFY_DRY_RUN_KEY);
  });

  test("SOS without a location is rejected", async () => {
    const r = await call("POST", pub("/emergency/initiate"), people.R!.token, { title: "No GPS", isForSelf: true });
    expect(r.status).toBe(400);
  });

  test("SOS is created and the reporter's map exposes no nearby people", async () => {
    const r = await sos(people.R!.token, { clientRequestId: "req-test-000001" });
    expect(r.status).toBe(201);
    emergencyId = r.body.emergencyId;
    const snapshot = r.body.dispatch.mapSnapshot;
    expect(snapshot.nearbyUsers).toEqual([]);
    expect(snapshot.nearbyVolunteers).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(PHONE(2));
    expect(snapshot.nearbyAuthorities.length).toBe(1);
  });

  test("a retried request returns the same case", async () => {
    const r = await sos(people.R!.token, { clientRequestId: "req-test-000001" });
    expect(r.status).toBe(200);
    expect(r.body.replayed).toBe(true);
    expect(r.body.emergencyId).toBe(emergencyId);
  });

  test("a second SOS while one is open returns 409 with the open case", async () => {
    const r = await sos(people.R!.token, { clientRequestId: "req-test-000002" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ACTIVE_CASE_EXISTS");
    expect(r.body.emergencyId).toBe(emergencyId);
  });

  test("nearby volunteer and nearby authority are alerted; outsiders are not", async () => {
    expect(await waitFor(() => volunteerAlerts.length > 0 && authorityAlerts.length > 0)).toBe(true);
    expect(volunteerAlerts[0].emergencyId).toBe(emergencyId);
    expect(authorityAlerts[0].authorityProfileId).toBe(people.A!.profileId);
    await Bun.sleep(300);
    expect(intruderAlerts.length).toBe(0);
  });

  test("SMS: every emergency contact is texted; online users get no SMS; far users get nothing", async () => {
    const sms = (await dryRunDeliveries()).filter((d) => d.channel === "sms");
    const to = sms.map((d) => d.to);
    expect(to).toContain(EXTERNAL_CONTACT_PHONE); // contact without the app
    expect(to).toContain(PHONE(4)); // app-user contact who is offline
    expect(to).not.toContain(PHONE(2)); // volunteer is online -> socket only
    expect(to).not.toContain(PHONE(3)); // far away
    const toMum = sms.find((d) => d.to === EXTERNAL_CONTACT_PHONE);
    expect(toMum.body).toContain("I need help, call me");
    expect(toMum.body).toContain("maps.google.com/?q=-45,-130");
    expect(new Set(to).size).toBe(to.length); // nobody texted twice
  });

  test("the reporter can resume the open case from the server", async () => {
    const r = await call("GET", pub("/emergency/active"), people.R!.token);
    expect(r.status).toBe(200);
    expect(r.body.asReporter.emergencyId).toBe(emergencyId);
  });

  test("visibility follows the role and distance rules", async () => {
    expect((await call("GET", pub(`/emergency/${emergencyId}`), people.P2!.token)).status).toBe(403);
    const preview = await call("GET", pub(`/emergency/${emergencyId}?lat=${NEAR.lat}&lng=${NEAR.lng}`), people.V!.token);
    expect(preview.status).toBe(200);
    expect(preview.body.emergency.preview).toBe(true);
    expect(preview.body.emergency.reporter).toBeUndefined();
    expect(preview.body.permissions.canAccept).toBe(true);
    expect((await call("GET", adm(`/emergency/${emergencyId}`), people.A2!.token)).status).toBe(403);
    const full = await call("GET", adm(`/emergency/${emergencyId}`), people.A!.token);
    expect(full.status).toBe(200);
    expect(full.body.emergency.reporter.name).toBe("Test Reporter");
    expect(full.body.emergency.subject.medicalRecord.bloodGroup).toBe("O+");
  });

  test("the reporter's emergency contact can open the case without being nearby", async () => {
    const r = await call("GET", pub(`/emergency/${emergencyId}`), people.C!.token);
    expect(r.status).toBe(200);
    expect(r.body.emergency.preview).toBe(false);
    expect(r.body.emergency.viewer.isReporterContact).toBe(true);
  });

  test("the reporter cannot accept their own case", async () => {
    const r = await call("POST", pub("/emergency/respond"), people.R!.token, { emergencyId, location: INCIDENT });
    expect(r.status).toBe(403);
  });

  test("a far-away user cannot accept", async () => {
    const r = await call("POST", pub("/emergency/respond"), people.P2!.token, { emergencyId, location: FAR });
    expect(r.status).toBe(403);
  });

  test("volunteer accepts; status moves to in_progress and the reporter is told", async () => {
    const r = await call("POST", pub("/emergency/respond"), people.V!.token, { emergencyId, location: NEAR });
    expect(r.status).toBe(200);
    expect(r.body.responderRole).toBe("volunteer");
    const doc = await EmergencyModel.findById(emergencyId).lean();
    expect(doc?.status).toBe("in_progress");
    expect(await waitFor(() => reporterUpdates.some((u) => u.reason === "responder-joined"))).toBe(true);
  });

  test("volunteer (not opted in) does not see the reporter's medical notes", async () => {
    const r = await call("GET", pub(`/emergency/${emergencyId}`), people.V!.token);
    expect(r.status).toBe(200);
    expect(r.body.emergency.responders.find((x: any) => x.isMe).actorRole).toBe("volunteer");
    expect(r.body.emergency.subject.medicalRecord).toBeUndefined();
    expect(r.body.emergency.reporter.phoneNumber).toBe(PHONE(1));
  });

  test("responder status and live location updates; stale updates are ignored", async () => {
    expect((await call("PATCH", pub(`/emergency/${emergencyId}/responder-status`), people.V!.token, { status: "enroute" })).status).toBe(200);
    expect((await call("PATCH", pub(`/emergency/${emergencyId}/responder-status`), people.P2!.token, { status: "enroute" })).status).toBe(403);
    const now = new Date();
    const fresh = await call("POST", pub(`/emergency/${emergencyId}/location`), people.V!.token, { ...NEAR, recordedAt: now.toISOString() });
    expect(fresh.status).toBe(200);
    const older = await call("POST", pub(`/emergency/${emergencyId}/location`), people.V!.token, {
      lat: 0,
      lng: 0,
      recordedAt: new Date(now.getTime() - 5000).toISOString(),
    });
    expect(older.body.stale).toBe(true);
    const doc = await EmergencyModel.findById(emergencyId).lean();
    const entry = doc!.responders.find((x: any) => String(x.userId) === people.V!.id)!;
    expect(entry.status).toBe("enroute");
    expect(entry.location?.coordinates).toEqual([NEAR.lng, NEAR.lat]);
    expect((await call("POST", pub(`/emergency/${emergencyId}/location`), people.P2!.token, NEAR)).status).toBe(403);
  });

  test("only people on the case (or admins) can flag it as fake", async () => {
    expect((await call("POST", pub(`/emergency/${emergencyId}/flag-fake`), people.P2!.token, {})).status).toBe(403);
    expect((await call("POST", pub(`/emergency/${emergencyId}/flag-fake`), people.R!.token, {})).status).toBe(400);
    const r = await call("POST", pub(`/emergency/${emergencyId}/flag-fake`), people.V!.token, { reason: "test" });
    expect(r.status).toBe(200);
    expect(r.body.uniqueFlags).toBe(1);
  });

  test("assignment: authority assigns its own responder; others are refused", async () => {
    const list = await call("GET", adm("/responders"), people.A!.token);
    expect(list.body.responders.map((x: any) => x.userId)).toEqual([people.RS!.id]);
    expect((await call("POST", adm(`/emergency/${emergencyId}/assign`), people.A!.token, { responderUserId: people.RS2!.id })).status).toBe(403);
    expect((await call("POST", adm(`/emergency/${emergencyId}/assign`), people.A2!.token, { responderUserId: people.RS2!.id })).status).toBe(403);
    expect((await call("POST", adm(`/emergency/${emergencyId}/assign`), people.R!.token, { responderUserId: people.RS!.id })).status).toBe(403);
    const ok = await call("POST", adm(`/emergency/${emergencyId}/assign`), people.A!.token, { responderUserId: people.RS!.id });
    expect(ok.status).toBe(200);
    expect(await waitFor(() => responderAssigned.some((x) => x.emergencyId === emergencyId))).toBe(true);
    const directives = await call("GET", adm("/emergency/directives"), people.RS!.token);
    const mine = directives.body.directives.find((x: any) => x.emergencyId === emergencyId);
    expect(mine.assignedToMe).toBe(true);
  });

  test("case details name the responsible organisation and each responder's real role", async () => {
    const r = await call("GET", pub(`/emergency/${emergencyId}`), people.R!.token);
    const roles = r.body.emergency.responders.map((x: any) => x.actorRole).sort();
    expect(roles).toEqual(["responder", "volunteer"]);
    expect(r.body.emergency.responsibleAuthority.name).toBe("A Hospital");
    expect(r.body.emergency.responders.find((x: any) => x.actorRole === "responder").organization.name).toBe("A Hospital");
  });

  test("a public helper who joined can leave", async () => {
    expect((await call("POST", pub("/emergency/respond"), people.P3!.token, { emergencyId, location: NEAR })).status).toBe(200);
    const r = await call("PATCH", pub(`/emergency/${emergencyId}/leave`), people.P3!.token, {});
    expect(r.status).toBe(200);
  });

  test("status transitions follow the state machine", async () => {
    // Already in progress, so it can no longer be "verified".
    expect((await call("PATCH", adm(`/emergency/${emergencyId}/status`), people.A!.token, { action: "verify" })).status).toBe(409);
    expect((await call("PATCH", adm(`/emergency/${emergencyId}/status`), people.A2!.token, { action: "resolve" })).status).toBe(403);
    const r = await call("PATCH", adm(`/emergency/${emergencyId}/status`), people.RS!.token, { action: "resolve" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("resolved");
  });

  test("closing: out-of-area authority refused; local authority closes; reporter notified; accept afterwards refused", async () => {
    expect((await call("PATCH", adm(`/emergency/${emergencyId}/close`), people.A2!.token, {})).status).toBe(403);
    const r = await call("PATCH", adm(`/emergency/${emergencyId}/close`), people.A!.token, { reason: "Handled" });
    expect(r.status).toBe(200);
    expect(await waitFor(() => reporterClosed.some((x) => x.emergencyId === emergencyId))).toBe(true);
    expect((await call("POST", pub("/emergency/respond"), people.P3!.token, { emergencyId, location: NEAR })).status).toBe(409);
    const active = await call("GET", pub("/emergency/active"), people.R!.token);
    expect(active.body.asReporter).toBeNull();
  });

  test("points can be awarded by the local authority after closing", async () => {
    const r = await call("POST", adm(`/emergency/${emergencyId}/reward-participant`), people.A!.token, {
      participantUserId: people.V!.id,
      points: 50,
    });
    expect(r.status).toBe(200);
    expect(r.body.totalPoints).toBeGreaterThanOrEqual(50);
  });

  test("concurrent SOS taps create exactly one case", async () => {
    const results = await Promise.all([sos(people.R!.token), sos(people.R!.token), sos(people.R!.token)]);
    const created = results.filter((r) => r.status === 201);
    expect(created.length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(2);
    expect(await EmergencyModel.countDocuments({ reportedBy: people.R!.id, status: { $in: ["reported", "verified", "in_progress"] } })).toBe(1);
    await call("PATCH", adm(`/emergency/${created[0]!.body.emergencyId}/close`), people.CC!.token, {});
  });
});

describe("fake-report policy (unchanged threshold and block)", () => {
  test("three distinct flaggers on the case close it and block the reporter", async () => {
    const created = await sos(people.R2!.token);
    expect(created.status).toBe(201);
    const id = created.body.emergencyId;
    await call("POST", pub("/emergency/respond"), people.V!.token, { emergencyId: id, location: NEAR });
    await call("POST", pub("/emergency/respond"), people.P3!.token, { emergencyId: id, location: NEAR });
    expect((await call("POST", pub(`/emergency/${id}/flag-fake`), people.V!.token, {})).status).toBe(200);
    expect((await call("POST", pub(`/emergency/${id}/flag-fake`), people.P3!.token, {})).status).toBe(200);
    const third = await call("POST", adm(`/emergency/${id}/flag-fake`), people.A!.token, {});
    expect(third.status).toBe(200);
    expect(third.body.reporterBlocked).toBe(true);
    const doc = await EmergencyModel.findById(id).lean();
    expect(doc?.status).toBe("closed");
    expect((await sos(people.R2!.token)).status).toBe(403);
  });
});

describe("voice and face-identification access control", () => {
  test("voice analysis keys are scoped to the caller", async () => {
    const othersKey = `voice/emergency/${people.V!.id}/123.m4a`;
    expect((await call("POST", pub("/emergency/voice/enqueue"), people.R!.token, { fileKey: othersKey })).status).toBe(403);
    expect((await call("GET", pub(`/emergency/voice/analysis?fileKey=${encodeURIComponent(othersKey)}`), people.R!.token)).status).toBe(403);
    const own = await call("GET", pub(`/emergency/voice/analysis?fileKey=${encodeURIComponent(`voice/emergency/${people.R!.id}/123.m4a`)}`), people.R!.token);
    expect(own.status).toBe(200);
    expect(own.body.status).toBe("pending");
  });

  test("stranger photo keys cannot name another user", async () => {
    const asVictim = `emergency/stranger/${people.R!.id}/${people.V!.id}.jpg`;
    expect((await call("POST", pub("/emergency/process-stranger"), people.R!.token, { fileKey: asVictim })).status).toBe(400);
    const othersFolder = `emergency/stranger/${people.V!.id}/1730000000000.jpg`;
    expect((await call("POST", pub("/emergency/process-stranger"), people.R!.token, { fileKey: othersFolder })).status).toBe(400);
    const notUploaded = await call("POST", pub("/emergency/process-stranger"), people.R!.token, {
      fileKey: `emergency/stranger/${people.R!.id}/1730000000000.jpg`,
    });
    expect(notUploaded.status).toBe(400);
    expect(notUploaded.body.error).toMatch(/not been uploaded/);
  });

  test("an unconfirmed identity cannot be attached to a new case", async () => {
    await EmergencyModel.updateMany({ reportedBy: people.R!.id }, { status: "closed" });
    const r = await sos(people.R!.token, { isForSelf: false, identifiedUserId: people.V!.id, relationToVictim: "bystander" });
    expect(r.status).toBe(400);
  });
});
