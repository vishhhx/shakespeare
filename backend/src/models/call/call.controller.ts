import type { Request, Response } from "express";
import { Types } from "mongoose";

import { env } from "../../config/env";
import redisService from "../../utils/redis";
import { getGlobalIO } from "../../utils/socketManager";
import EmergencyModel from "../emergency/emergency.model";
import { responderActorRole } from "../emergency/emergency.permissions";
import { AdminUserModel } from "../AuthadminUser/adminUser.model";
import { AuthorityProfileModel } from "../ProfileAdminUser/authority.model";
import { EmergencyCallModel, type CallRole, type EmergencyCall } from "./call.model";
import {
  EMPTY_CALL_GRACE_MS,
  INVITE_TTL_MS,
  MEDIA_TOKEN_TTL_SECONDS,
  describeUser,
  emitCallEvent,
  endCall,
  ensureCallForEmergency,
  expireStaleInvites,
  findOpenCall,
  isMediaConfigured,
  issueMediaToken,
  joinCaseAsResponder,
  tellMediaServer,
  toCallView,
} from "./call.service";

type Actor = { userId: string; role: CallRole };

const actorOf = (req: Request): Actor | null =>
  req.authUser?.userId && Types.ObjectId.isValid(req.authUser.userId)
    ? { userId: String(req.authUser.userId), role: req.authUser.role as CallRole }
    : null;

const isOpen = (call: EmergencyCall) => call.status === "ringing" || call.status === "active";

/** Fixed-window limiter in Redis; returns false once `limit` is exceeded within the window. */
const allow = async (key: string, limit: number, windowSeconds: number) => {
  try {
    const count = await redisService.redis.incr(`rate:${key}`);
    if (count === 1) await redisService.redis.expire(`rate:${key}`, windowSeconds);
    return count <= limit;
  } catch {
    return true; // never block an emergency call because Redis hiccupped
  }
};

/** Loads a call the actor may see: the control center, or anyone listed on it (invitees included). */
const loadCallFor = async (req: Request, res: Response): Promise<{ call: EmergencyCall; actor: Actor } | null> => {
  const actor = actorOf(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const callId = String(req.params.callId || "");
  if (!Types.ObjectId.isValid(callId)) {
    res.status(400).json({ error: "Invalid call id" });
    return null;
  }
  const call = await EmergencyCallModel.findById(callId);
  const listed = call?.participants.some((participant) => String(participant.userId) === actor.userId);
  if (!call || (actor.role !== "controller-center" && !listed)) {
    res.status(404).json({ error: "Call not found" });
    return null;
  }
  if (expireStaleInvites(call)) await call.save();
  return { call, actor };
};

const mediaPayload = (call: EmergencyCall, participant: EmergencyCall["participants"][number]) => ({
  token: issueMediaToken(call, participant),
  expiresIn: MEDIA_TOKEN_TTL_SECONDS,
  mediaUrl: env.MEDIA_SERVER_PUBLIC_URL,
  roomId: call.roomId,
});

const notConfigured = (res: Response) =>
  res.status(503).json({ error: "Video calling is not available right now. Use the phone numbers on the case instead.", code: "MEDIA_NOT_CONFIGURED" });

// ── Reads ─────────────────────────────────────────────────────────────────────────────

/** Control center: calls waiting for an answer and calls in progress (also used after a refresh). */
export const listIncomingCalls = async (req: Request, res: Response) => {
  const actor = actorOf(req);
  if (!actor || actor.role !== "controller-center") return res.status(403).json({ error: "Control center only" });
  const calls = await EmergencyCallModel.find({ isOpen: true }).sort({ createdAt: -1 }).limit(50);
  return res.json({ calls: await Promise.all(calls.map((call) => toCallView(call, actor.userId))) });
};

/** Open calls I'm listed on, including invitations waiting for my answer (recovery after reconnect). */
export const listMyCalls = async (req: Request, res: Response) => {
  const actor = actorOf(req);
  if (!actor) return res.status(401).json({ error: "Authentication required" });
  const calls = await EmergencyCallModel.find({ isOpen: true, "participants.userId": new Types.ObjectId(actor.userId) })
    .sort({ updatedAt: -1 })
    .limit(10);
  for (const call of calls) if (expireStaleInvites(call)) await call.save();
  return res.json({ calls: await Promise.all(calls.map((call) => toCallView(call, actor.userId))) });
};

export const getCall = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  return res.json({ call: await toCallView(loaded.call, loaded.actor.userId) });
};

