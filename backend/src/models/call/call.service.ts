import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";

import { env } from "../../config/env";
import { getGlobalIO } from "../../utils/socketManager";
import EmergencyModel from "../emergency/emergency.model";
import { responderSocketRooms } from "../emergency/emergency.permissions";
import { PublicUserModel } from "../AuthpublicUser/publicUser.model";
import { ProfilePublicUserModel } from "../ProfilePublicUser/profile.model";
import { AdminUserModel } from "../AuthadminUser/adminUser.model";
import { AuthorityProfileModel } from "../ProfileAdminUser/authority.model";
import { EmergencyCallModel, type CallParticipant, type CallRole, type EmergencyCall } from "./call.model";

/** An unanswered invitation lapses after this long. */
export const INVITE_TTL_MS = 2 * 60 * 1000;
/** Media tokens only open a connection; they are useless for anything else after this. */
export const MEDIA_TOKEN_TTL_SECONDS = 120;
/** A call nobody is connected to is ended after this grace period (covers refreshes / blips). */
export const EMPTY_CALL_GRACE_MS = 60 * 1000;

export const isMediaConfigured = () => Boolean(env.MEDIA_TOKEN_SECRET && env.MEDIA_SERVER_PUBLIC_URL);

const APP_ROLES: CallRole[] = ["public", "volunteer"];

/** Socket rooms of one user: app users can be "public" or "volunteer" depending on promotion. */
export const userRooms = (participant: { userId: unknown; role: CallRole }) =>
  APP_ROLES.includes(participant.role)
    ? [`public:${String(participant.userId)}`, `volunteer:${String(participant.userId)}`]
    : [`${participant.role}:${String(participant.userId)}`];

export const findOpenCall = (emergencyId: string) =>
  EmergencyCallModel.findOne({ emergencyId: new Types.ObjectId(emergencyId), isOpen: true });

/** Name (and organisation for staff) used in call UIs. */
export const describeUser = async (userId: string, role: CallRole): Promise<{ name: string; organization?: string }> => {
  if (APP_ROLES.includes(role)) {
    const [user, profile] = await Promise.all([
      PublicUserModel.findById(userId).select("name").lean(),
      ProfilePublicUserModel.findOne({ userId }).select("name").lean(),
    ]);
    return { name: profile?.name || user?.name || "SafeSphere user" };
  }
  const admin = await AdminUserModel.findById(userId).select("name role authorityProfileId").lean();
  if (role === "controller-center") return { name: admin?.name || "Control center", organization: "SafeSphere Control Center" };
  const profile =
    role === "authority"
      ? await AuthorityProfileModel.findOne({ userId }).select("organizationName").lean()
      : admin?.authorityProfileId
        ? await AuthorityProfileModel.findById(admin.authorityProfileId).select("organizationName").lean()
        : null;
  return { name: admin?.name || "Responder", organization: profile?.organizationName };
};

/** Invitations past their TTL become "expired" (applied lazily wherever a call is read). */
export const expireStaleInvites = (call: EmergencyCall) => {
  let changed = false;
  const now = Date.now();
  for (const participant of call.participants) {
    if (participant.inviteStatus === "invited" && participant.invitedAt && now - participant.invitedAt.getTime() > INVITE_TTL_MS) {
      participant.inviteStatus = "expired";
      participant.respondedAt = new Date();
      changed = true;
    }
  }
  return changed;
};