/** The open call of a case, for screens that show the case. */
export const getCallForEmergency = async (req: Request, res: Response) => {
  const actor = actorOf(req);
  if (!actor) return res.status(401).json({ error: "Authentication required" });
  const emergencyId = String(req.params.emergencyId || "");
  if (!Types.ObjectId.isValid(emergencyId)) return res.status(400).json({ error: "Invalid emergency id" });
  const call = await findOpenCall(emergencyId);
  if (!call) return res.json({ call: null });
  const listed = call.participants.some((participant) => String(participant.userId) === actor.userId);
  if (actor.role !== "controller-center" && !listed) return res.json({ call: null });
  if (expireStaleInvites(call)) await call.save();
  return res.json({ call: await toCallView(call, actor.userId) });
};

// ── Starting and answering ─────────────────────────────────────────────────────────────

/** Reporter (re)calls the control center for their open case, or the control center calls back. */
export const startCall = async (req: Request, res: Response) => {
  const actor = actorOf(req);
  if (!actor) return res.status(401).json({ error: "Authentication required" });
  if (!isMediaConfigured()) return notConfigured(res);
  const emergencyId = String(req.body?.emergencyId || "");
  if (!Types.ObjectId.isValid(emergencyId)) return res.status(400).json({ error: "Valid emergencyId is required" });

  const emergency = await EmergencyModel.findById(emergencyId).select("reportedBy status").lean();
  if (!emergency) return res.status(404).json({ error: "Emergency not found" });
  if (!["reported", "verified", "in_progress"].includes(emergency.status)) {
    return res.status(409).json({ error: `This emergency is already ${emergency.status}.` });
  }
  const isReporter = String(emergency.reportedBy) === actor.userId;
  if (!isReporter && actor.role !== "controller-center") {
    return res.status(403).json({ error: "Only the reporter or the control center can start this call" });
  }
  if (!(await allow(`call-start:${actor.userId}`, 10, 60))) return res.status(429).json({ error: "Too many call attempts. Wait a moment." });

  const { call, created } = await ensureCallForEmergency(emergencyId, actor);
  return res.status(created ? 201 : 200).json({ call: await toCallView(call, actor.userId), created });
};

/** Control center answers: becomes a participant and gets a media token. */
export const answerCall = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  if (actor.role !== "controller-center") return res.status(403).json({ error: "Only the control center answers emergency calls" });
  if (!isOpen(call)) return res.status(409).json({ error: "This call has ended", status: call.status });
  if (!isMediaConfigured()) return notConfigured(res);

  let participant = call.participants.find((entry) => String(entry.userId) === actor.userId);
  if (!participant) {
    const agent = await describeUser(actor.userId, "controller-center");
    call.participants.push({
      userId: new Types.ObjectId(actor.userId),
      role: "controller-center",
      name: agent.name,
      organization: agent.organization,
      inviteStatus: "accepted",
      respondedAt: new Date(),
      connection: "not_joined",
    });
    participant = call.participants[call.participants.length - 1]!;
  } else if (participant.inviteStatus !== "accepted") {
    participant.inviteStatus = "accepted";
    participant.respondedAt = new Date();
  }
  if (!call.answeredBy?.userId) {
    call.answeredBy = { userId: new Types.ObjectId(actor.userId), name: participant.name, at: new Date() };
  }
  await call.save();
  emitCallEvent(call, "call:answered", { answeredBy: participant.name });
  return res.json({ call: await toCallView(call, actor.userId), media: mediaPayload(call, participant) });
};

/** Control center passes on a ringing call (another agent may still answer it). */
export const declineIncomingCall = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  if (actor.role !== "controller-center") return res.status(403).json({ error: "Control center only" });
  if (call.status !== "ringing") return res.status(409).json({ error: "This call is no longer ringing", status: call.status });
  if (!call.declinedBy.some((entry) => String(entry.userId) === actor.userId)) {
    const agent = await describeUser(actor.userId, "controller-center");
    call.declinedBy.push({ userId: new Types.ObjectId(actor.userId), name: agent.name, at: new Date() });
    await call.save();
    emitCallEvent(call, "call:updated", { reason: "declined-by-agent" });
  }
  return res.json({ call: await toCallView(call, actor.userId) });
};

// ── Invitations ─────────────────────────────────────────────────────────────────────────

type Candidate = { userId: string; role: CallRole; name: string; organization?: string; detail?: string };

/** Who this actor may invite into this call, under the existing case permission model. */
const invitableFor = async (call: EmergencyCall, actor: Actor): Promise<Candidate[] | null> => {
  const me = call.participants.find((participant) => String(participant.userId) === actor.userId);
  const isController = actor.role === "controller-center";
  const isAuthorityInCall = actor.role === "authority" && me?.inviteStatus === "accepted";
  if (!isController && !isAuthorityInCall) return null;

  const candidates: Candidate[] = [];
  if (isController) {
    const profiles = await AuthorityProfileModel.find({ isActive: true })
      .select("userId organizationName authorityType address")
      .lean();
    const verified = await AdminUserModel.find({ _id: { $in: profiles.map((p) => p.userId) }, role: "authority", isverified: true })
      .select("_id name")
      .lean();
    const nameById = new Map(verified.map((admin) => [String(admin._id), admin.name]));
    for (const profile of profiles) {
      if (!nameById.has(String(profile.userId))) continue;
      candidates.push({
        userId: String(profile.userId),
        role: "authority",
        name: profile.organizationName,
        organization: profile.organizationName,
        detail: `${profile.authorityType}${profile.address ? ` · ${profile.address}` : ""}`,
      });
    }
  }

  let responderFilter: Record<string, unknown> = { role: "responder", isverified: true };
  if (isAuthorityInCall) {
    const profile = await AuthorityProfileModel.findOne({ userId: actor.userId }).select("_id").lean();
    responderFilter = profile ? { ...responderFilter, authorityProfileId: profile._id } : { _id: null };
  }
  const responders = await AdminUserModel.find(responderFilter).select("_id name authorityProfileId").lean();
  const orgs = await AuthorityProfileModel.find({ _id: { $in: responders.map((r: any) => r.authorityProfileId).filter(Boolean) } })
    .select("_id organizationName")
    .lean();
  const orgById = new Map(orgs.map((org) => [String(org._id), org.organizationName]));
  for (const responder of responders as any[]) {
    const organization = responder.authorityProfileId ? orgById.get(String(responder.authorityProfileId)) : undefined;
    candidates.push({ userId: String(responder._id), role: "responder", name: responder.name, organization, detail: organization ? `Field responder · ${organization}` : "Field responder" });
  }

  // Volunteers and community helpers are eligible when they already accepted this emergency.
  const emergency = await EmergencyModel.findById(call.emergencyId).select("responders").lean();
  for (const responder of emergency?.responders ?? []) {
    const role = responderActorRole(responder);
    if (role !== "volunteer" && role !== "public") continue;
    const person = await describeUser(String(responder.userId), role);
    candidates.push({ userId: String(responder.userId), role, name: person.name, detail: `${role === "volunteer" ? "Volunteer" : "Community helper"} on this case` });
  }

  const listed = new Map(call.participants.map((participant) => [String(participant.userId), participant.inviteStatus]));
  return candidates.filter((candidate) => {
    const status = listed.get(candidate.userId);
    return !status || ["declined", "expired", "cancelled"].includes(status);
  });
};

export const listInvitable = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const candidates = await invitableFor(loaded.call, loaded.actor);
  if (!candidates) return res.status(403).json({ error: "You can't invite people to this call" });
  return res.json({ candidates });
};