/** Everything a call UI needs. Contains names and roles only; no medical data. */
export const toCallView = async (call: EmergencyCall, viewerId?: string) => {
  const emergency = await EmergencyModel.findById(call.emergencyId)
    .select("title type severity status location reportedBy relationToVictim createdAt")
    .lean();
  const reporter = emergency ? await describeUser(String(emergency.reportedBy), "public") : null;
  const me = viewerId ? call.participants.find((participant) => String(participant.userId) === viewerId) : undefined;
  return {
    callId: String(call._id),
    emergencyId: String(call.emergencyId),
    roomId: call.roomId,
    status: call.status,
    version: new Date(call.updatedAt ?? Date.now()).getTime(),
    createdAt: call.createdAt,
    answeredBy: call.answeredBy ? { userId: String(call.answeredBy.userId), name: call.answeredBy.name, at: call.answeredBy.at } : null,
    declinedBy: (call.declinedBy ?? []).map((entry) => ({ userId: String(entry.userId), name: entry.name, at: entry.at })),
    endedAt: call.endedAt ?? null,
    endReason: call.endReason ?? null,
    emergency: emergency
      ? {
          title: emergency.title,
          type: emergency.type,
          severity: emergency.severity,
          status: emergency.status,
          createdAt: emergency.createdAt,
          reporterName: reporter?.name ?? "SafeSphere user",
          location:
            emergency.location?.coordinates?.length === 2
              ? { lat: emergency.location.coordinates[1], lng: emergency.location.coordinates[0], address: emergency.location.address }
              : null,
        }
      : null,
    participants: call.participants.map((participant) => ({
      userId: String(participant.userId),
      role: participant.role,
      name: participant.name,
      organization: participant.organization ?? null,
      inviteStatus: participant.inviteStatus,
      invitedByRole: participant.invitedByRole ?? null,
      invitedAt: participant.invitedAt ?? null,
      connection: participant.connection,
      joinedAt: participant.joinedAt ?? null,
      leftAt: participant.leftAt ?? null,
      isMe: viewerId === String(participant.userId),
    })),
    me: me ? { role: me.role, inviteStatus: me.inviteStatus, connection: me.connection } : null,
  };
};

/**
 * Notify everyone who has a stake in the call. Clients refetch the call (single source of truth)
 * and use `version` to drop notifications older than what they show.
 */
export const emitCallEvent = (call: EmergencyCall, event: string, extra: Record<string, unknown> = {}) => {
  const io = getGlobalIO();
  if (!io) return;
  const rooms = new Set<string>(["controller-center"]);
  for (const participant of call.participants) {
    for (const room of userRooms(participant)) rooms.add(room);
  }
  io.to([...rooms]).emit(event, {
    callId: String(call._id),
    emergencyId: String(call.emergencyId),
    status: call.status,
    version: new Date(call.updatedAt ?? Date.now()).getTime(),
    ...extra,
  });
};