export const inviteToCall = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  if (!isOpen(call)) return res.status(409).json({ error: "This call has ended", status: call.status });

  const targetId = String(req.body?.userId || "");
  if (!Types.ObjectId.isValid(targetId)) return res.status(400).json({ error: "Valid userId is required" });
  if (!(await allow(`call-invite:${actor.userId}`, 30, 60))) return res.status(429).json({ error: "Too many invitations. Wait a moment." });

  const existing = call.participants.find((participant) => String(participant.userId) === targetId);
  if (existing && ["caller", "accepted", "invited"].includes(existing.inviteStatus)) {
    return res.json({ call: await toCallView(call, actor.userId), alreadyInvited: true }); // idempotent
  }

  // The server decides eligibility; the client's candidate list is only a convenience.
  const candidates = await invitableFor(call, actor);
  if (!candidates) return res.status(403).json({ error: "You can't invite people to this call" });
  const target = candidates.find((candidate) => candidate.userId === targetId);
  if (!target) return res.status(403).json({ error: "That person isn't eligible for this call" });

  const inviter = call.participants.find((participant) => String(participant.userId) === actor.userId);
  const invitation = {
    userId: new Types.ObjectId(target.userId),
    role: target.role,
    // Authorities are listed by organisation; the participant entry shows the person's name.
    name: target.role === "authority" ? (await describeUser(target.userId, "authority")).name : target.name,
    organization: target.organization,
    inviteStatus: "invited" as const,
    invitedBy: new Types.ObjectId(actor.userId),
    invitedByRole: actor.role,
    invitedAt: new Date(),
    respondedAt: undefined,
    connection: "not_joined" as const,
  };
  if (existing) Object.assign(existing, invitation);
  else call.participants.push(invitation);
  await call.save();

  const view = await toCallView(call, actor.userId);
  emitCallEvent(call, "call:updated", { reason: "invited", userId: target.userId });
  // The invitee's own notification: who is asking, for which emergency, until when.
  const io = getGlobalIO();
  io?.to(target.role === "public" || target.role === "volunteer" ? [`public:${target.userId}`, `volunteer:${target.userId}`] : [`${target.role}:${target.userId}`]).emit(
    "call:invitation",
    {
      callId: String(call._id),
      emergencyId: String(call.emergencyId),
      invitedBy: inviter?.name ?? "Control center",
      invitedByRole: actor.role,
      emergency: view.emergency,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      version: view.version,
    },
  );
  return res.status(201).json({ call: view });
};

/** Invitee accepts (gets a media token and joins the case) or declines. */
export const respondToInvitation = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  const participant = call.participants.find((entry) => String(entry.userId) === actor.userId);
  if (!participant) return res.status(404).json({ error: "Call not found" });
  if (!isOpen(call)) return res.status(409).json({ error: "This call has ended", status: call.status });
  if (participant.inviteStatus === "expired") return res.status(410).json({ error: "This invitation has expired" });
  if (participant.inviteStatus !== "invited" && participant.inviteStatus !== "accepted") {
    return res.status(409).json({ error: `This invitation was ${participant.inviteStatus}` });
  }

  const accept = req.body?.accept === true;
  if (accept && !isMediaConfigured()) return notConfigured(res);
  if (participant.inviteStatus === "invited") {
    participant.inviteStatus = accept ? "accepted" : "declined";
    participant.respondedAt = new Date();
    await call.save();
    emitCallEvent(call, "call:updated", { reason: accept ? "invite-accepted" : "invite-declined", userId: actor.userId });
    if (accept) {
      await joinCaseAsResponder(
        String(call.emergencyId),
        { userId: actor.userId, role: participant.role },
        participant.invitedBy ? { userId: String(participant.invitedBy), role: participant.invitedByRole ?? "controller-center" } : undefined,
      );
    }
  }
  return res.json({
    call: await toCallView(call, actor.userId),
    media: participant.inviteStatus === "accepted" ? mediaPayload(call, participant) : undefined,
  });
};

// ── Media access, leaving, ending ─────────────────────────────────────────────────────────

/** A fresh media token for someone already allowed in (first join, rejoin, browser refresh). */
export const getMediaToken = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  if (!isOpen(call)) return res.status(409).json({ error: "This call has ended", status: call.status });
  if (!isMediaConfigured()) return notConfigured(res);
  const participant = call.participants.find((entry) => String(entry.userId) === actor.userId);
  if (!participant || !["caller", "accepted"].includes(participant.inviteStatus)) {
    return res.status(403).json({ error: actor.role === "controller-center" ? "Answer the call first" : "You haven't joined this call" });
  }
  if (!(await allow(`call-token:${actor.userId}`, 30, 60))) return res.status(429).json({ error: "Too many reconnect attempts. Wait a moment." });
  return res.json({ media: mediaPayload(call, participant) });
};

export const leaveCall = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  const participant = call.participants.find((entry) => String(entry.userId) === actor.userId);
  if (participant && participant.connection !== "not_joined") {
    participant.connection = "left";
    participant.leftAt = new Date();
    await call.save();
    emitCallEvent(call, "call:updated", { reason: "participant-left", userId: actor.userId });
  }
  await tellMediaServer("/internal/peers/kick", { roomId: call.roomId, userId: actor.userId, reason: "left" });
  scheduleEmptyCheck(String(call._id));
  return res.json({ call: await toCallView(call, actor.userId) });
};

/** End for everyone: a control-center agent in the call, or the caller cancelling before an answer. */
export const endCallForEveryone = async (req: Request, res: Response) => {
  const loaded = await loadCallFor(req, res);
  if (!loaded) return;
  const { call, actor } = loaded;
  if (!isOpen(call)) return res.json({ call: await toCallView(call, actor.userId) });
  const participant = call.participants.find((entry) => String(entry.userId) === actor.userId);
  const isHost = actor.role === "controller-center" && participant?.inviteStatus === "accepted";
  const isCallerCancelling = participant?.inviteStatus === "caller" && call.status === "ringing";
  if (!isHost && !isCallerCancelling) {
    return res.status(403).json({ error: "Only the control center can end the call for everyone. You can leave it." });
  }
  await endCall(call, isHost ? "ended_by_host" : "caller_cancelled", actor);
  return res.json({ call: await toCallView(call, actor.userId) });
};

// ── Media server → API ─────────────────────────────────────────────────────────────────────

const emptyChecks = new Map<string, ReturnType<typeof setTimeout>>();

/** End an answered call nobody is connected to anymore, after a grace period for refreshes. */
const scheduleEmptyCheck = (callId: string) => {
  if (emptyChecks.has(callId)) return;
  emptyChecks.set(
    callId,
    setTimeout(async () => {
      emptyChecks.delete(callId);
      const call = await EmergencyCallModel.findById(callId);
      if (!call || call.status !== "active") return;
      if (!call.participants.some((participant) => participant.connection === "connected" || participant.connection === "reconnecting")) {
        await endCall(call, "everyone_left");
      }
    }, EMPTY_CALL_GRACE_MS),
  );
};

/** Join / leave reports from the media server (authenticated with MEDIA_INTERNAL_SECRET). */
export const handleMediaEvent = async (req: Request, res: Response) => {
  if (!env.MEDIA_INTERNAL_SECRET || req.get("x-media-secret") !== env.MEDIA_INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { roomId, userId, peerId, event } = req.body as { roomId?: string; userId?: string; peerId?: string; event?: string };
  if (!roomId || !userId || !["joined", "left", "reconnecting"].includes(String(event))) {
    return res.status(400).json({ error: "roomId, userId and event are required" });
  }
  const call = await EmergencyCallModel.findOne({ roomId });
  const participant = call?.participants.find((entry) => String(entry.userId) === userId);
  if (!call || !participant) return res.status(404).json({ error: "Unknown call or participant" });
  // A leave from an older connection (refresh, second tab) must not mark the new one as gone.
  if (event !== "joined" && participant.mediaPeerId && peerId && participant.mediaPeerId !== peerId) {
    return res.json({ ignored: true });
  }

  if (event === "joined") {
    participant.connection = "connected";
    participant.mediaPeerId = peerId;
    participant.joinedAt = participant.joinedAt ?? new Date();
    participant.leftAt = undefined;
    // "Active" means media is actually flowing with the control center, not merely answered.
    if (call.status === "ringing" && participant.role === "controller-center") call.status = "active";
  } else {
    participant.connection = event === "reconnecting" ? "reconnecting" : "left";
    if (event === "left") participant.leftAt = new Date();
  }
  await call.save();
  emitCallEvent(call, "call:updated", { reason: `participant-${event}`, userId });
  if (event === "left") scheduleEmptyCheck(String(call._id));
  return res.json({ ok: true, status: call.status });
};