/** Ask the media server to drop a room (call ended) or one peer (access revoked). Best effort. */
export const tellMediaServer = async (path: string, body: Record<string, unknown>) => {
  if (!env.MEDIA_SERVER_INTERNAL_URL || !env.MEDIA_INTERNAL_SECRET) return;
  try {
    await fetch(`${env.MEDIA_SERVER_INTERNAL_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-media-secret": env.MEDIA_INTERNAL_SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.warn("[call] media server unreachable:", error instanceof Error ? error.message : error);
  }
};

/**
 * The call for an emergency, created if none is open. Safe under retries and concurrent SOS
 * requests: the partial unique index turns a racing second insert into a lookup.
 */
export const ensureCallForEmergency = async (
  emergencyId: string,
  initiator: { userId: string; role: CallRole },
): Promise<{ call: EmergencyCall; created: boolean }> => {
  const existing = await findOpenCall(emergencyId);
  if (existing) return { call: existing, created: false };

  const emergency = await EmergencyModel.findById(emergencyId).select("reportedBy").lean();
  if (!emergency) throw new Error("Emergency not found");
  const reporterId = String(emergency.reportedBy);
  const reporter = await describeUser(reporterId, "public");
  const reporterUser = await PublicUserModel.findById(reporterId).select("role").lean();

  const participants: CallParticipant[] = [
    {
      userId: new Types.ObjectId(reporterId),
      role: reporterUser?.role === "volunteer" ? "volunteer" : "public",
      name: reporter.name,
      inviteStatus: "caller",
      connection: "not_joined",
    },
  ];
  // A control-center call-back: the caller is still the reporter; the agent is already in.
  if (initiator.role === "controller-center") {
    const agent = await describeUser(initiator.userId, "controller-center");
    participants.push({
      userId: new Types.ObjectId(initiator.userId),
      role: "controller-center",
      name: agent.name,
      organization: agent.organization,
      inviteStatus: "accepted",
      respondedAt: new Date(),
      connection: "not_joined",
    });
  }

  try {
    const call = await EmergencyCallModel.create({
      emergencyId: new Types.ObjectId(emergencyId),
      roomId: `call-${randomBytes(12).toString("hex")}`,
      status: "ringing",
      isOpen: true,
      initiatedBy: { userId: new Types.ObjectId(initiator.userId), role: initiator.role },
      answeredBy:
        initiator.role === "controller-center"
          ? { userId: new Types.ObjectId(initiator.userId), name: participants[1]!.name, at: new Date() }
          : undefined,
      declinedBy: [],
      participants,
    });
    emitCallEvent(call, "call:incoming");
    return { call, created: true };
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await findOpenCall(emergencyId);
      if (raced) return { call: raced, created: false };
    }
    throw error;
  }
};

export const endCall = async (
  call: EmergencyCall,
  reason: NonNullable<EmergencyCall["endReason"]>,
  by?: { userId?: string; role?: CallRole },
) => {
  if (call.status === "ended" || call.status === "failed") return call;
  call.status = reason === "media_failure" ? "failed" : "ended";
  call.isOpen = undefined;
  call.endedAt = new Date();
  call.endReason = reason;
  call.endedBy = by?.userId ? { userId: new Types.ObjectId(by.userId), role: by.role } : undefined;
  for (const participant of call.participants) {
    if (participant.inviteStatus === "invited") {
      participant.inviteStatus = "cancelled";
      participant.respondedAt = new Date();
    }
    if (participant.connection !== "not_joined") {
      participant.connection = "left";
      participant.leftAt = participant.leftAt ?? new Date();
    }
  }
  await call.save();
  emitCallEvent(call, "call:ended", { reason });
  await tellMediaServer("/internal/rooms/close", { roomId: call.roomId, reason });
  return call;
};

/** Closing an emergency ends its call; the reverse never happens. */
export const endOpenCallsForEmergency = async (emergencyId: string) => {
  const call = await findOpenCall(emergencyId);
  if (call) await endCall(call, "case_closed");
};

/** Short-lived credential for one media-server connection. Never stored. */
export const issueMediaToken = (call: EmergencyCall, participant: CallParticipant) =>
  jwt.sign(
    {
      kind: "media",
      callId: String(call._id),
      roomId: call.roomId,
      userId: String(participant.userId),
      role: participant.role,
      name: participant.name,
      organization: participant.organization,
    },
    env.MEDIA_TOKEN_SECRET!,
    { expiresIn: MEDIA_TOKEN_TTL_SECONDS, audience: "safesphere-media", issuer: "safesphere-api" },
  );

/** Adds an accepted staff/volunteer participant to the case itself, so they can see case details. */
export const joinCaseAsResponder = async (
  emergencyId: string,
  participant: { userId: string; role: CallRole },
  invitedBy?: { userId: string; role: CallRole },
) => {
  if (participant.role === "controller-center") return;
  const emergency = await EmergencyModel.findById(emergencyId);
  if (!emergency || !["reported", "verified", "in_progress"].includes(emergency.status)) return;
  if (String(emergency.reportedBy) === participant.userId) return;
  if (emergency.responders.some((responder) => String(responder.userId) === participant.userId)) return;

  emergency.responders.push({
    userId: new Types.ObjectId(participant.userId),
    role: participant.role === "authority" || participant.role === "responder" ? "authority" : "volunteer",
    actorRole: participant.role,
    status: "assigned",
    assignedBy: invitedBy ? new Types.ObjectId(invitedBy.userId) : undefined,
    assignedByRole: invitedBy && (invitedBy.role === "authority" || invitedBy.role === "controller-center") ? invitedBy.role : undefined,
    joinedAt: new Date(),
  } as any);
  if (emergency.status === "reported" || emergency.status === "verified") emergency.status = "in_progress";
  emergency.timeline.push({
    event: "Joined the response through the emergency call",
    timestamp: new Date(),
    actorId: new Types.ObjectId(participant.userId),
    meta: { role: participant.role, invitedByRole: invitedBy?.role },
  });
  await emergency.save();

  const io = getGlobalIO();
  if (io) {
    const rooms = [
      `public:${String(emergency.reportedBy)}`,
      `volunteer:${String(emergency.reportedBy)}`,
      ...emergency.responders.flatMap(responderSocketRooms),
      "controller-center",
    ];
    io.to([...new Set(rooms)]).emit("emergency-case-updated", {
      emergencyId,
      status: emergency.status,
      reason: "responder-joined",
      version: new Date(emergency.updatedAt ?? Date.now()).getTime(),
      userId: participant.userId,
    });
  }
};

/** Verifies a token presented by the media server back to us (used by tests and tooling). */
export const verifyMediaToken = (token: string) =>
  jwt.verify(token, env.MEDIA_TOKEN_SECRET!, { audience: "safesphere-media", issuer: "safesphere-api" });
