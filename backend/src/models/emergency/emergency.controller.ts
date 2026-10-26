import type { Request, Response } from "express";
import { Types } from "mongoose";
import twilio from "twilio";
import { randomBytes } from "crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import EmergencyModel from "./emergency.model";
import { env } from "../../config/env";
import { getQdrantClient } from "../../connections/qdrant";
import { PublicUserModel } from "../AuthpublicUser/publicUser.model";
import { ProfilePublicUserModel } from "../ProfilePublicUser/profile.model";
import { AuthorityProfileModel } from "../ProfileAdminUser/authority.model";
import { AdminUserModel } from "../AuthadminUser/adminUser.model";
import redisService from "../../utils/redis";
import { getGlobalIO } from "../../utils/socketManager";
import s3Service from "../../utils/s3";
import snsService from "../../utils/sns";
import { canSendEmergencyEmail, sendEmergencyEmail } from "../../utils/mailer";
import {
  ADMIN_CASE_RADIUS_KM,
  type ActorRole,
  type CaseContext,
  type CasePermissions,
  STATUS_TRANSITIONS,
  getCasePermissions,
  haversineDistanceKm,
  isActiveStatus,
  isAdminRole,
  legacyResponderRole,
  responderActorRole,
  responderSocketRooms,
} from "./emergency.permissions";

type EmergencyType = "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
type EmergencySeverity = "low" | "medium" | "high" | "critical";
type RelationToVictim = "self" | "family" | "bystander" | "authority";

const VALID_TYPES: EmergencyType[] = ["medical", "fire", "crime", "accident", "missing_child", "other"];
const VALID_SEVERITIES: EmergencySeverity[] = ["low", "medium", "high", "critical"];
const VALID_RELATIONS: RelationToVictim[] = ["self", "family", "bystander", "authority"];
const USER_GEO_KEY = "public-users";
const AUTHORITY_GEO_KEY = "authorities";
const DEFAULT_QDRANT_COLLECTION = "faces";
const DEFAULT_EMERGENCY_MIN_SIMILARITY = 0.45;
const ACTIVE_EMERGENCY_STATUSES: Array<"reported" | "verified" | "in_progress"> = ["reported", "verified", "in_progress"];
const DEFAULT_CONTROL_CENTER_EMAIL = "controllcenter@gmail.com";
const VOICE_ANALYSIS_REDIS_TTL_SECONDS = 60 * 60;
const FAKE_EMERGENCY_FLAG_THRESHOLD = Math.max(2, Number(process.env.FAKE_EMERGENCY_FLAG_THRESHOLD || 3));
const MAX_REWARD_POINTS_PER_AWARD = 500;

type EmergencyActorRole = "public" | "volunteer" | "authority" | "responder" | "controller-center";

const getVoiceSqsClient = () => {
  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("Missing AWS configuration for voice queue");
  }

  return new SQSClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
};

const getEmergencyMinSimilarity = (): number => {
  const raw = Number(process.env.QDRANT_EMERGENCY_MIN_SIMILARITY ?? DEFAULT_EMERGENCY_MIN_SIMILARITY);
  if (Number.isNaN(raw)) {
    return DEFAULT_EMERGENCY_MIN_SIMILARITY;
  }
  return Math.min(0.99, Math.max(0, raw));
};

const getQdrantCollectionName = (): string => {
  if (env.QDRANT_COLLECTION_NAME && env.QDRANT_COLLECTION_NAME.trim().length > 0) {
    return env.QDRANT_COLLECTION_NAME.trim();
  }
  return DEFAULT_QDRANT_COLLECTION;
};

const extractEmbeddingCandidateFromPoint = (point: any): string | null => {
  const payload = point?.payload ?? {};
  const candidates = [
    payload?.embeddingId,
    payload?.embeddingID,
    payload?.faceEmbeddingId,
    payload?.faceEmbeddingID,
    point?.id,
  ];

  const value = candidates
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item === "number") {
        return String(item);
      }
      if (item && typeof item === "object" && "toString" in item) {
        return String(item);
      }
      return "";
    })
    .find((item) => item.length > 0);

  return value && value.length > 0 ? value : null;
};

const normalizeVector = (vector: any): number[] | null => {
  if (Array.isArray(vector)) {
    return vector as number[];
  }

  if (vector && typeof vector === "object") {
    const firstNamedVector = Object.values(vector).find((entry) => Array.isArray(entry));
    if (Array.isArray(firstNamedVector)) {
      return firstNamedVector as number[];
    }
  }

  return null;
};

const extractVectorFromPythonPayload = (payload: any): number[] | null => {
  const candidates = [
    payload?.vector,
    payload?.embedding,
    payload?.data?.vector,
    payload?.data?.embedding,
    payload?.result?.vector,
    payload?.result?.embedding,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVector(candidate);
    if (normalized && normalized.length > 0) {
      return normalized;
    }
  }

  return null;
};

const findUserByEmbeddingCandidates = async (candidateEmbeddingIds: string[]) => {
  if (candidateEmbeddingIds.length === 0) {
    return null;
  }

  const users = await PublicUserModel.find({
    faceEmbeddingID: { $in: candidateEmbeddingIds },
  })
    .select("_id name phoneNumber age gender avatarUrl faceEmbeddingID")
    .lean();

  if (!users.length) {
    return null;
  }

  const userByEmbedding = new Map(users.map((u) => [String(u.faceEmbeddingID || ""), u]));
  const user = candidateEmbeddingIds
    .map((id) => userByEmbedding.get(id))
    .find((matched) => Boolean(matched));

  if (!user?._id) {
    return null;
  }

  const profile = await ProfilePublicUserModel.findOne({ userId: user._id })
    .select("name profileImage medicalRecord contacts sosMessage")
    .lean();

  return {
    userId: String(user._id),
    name: profile?.name || user.name || "Unknown",
    phoneNumber: user.phoneNumber,
    age: user.age,
    gender: user.gender,
    profileImage: profile?.profileImage || user.avatarUrl || null,
    medicalRecord: profile?.medicalRecord,
    contacts: profile?.contacts ?? [],
    sosMessage: profile?.sosMessage,
    matchedByEmbeddingId: user.faceEmbeddingID,
  };
};

const findUserByPublicUserIds = async (candidateUserIds: string[]) => {
  const validUserIds = uniqueStrings(candidateUserIds).filter((id) => Types.ObjectId.isValid(id));
  if (!validUserIds.length) {
    return null;
  }

  const users = await PublicUserModel.find({ _id: { $in: validUserIds } })
    .select("_id name phoneNumber age gender avatarUrl faceEmbeddingID")
    .lean();

  if (!users.length) {
    return null;
  }

  const userById = new Map(users.map((u) => [String(u._id), u]));
  const user = validUserIds.map((id) => userById.get(id)).find((item) => Boolean(item));
  if (!user?._id) {
    return null;
  }

  const profile = await ProfilePublicUserModel.findOne({ userId: user._id })
    .select("name profileImage medicalRecord contacts sosMessage")
    .lean();

  return {
    userId: String(user._id),
    name: profile?.name || user.name || "Unknown",
    phoneNumber: user.phoneNumber,
    age: user.age,
    gender: user.gender,
    profileImage: profile?.profileImage || user.avatarUrl || null,
    medicalRecord: profile?.medicalRecord,
    contacts: profile?.contacts ?? [],
    sosMessage: profile?.sosMessage,
    matchedByEmbeddingId: user.faceEmbeddingID,
  };
};

const findBestMatchUsingQdrant = async (embeddingId: string, sourceVector?: number[] | null) => {
  const client = getQdrantClient();
  if (!client) {
    return { matchedUser: null, qdrantUsed: false, reason: "Qdrant client not connected. Check QDRANT_URL and startup logs." };
  }

  const collection = getQdrantCollectionName();
  if (!collection) {
    return { matchedUser: null, qdrantUsed: false, reason: "Qdrant collection not found" };
  }

  // 1) Fetch vector by embeddingId from Qdrant collection. If missing, use vector from Python payload.
  let vector: number[] | null = null;
  let pointFetchDetails: string | undefined;
  let sourcePoint: any = null;

  try {
    const points = await client.retrieve(collection, {
      ids: [embeddingId],
      with_vector: true,
      with_payload: true,
    });
    sourcePoint = Array.isArray(points) ? points[0] : null;
    vector = normalizeVector(sourcePoint?.vector);
  } catch (error) {
    pointFetchDetails = error instanceof Error ? error.message : "Unknown point fetch error";
  }

  if ((!vector || vector.length === 0) && sourceVector && sourceVector.length > 0) {
    vector = sourceVector;
  }

  if (!vector || vector.length === 0) {
    return {
      matchedUser: null,
      qdrantUsed: true,
      reason: "Vector not available for similarity search",
      details: pointFetchDetails,
    };
  }

  // 2) Similarity search. Only hits at or above the configured threshold count as a possible match;
  // below it we report "no match" rather than presenting the closest stranger as this person.
  let hits: any[] = [];
  const minSimilarity = getEmergencyMinSimilarity();
  try {
    const searchResult = await client.search(collection, {
      vector,
      limit: 10,
      with_payload: true,
      with_vector: false,
      score_threshold: minSimilarity,
    });
    hits = Array.isArray(searchResult) ? searchResult : [];
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown similarity search error";
    return {
      matchedUser: null,
      qdrantUsed: true,
      reason: "Qdrant similarity search failed",
      details,
    };
  }

  // The photo being identified is itself stored as a point; it always matches itself, so drop it.
  hits = hits.filter((point: any) => {
    const ids = [String(point?.id ?? ""), extractEmbeddingCandidateFromPoint(point) ?? ""];
    return !ids.includes(embeddingId) && typeof point?.score === "number" && point.score >= minSimilarity;
  });
  hits.sort((left: any, right: any) => right.score - left.score);

  // Walk hits best-first and stop at the first that maps to a registered user.
  for (const point of hits) {
    const payloadUserId = String(point?.payload?.publicUserId || point?.payload?.userId || point?.payload?.userID || "");
    const candidateEmbeddingId = extractEmbeddingCandidateFromPoint(point);
    const matchedUser =
      (Types.ObjectId.isValid(payloadUserId) ? await findUserByPublicUserIds([payloadUserId]) : null) ||
      (candidateEmbeddingId ? await findUserByEmbeddingCandidates([candidateEmbeddingId]) : null);
    if (matchedUser) {
      return {
        matchedUser,
        qdrantUsed: true,
        collection,
        minSimilarity,
        matchedScore: point.score as number,
        candidatesAboveThreshold: hits.length,
      };
    }
  }

  return {
    matchedUser: null,
    qdrantUsed: true,
    collection,
    minSimilarity,
    candidatesAboveThreshold: hits.length,
    reason: hits.length ? "No registered user for the closest faces" : "No face above the similarity threshold",
  };
};

const uniqueStrings = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

const emitToRoleUsers = async (
  io: any,
  role: "public" | "volunteer" | "authority" | "controller-center",
  userIds: string[],
  event: string,
  payload: any,
) => {
  const uniqueUserIds = uniqueStrings(userIds);
  for (const userId of uniqueUserIds) {
    io.to(`${role}:${userId}`).emit(event, payload);
  }
};

const toEmergencyDetailsText = (emergency: any, location: { lat: number; lng: number }) => {
  const createdAt = emergency?.createdAt ? new Date(emergency.createdAt).toLocaleString() : new Date().toLocaleString();
  const details = [
    `Emergency ID: ${String(emergency?._id || "")}`,
    `Title: ${emergency?.title || "Emergency Assistance Needed"}`,
    `Type: ${emergency?.type || "other"}`,
    `Severity: ${emergency?.severity || "high"}`,
    `Status: ${emergency?.status || "reported"}`,
    `Location: ${location.lat}, ${location.lng}`,
    `Time: ${createdAt}`,
    `Description: ${emergency?.description || "Not provided"}`,
  ];

  return details.join("\n");
};

const isSocketUserOnline = async (role: "public" | "volunteer" | "authority" | "controller-center", userId: string) => {
  try {
    const socketId = await redisService.getSocketId(role, userId);
    return Boolean(socketId);
  } catch {
    return false;
  }
};

const getControlCenterPrivileges = () => ({
  canEditCase: true,
  canCloseCase: true,
  canBroadcastUpdates: true,
  canViewReporterDetails: true,
});

const closeEmergencyCaseAndBroadcast = async (
  emergency: any,
  closedBy: { userId: string; role: "authority" | "controller-center" },
  reasonText?: string,
) => {
  const emergencyId = String(emergency._id);
  emergency.status = "closed";
  emergency.timeline.push({
    event: "Emergency case closed",
    timestamp: new Date(),
    actorId: new Types.ObjectId(closedBy.userId),
    meta: {
      closedByRole: closedBy.role,
      closedByUserId: closedBy.userId,
      reason: reasonText || "Case completed",
    },
  });

  await emergency.save();

  emitToCase(emergency, "emergency-case-closed", {
    emergencyId,
    status: "closed",
    closedByRole: closedBy.role,
    message:
      reasonText ||
      `Emergency case closed by ${closedBy.role}. Camera/audio streaming has been stopped.`,
  });
  broadcastCaseUpdate(emergency, "closed");
};

type AuthActor = { userId: string; role: ActorRole };

const toActor = (authUser: { userId: string; role: string }): AuthActor => ({
  userId: String(authUser.userId),
  role: authUser.role as ActorRole,
});

const parseClientLocation = (value: any): { lat: number; lng: number } | null => {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
};

const incidentPoint = (emergency: any): { lat: number; lng: number } | null => {
  const lng = emergency?.location?.coordinates?.[0];
  const lat = emergency?.location?.coordinates?.[1];
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
};

/** Last 10 digits, so "+91 98765 43210" and "9876543210" compare equal. */
const phoneKey = (value: unknown) => String(value || "").replace(/\D/g, "").slice(-10);

const primaryVictimOf = (emergency: any) => {
  const victims = Array.isArray(emergency?.victims) ? emergency.victims : [];
  return victims.find((victim: any) => victim?.isPrimary) ?? victims[0] ?? null;
};

/** A reporter can be a public user or a volunteer; their socket sits in one of these rooms. */
const reporterRooms = (emergency: any) => {
  const reporterId = String(emergency.reportedBy);
  return [`public:${reporterId}`, `volunteer:${reporterId}`];
};

const caseRooms = (emergency: any) =>
  uniqueStrings([
    ...reporterRooms(emergency),
    ...(Array.isArray(emergency.responders) ? emergency.responders.flatMap(responderSocketRooms) : []),
    "controller-center",
  ]);

const emitToCase = (emergency: any, event: string, payload: Record<string, unknown>) => {
  const io = getGlobalIO();
  if (!io) return;
  io.to(caseRooms(emergency)).emit(event, payload);
};

/**
 * Tells everyone on the case that it changed. Clients refetch the details; `version`
 * (the case's updatedAt) lets them ignore notifications older than what they already show.
 */
const broadcastCaseUpdate = (emergency: any, reason: string, extra: Record<string, unknown> = {}) => {
  emitToCase(emergency, "emergency-case-updated", {
    emergencyId: String(emergency._id),
    status: emergency.status,
    reason,
    version: new Date(emergency.updatedAt ?? Date.now()).getTime(),
    ...extra,
  });
};

/** Distance, contact relationship and medical-sharing preference that the permission rules need. */
const resolveCaseContext = async (
  emergency: any,
  actor: AuthActor,
  locationHint?: { lat: number; lng: number } | null,
): Promise<CaseContext & { actorLocation: { lat: number; lng: number } | null }> => {
  const actorLocation = locationHint ?? (await resolveActorLocation(actor));
  const incident = incidentPoint(emergency);
  const distanceKm = actorLocation && incident ? haversineDistanceKm(actorLocation, incident) : null;

  let isReporterContact = false;
  if ((actor.role === "public" || actor.role === "volunteer") && String(emergency.reportedBy) !== actor.userId) {
    const [reporterProfile, actorUser] = await Promise.all([
      ProfilePublicUserModel.findOne({ userId: emergency.reportedBy }).select("appContacts contacts").lean(),
      PublicUserModel.findById(actor.userId).select("phoneNumber").lean(),
    ]);
    const appContactIds = (reporterProfile?.appContacts || []).map((id: any) => String(id));
    const contactPhones = (reporterProfile?.contacts || []).map((contact: any) => phoneKey(contact.phoneNumber));
    isReporterContact =
      appContactIds.includes(actor.userId) ||
      (Boolean(actorUser?.phoneNumber) && contactPhones.includes(phoneKey(actorUser?.phoneNumber)));
  }

  let subjectSharesMedical: boolean | undefined;
  const victim = primaryVictimOf(emergency);
  if (victim?.userId) {
    const victimProfile = await ProfilePublicUserModel.findOne({ userId: victim.userId }).select("autoShareMedical").lean();
    subjectSharesMedical = victimProfile ? victimProfile.autoShareMedical !== false : undefined;
  }

  return { distanceKm, isReporterContact, subjectSharesMedical, actorLocation };
};

const permissionsFor = async (
  emergency: any,
  actor: AuthActor,
  locationHint?: { lat: number; lng: number } | null,
): Promise<{ permissions: CasePermissions; context: Awaited<ReturnType<typeof resolveCaseContext>> }> => {
  const context = await resolveCaseContext(emergency, actor, locationHint);
  return { permissions: getCasePermissions(emergency, actor, context), context };
};

const toEmergencyVideoRoomName = (emergencyId: string) => `emergency-${emergencyId}`;

const toTwilioIdentity = (authUser: { userId: string; role: string }) => {
  const normalizedRole = String(authUser.role || "user").replace(/[^a-zA-Z0-9_-]/g, "-");
  const normalizedUserId = String(authUser.userId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
  const sessionSuffix = randomBytes(4).toString("hex");
  const identity = `${normalizedRole}:${normalizedUserId}:${sessionSuffix}`;
  return identity.length > 120 ? identity.slice(0, 120) : identity;
};

const uniqueByUserId = <T extends { userId: string }>(items: T[]) => {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.userId, item);
  }
  return Array.from(map.values());
};

export const getEmergencyVideoToken = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const emergency = await EmergencyModel.findById(emergencyId)
      .select("reportedBy responders status location victims fakeFlags")
      .lean();
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    if (emergency.status === "closed") {
      return res.status(400).json({ error: "Emergency is already closed" });
    }

    const { permissions } = await permissionsFor(emergency, toActor(authUser));
    if (!permissions.canJoinVideo) {
      return res.status(403).json({ error: "Not authorized for emergency video call" });
    }

    const accountSid = env.TWILIO_VIDEO_ACCOUNT_SID;
    const apiKeySid = env.TWILIO_VIDEO_API_KEY_SID;
    const apiKeySecret = env.TWILIO_VIDEO_API_KEY_SECRET;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        error: "Twilio video credentials are missing",
        requiredEnv: ["TWILIO_VIDEO_ACCOUNT_SID", "TWILIO_VIDEO_API_KEY_SID", "TWILIO_VIDEO_API_KEY_SECRET"],
      });
    }

    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
      return res.status(500).json({
        error: "Invalid TWILIO_VIDEO_ACCOUNT_SID format",
        hint: "TWILIO_VIDEO_ACCOUNT_SID must start with AC",
      });
    }

    if (!/^SK[0-9a-fA-F]{32}$/.test(apiKeySid)) {
      return res.status(500).json({
        error: "Invalid TWILIO_VIDEO_API_KEY_SID format",
        hint: "TWILIO_VIDEO_API_KEY_SID must be a Twilio API Key SID starting with SK",
      });
    }

    const roomName = toEmergencyVideoRoomName(emergencyId);
    const identity = toTwilioIdentity({ userId: authUser.userId, role: authUser.role });
    const ttl = Number.isFinite(env.TWILIO_VIDEO_TOKEN_TTL)
      ? Math.max(300, Math.min(86400, Number(env.TWILIO_VIDEO_TOKEN_TTL)))
      : 3600;

    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl,
    });
    token.addGrant(new VideoGrant({ room: roomName }));

    const controllerCenters = await AdminUserModel.find({ role: "controller-center", isverified: true })
      .select("_id")
      .lean();

    const participants = uniqueByUserId([
      { userId: String(emergency.reportedBy), role: "reporter" as const },
      ...(Array.isArray(emergency.responders)
        ? emergency.responders.map((responder: any) => ({
            userId: String(responder.userId),
            role: responderActorRole(responder),
          }))
        : []),
      ...controllerCenters.map((center) => ({
        userId: String(center._id),
        role: "controller-center" as const,
      })),
    ]);

    return res.status(200).json({
      emergencyId,
      roomName,
      identity,
      token: token.toJwt(),
      expiresIn: ttl,
      participants,
    });
  } catch (error) {
    console.error("Error generating Twilio emergency video token:", error);
    return res.status(500).json({ error: "Failed to generate emergency video token" });
  }
};

const resolveActorLocation = async (authUser: { userId: string; role: string }) => {
  if (authUser.role === "public" || authUser.role === "volunteer") {
    const geo = await redisService.getLocationsByMembers(USER_GEO_KEY, [authUser.userId]);
    const current = geo[authUser.userId] as { lat: number; lng: number } | undefined;
    if (typeof current?.lat === "number" && typeof current?.lng === "number") {
      return current;
    }
    return null;
  }

  const authorityProfile = await AuthorityProfileModel.findOne({ userId: authUser.userId })
    .select("_id location")
    .lean();

  if (!authorityProfile?._id) {
    return null;
  }

  const authorityProfileId = String(authorityProfile._id);
  const geo = await redisService.getLocationsByMembers(AUTHORITY_GEO_KEY, [authorityProfileId]);
  const current = geo[authorityProfileId] as { lat: number; lng: number } | undefined;
  if (typeof current?.lat === "number" && typeof current?.lng === "number") {
    return current;
  }

  if (typeof authorityProfile.location?.lat === "number" && typeof authorityProfile.location?.lng === "number") {
    return {
      lat: authorityProfile.location.lat,
      lng: authorityProfile.location.lng,
    };
  }

  return null;
};

const resolveMediaReadUrl = async (mediaKeyOrUrl: string) => {
  if (typeof mediaKeyOrUrl !== "string" || mediaKeyOrUrl.trim().length === 0) {
    return "";
  }

  const trimmed = mediaKeyOrUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return s3Service.signReadUrl(trimmed);
};

type PersonSummary = {
  userId: string;
  name: string;
  phoneNumber?: string;
  profileImage?: string | null;
  organization?: { authorityProfileId: string; name: string; type: string; contactNumber?: string } | null;
};

const CONTROL_CENTER_ORG = { authorityProfileId: "", name: "SafeSphere Control Center", type: "controller-center" };

/** Names, phone numbers and organisations for the reporter, responders and timeline actors. */
const loadCasePeople = async (emergency: any) => {
  const responders = Array.isArray(emergency.responders) ? emergency.responders : [];
  const appIds = new Set<string>([String(emergency.reportedBy)]);
  const adminIds = new Set<string>();
  for (const responder of responders) {
    const role = responderActorRole(responder);
    (isAdminRole(role) || responder.role === "authority" ? adminIds : appIds).add(String(responder.userId));
  }
  for (const entry of Array.isArray(emergency.timeline) ? emergency.timeline : []) {
    if (entry?.actorId) {
      appIds.add(String(entry.actorId));
      adminIds.add(String(entry.actorId));
    }
  }
  const validApp = [...appIds].filter((id) => Types.ObjectId.isValid(id));
  const validAdmin = [...adminIds].filter((id) => Types.ObjectId.isValid(id));

  const [appUsers, appProfiles, adminUsers] = await Promise.all([
    PublicUserModel.find({ _id: { $in: validApp } }).select("_id name phoneNumber avatarUrl role").lean(),
    ProfilePublicUserModel.find({ userId: { $in: validApp } }).select("userId name profileImage").lean(),
    AdminUserModel.find({ _id: { $in: validAdmin } }).select("_id name role authorityProfileId").lean(),
  ]);
  const authorityProfiles = await AuthorityProfileModel.find({
    $or: [
      { userId: { $in: adminUsers.filter((admin) => admin.role === "authority").map((admin) => admin._id) } },
      { _id: { $in: adminUsers.map((admin: any) => admin.authorityProfileId).filter(Boolean) } },
    ],
  })
    .select("_id userId organizationName authorityType contactNumber location")
    .lean();

  const orgOf = (profile: any) =>
    profile
      ? {
          authorityProfileId: String(profile._id),
          name: profile.organizationName,
          type: profile.authorityType,
          contactNumber: profile.contactNumber,
          // The organisation's registered station, not a person's live position.
          location:
            typeof profile.location?.lat === "number" && typeof profile.location?.lng === "number"
              ? { lat: profile.location.lat, lng: profile.location.lng }
              : null,
        }
      : null;

  const profileByUser = new Map(appProfiles.map((profile: any) => [String(profile.userId), profile]));
  const people = new Map<string, PersonSummary & { accountRole: string }>();
  for (const user of appUsers) {
    const id = String(user._id);
    const profile = profileByUser.get(id);
    people.set(id, {
      userId: id,
      accountRole: user.role,
      name: profile?.name || user.name || "SafeSphere user",
      phoneNumber: user.phoneNumber,
      profileImage: profile?.profileImage || user.avatarUrl || null,
    });
  }
  for (const admin of adminUsers as any[]) {
    const id = String(admin._id);
    const profile =
      admin.role === "authority"
        ? authorityProfiles.find((item) => String(item.userId) === id)
        : authorityProfiles.find((item) => String(item._id) === String(admin.authorityProfileId || ""));
    people.set(id, {
      userId: id,
      accountRole: admin.role,
      name: admin.name,
      organization: admin.role === "controller-center" ? CONTROL_CENTER_ORG : orgOf(profile),
      phoneNumber: profile?.contactNumber,
    });
  }
  return people;
};

/**
 * Case details for one viewer. Everything sensitive is filtered by `permissions`, which come
 * from emergency.permissions.ts and are returned too so the apps show only allowed actions.
 */
const buildEmergencyDetailsPayload = async (
  emergency: any,
  viewer: { actor: AuthActor; permissions: CasePermissions; context: Awaited<ReturnType<typeof resolveCaseContext>> },
) => {
  const { actor, permissions, context } = viewer;
  const incident = incidentPoint(emergency);
  const responders = Array.isArray(emergency.responders) ? emergency.responders : [];
  const isReporter = String(emergency.reportedBy) === actor.userId;
  const isResponder = responders.some((responder: any) => String(responder.userId) === actor.userId);
  const fakeFlags = Array.isArray(emergency.fakeFlags) ? emergency.fakeFlags : [];
  const victim = primaryVictimOf(emergency);

  const base = {
    emergencyId: String(emergency._id),
    title: emergency.title,
    type: emergency.type,
    severity: emergency.severity,
    status: emergency.status,
    isFake: Boolean(emergency.isFake),
    createdAt: emergency.createdAt,
    updatedAt: emergency.updatedAt,
    version: new Date(emergency.updatedAt ?? emergency.createdAt ?? Date.now()).getTime(),
    incident: incident ? { ...incident, address: emergency.location?.address, reportedAt: emergency.createdAt } : null,
    location: incident ? { ...incident, address: emergency.location?.address } : null,
    victimsCount: emergency.victimsCount,
    respondersConnected: responders.filter((r: any) => responderActorRole(r) !== "controller-center").length,
    distanceFromRequesterKm: context.distanceKm,
    viewer: {
      userId: actor.userId,
      role: actor.role,
      isReporter,
      isResponder,
      isReporterContact: Boolean(context.isReporterContact),
      hasFlagged: fakeFlags.some((flag: any) => String(flag.flaggedBy) === actor.userId),
      permissions,
    },
  };

  if (!permissions.canView) {
    // Nearby helpers deciding whether to respond: what happened and where, but not who.
    return {
      ...base,
      preview: true,
      description: emergency.description,
      subject: {
        label: emergency.relationToVictim === "self" ? "The reporter" : "Someone near the reporter",
        condition: victim?.condition,
      },
    };
  }

  const people = await loadCasePeople(emergency);
  const reporter = people.get(String(emergency.reportedBy));
  const canSeePhones = isReporter || isResponder || isAdminRole(actor.role) || Boolean(context.isReporterContact);

  let reporterLive: { lat: number; lng: number; updatedAt: Date } | null = null;
  const reporterCoords = emergency.reporterLocation?.coordinates;
  if (Array.isArray(reporterCoords) && reporterCoords.length === 2) {
    reporterLive = { lat: reporterCoords[1], lng: reporterCoords[0], updatedAt: emergency.reporterLocation.updatedAt };
  }

  let subjectProfile: any = null;
  if (victim?.userId && permissions.canViewMedical) {
    subjectProfile = await ProfilePublicUserModel.findOne({ userId: victim.userId })
      .select("medicalRecord contacts sosMessage")
      .lean();
  }

  const responderViews = responders.map((responder: any) => {
    const id = String(responder.userId);
    const person = people.get(id);
    const actorRole = person?.accountRole && responder.role === "authority" && !responder.actorRole
      ? (person.accountRole as ActorRole)
      : responderActorRole(responder);
    const coords = responder.location?.coordinates;
    return {
      userId: id,
      actorRole,
      name: person?.name || "Responder",
      organization: person?.organization ?? null,
      phoneNumber: canSeePhones ? person?.phoneNumber : undefined,
      status: responder.status,
      assignedByRole: responder.assignedByRole,
      joinedAt: responder.joinedAt,
      updatedAt: responder.updatedAt,
      location:
        Array.isArray(coords) && coords.length === 2 ? { lat: coords[1], lng: coords[0] } : null,
      locationUpdatedAt: responder.locationUpdatedAt ?? null,
      isMe: id === actor.userId,
    };
  });

  const activeResponders = responderViews.filter((responder: any) => responder.actorRole !== "controller-center");
  const responsibleOrg =
    activeResponders.find((responder: any) => responder.actorRole === "authority")?.organization ??
    activeResponders.find((responder: any) => responder.organization)?.organization ??
    null;

  const media = Array.isArray(emergency.media)
    ? await Promise.all(
        emergency.media.map(async (item: any) => ({
          type: item?.type === "video" || item?.type === "audio" ? item.type : "image",
          url: String(item?.url || ""),
          signedUrl: await resolveMediaReadUrl(String(item?.url || "")),
        })),
      )
    : [];

  return {
    ...base,
    preview: false,
    description: emergency.description,
    relationToVictim: emergency.relationToVictim,
    reportedBy: String(emergency.reportedBy),
    reporter: {
      userId: String(emergency.reportedBy),
      name: reporter?.name || "SafeSphere user",
      phoneNumber: canSeePhones && !isReporter ? reporter?.phoneNumber : undefined,
      profileImage: reporter?.profileImage ?? null,
      liveLocation: reporterLive,
    },
    subject: {
      isReporter: emergency.relationToVictim === "self",
      userId: victim?.userId ? String(victim.userId) : undefined,
      name: victim?.name || (emergency.relationToVictim === "self" ? reporter?.name : "Unknown person"),
      identification: victim?.status === "identified" ? "identified" : "unknown",
      // Face matches are suggestions; self-reports are certain.
      matchConfidence: emergency.relationToVictim === "self" ? 1 : victim?.confidence,
      age: victim?.age,
      gender: victim?.gender,
      condition: victim?.condition,
      medicalRecord: permissions.canViewMedical ? subjectProfile?.medicalRecord : undefined,
      contacts: permissions.canViewContacts ? subjectProfile?.contacts ?? [] : undefined,
      sosMessage: permissions.canViewMedical ? subjectProfile?.sosMessage : undefined,
    },
    responders: activeResponders,
    monitoredByControlCenter: responderViews.some((responder: any) => responder.actorRole === "controller-center"),
    responsibleAuthority: responsibleOrg,
    media,
    timeline: (Array.isArray(emergency.timeline) ? emergency.timeline : []).map((entry: any) => ({
      event: entry.event,
      timestamp: entry.timestamp,
      actorName: entry.actorId ? people.get(String(entry.actorId))?.name : undefined,
      actorRole: entry.actorId ? people.get(String(entry.actorId))?.accountRole : undefined,
    })),
    fakeReports: {
      count: uniqueStrings(fakeFlags.map((flag: any) => String(flag.flaggedBy))).length,
      threshold: FAKE_EMERGENCY_FLAG_THRESHOLD,
    },
    pointsAwards: isAdminRole(actor.role) ? emergency.pointsAwards || [] : undefined,
    // Legacy field kept for older web builds; same data as `responders` without names.
    victims: permissions.canViewMedical ? emergency.victims || [] : [],
  };
};

const toEmergencyCard = (emergency: any) => ({
  emergencyId: String(emergency._id),
  title: emergency.title,
  description: emergency.description,
  type: emergency.type,
  severity: emergency.severity,
  status: emergency.status,
  reportedBy: String(emergency.reportedBy),
  location: {
    lat: emergency.location?.coordinates?.[1],
    lng: emergency.location?.coordinates?.[0],
    address: emergency.location?.address,
  },
  victimsCount: emergency.victimsCount,
  // The control center monitors every case; only people actually responding are counted.
  respondersCount: Array.isArray(emergency.responders)
    ? emergency.responders.filter((responder: any) => responderActorRole(responder) !== "controller-center").length
    : 0,
  createdAt: emergency.createdAt,
  updatedAt: emergency.updatedAt,
});

const dispatchEmergencyNotifications = async (params: {
  emergency: any;
  reporterId: string;
  location: { lat: number; lng: number };
  relationToVictim: RelationToVictim;
}) => {
  const { emergency, reporterId, location, relationToVictim } = params;
  const io = getGlobalIO();
  if (!io) {
    return {
      summary: {
        nearbyUsers: 0,
        nearbyVolunteers: 0,
        nearbyAuthorities: 0,
        controllerCenters: 0,
        contacts: 0,
      },
      mapSnapshot: {
        incident: { lat: location.lat, lng: location.lng },
        nearbyUsers: [],
        nearbyVolunteers: [],
        nearbyAuthorities: [],
      },
      timelineEvent: "Dispatch queued: socket server unavailable",
    };
  }

  const [nearbyPublicGeo, nearbyAuthorityGeo, reporterProfile, controllerCenters] = await Promise.all([
    redisService.getNearbyLocations(USER_GEO_KEY, location.lng, location.lat, 8, "km"),
    redisService.getNearbyLocations(AUTHORITY_GEO_KEY, location.lng, location.lat, 20, "km"),
    ProfilePublicUserModel.findOne({ userId: reporterId }).select("name appContacts contacts sosMessage").lean(),
    AdminUserModel.find({ role: "controller-center", isverified: true }).select("_id").lean(),
  ]);

  const nearbyPublicIds = uniqueStrings(
    nearbyPublicGeo.map((entry) => entry.member).filter((id) => Types.ObjectId.isValid(id) && id !== reporterId),
  );

  const nearbyAuthorityProfileIds = uniqueStrings(
    nearbyAuthorityGeo.map((entry) => entry.member).filter((id) => Types.ObjectId.isValid(id)),
  );

  const nearbyPublicUsers = await PublicUserModel.find({ _id: { $in: nearbyPublicIds } })
    .select("_id role name phoneNumber avatarUrl")
    .lean();

  const nearbyUserIds = nearbyPublicUsers
    .filter((user) => user.role === "public")
    .map((user) => String(user._id));

  const nearbyVolunteerIds = nearbyPublicUsers
    .filter((user) => user.role === "volunteer")
    .map((user) => String(user._id));

  const contactIdsFromApp = uniqueStrings((reporterProfile?.appContacts || []).map((id: any) => String(id)));
  const manualContactPhones = uniqueStrings(
    (reporterProfile?.contacts || []).map((contact: any) => String(contact.phoneNumber || "")),
  );
  const manualContactUsers = manualContactPhones.length
    ? await PublicUserModel.find({ phoneNumber: { $in: manualContactPhones } }).select("_id phoneNumber").lean()
    : [];
  const manualContactIds = manualContactUsers.map((user) => String(user._id));
  // Emergency contacts without the app can only be reached by SMS (product decision: always text them).
  const appUserPhoneKeys = new Set(manualContactUsers.map((user) => phoneKey(user.phoneNumber)));
  const externalContactPhones = manualContactPhones.filter((phone) => !appUserPhoneKeys.has(phoneKey(phone)));

  const contactUserIds = uniqueStrings([...contactIdsFromApp, ...manualContactIds].filter((id) => id !== reporterId));

  const contactUsers = contactUserIds.length
    ? await PublicUserModel.find({ _id: { $in: contactUserIds } })
      .select("_id role name phoneNumber avatarUrl")
      .lean()
    : [];

  const nearbyAuthorityProfiles = await AuthorityProfileModel.find({ _id: { $in: nearbyAuthorityProfileIds }, isActive: true })
    .select("_id userId authorityType location officialEmail contactNumber")
    .lean();
  const nearbyAuthorityRoomIds = nearbyAuthorityProfiles.map((profile) => String(profile._id));

  const controllerCenterIds = controllerCenters.map((admin) => String(admin._id));

  const emergencyPayload = {
    emergencyId: String(emergency._id),
    title: emergency.title,
    description: emergency.description,
    type: emergency.type,
    severity: emergency.severity,
    relationToVictim,
    status: emergency.status,
    location: {
      lat: location.lat,
      lng: location.lng,
      address: emergency.location?.address,
    },
    victimsCount: emergency.victimsCount,
    createdAt: emergency.createdAt,
  };

  await emitToRoleUsers(io, "public", nearbyUserIds, "emergency-nearby-alert", {
    ...emergencyPayload,
    audience: "nearby-public",
    message: "Emergency reported near you. Stay alert and assist if safe.",
    playSound: true,
    soundType: "emergency",
  });

  await emitToRoleUsers(io, "volunteer", nearbyVolunteerIds, "emergency-nearby-alert", {
    ...emergencyPayload,
    audience: "nearby-volunteer",
    message: "Emergency reported nearby. Please review and respond if available.",
    playSound: true,
    soundType: "emergency",
  });

  const contactPublicIds = contactUsers
    .filter((user) => user.role !== "volunteer")
    .map((user) => String(user._id));
  const contactVolunteerIds = contactUsers
    .filter((user) => user.role === "volunteer")
    .map((user) => String(user._id));

  await emitToRoleUsers(io, "public", contactPublicIds, "emergency-contact-alert", {
    ...emergencyPayload,
    audience: "contact",
    message: "Your contact has triggered an emergency.",
    reporterId,
    playSound: true,
    soundType: "emergency",
  });

  await emitToRoleUsers(io, "volunteer", contactVolunteerIds, "emergency-contact-alert", {
    ...emergencyPayload,
    audience: "contact",
    message: "Your contact has triggered an emergency.",
    reporterId,
    playSound: true,
    soundType: "emergency",
  });

  for (const authorityProfileId of nearbyAuthorityRoomIds) {
    io.to(`authority:${authorityProfileId}`).emit("emergency-authority-alert", {
      ...emergencyPayload,
      authorityProfileId,
      audience: "nearby-authority",
      message: "Emergency reported in your nearby area.",
      playSound: true,
      soundType: "emergency-authority",
    });
  }

  await emitToRoleUsers(io, "controller-center", controllerCenterIds, "emergency-controller-alert", {
    ...emergencyPayload,
    audience: "controller-center",
    message: "New emergency reported. Monitoring and dispatch workflow required.",
    controlCenterPrivileges: getControlCenterPrivileges(),
  });

  const emergencyDetailsText = toEmergencyDetailsText(emergency, location);
  const mapsLink = `https://maps.google.com/?q=${location.lat},${location.lng}`;
  const reporterName = String(reporterProfile?.name || "Your contact").trim();
  const contactSmsText = [
    `SafeSphere SOS: ${reporterName} needs help.`,
    reporterProfile?.sosMessage ? `"${String(reporterProfile.sosMessage).slice(0, 200)}"` : null,
    `Location: ${mapsLink}`,
    `Emergency: ${emergency.title} (${emergency.severity}).`,
  ]
    .filter(Boolean)
    .join("\n");
  let smsFallbackCount = 0;
  let contactSmsCount = 0;
  let emailFallbackCount = 0;
  const textedPhones = new Set<string>();

  const sendSmsOnce = async (phoneNumber: string, message: string) => {
    const key = phoneKey(phoneNumber);
    if (!key || textedPhones.has(key)) return false;
    textedPhones.add(key);
    try {
      await snsService.sendSMS(phoneNumber, message);
      return true;
    } catch (error) {
      console.error("Failed to send emergency SMS:", error instanceof Error ? error.message : error);
      return false;
    }
  };

  const contactIdSet = new Set(contactUserIds);
  const smsTargets = [
    ...nearbyPublicUsers,
    ...contactUsers.filter((contact) => !nearbyPublicUsers.some((nearby) => String(nearby._id) === String(contact._id))),
  ];

  // In-app users are alerted over the socket; SMS is the fallback when they are offline.
  for (const user of smsTargets) {
    const userId = String(user._id);
    const socketRole = user.role === "volunteer" ? "volunteer" : "public";
    if (await isSocketUserOnline(socketRole, userId)) {
      continue;
    }

    if (!user.phoneNumber) {
      continue;
    }

    const isContact = contactIdSet.has(userId);
    const sent = await sendSmsOnce(
      user.phoneNumber,
      isContact ? contactSmsText : `SafeSphere Emergency Alert\n${emergencyDetailsText}\nRespond in app if available.`,
    );
    if (sent) {
      if (isContact) contactSmsCount += 1;
      else smsFallbackCount += 1;
    }
  }

  for (const phoneNumber of externalContactPhones) {
    if (await sendSmsOnce(phoneNumber, contactSmsText)) {
      contactSmsCount += 1;
    }
  }

  for (const authority of nearbyAuthorityProfiles) {
    const authorityUserId = String(authority.userId);
    const isOnline = await isSocketUserOnline("authority", authorityUserId);
    if (isOnline) {
      continue;
    }

    if (!authority.officialEmail || !canSendEmergencyEmail()) {
      continue;
    }

    try {
      await sendEmergencyEmail({
        to: authority.officialEmail,
        subject: `SafeSphere Emergency Alert (${authority.authorityType})`,
        text: `Emergency has been reported near your authority profile.\n\n${emergencyDetailsText}\n\nPlease open SafeSphere and accept the emergency response request.`,
      });
      emailFallbackCount += 1;
    } catch (error) {
      console.error("Failed to send emergency authority email fallback:", error);
    }
  }

  if (canSendEmergencyEmail()) {
    try {
      const allOngoing = await EmergencyModel.find({ status: { $in: ACTIVE_EMERGENCY_STATUSES } })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      const ongoingSummary = allOngoing
        .map((item, index) => {
          const lat = item.location?.coordinates?.[1];
          const lng = item.location?.coordinates?.[0];
          return `${index + 1}. ${item.title} (${item.severity}) - ${item.status} - ${lat}, ${lng}`;
        })
        .join("\n");

      await sendEmergencyEmail({
        to: DEFAULT_CONTROL_CENTER_EMAIL,
        subject: "SafeSphere Ongoing Emergencies Snapshot",
        text: `A new emergency has been reported.\n\n${emergencyDetailsText}\n\nAll ongoing emergencies:\n${ongoingSummary || "No ongoing emergencies."}`,
      });
    } catch (error) {
      console.error("Failed to send control-center ongoing emergencies email:", error);
    }
  }

  const authorityPositions = nearbyAuthorityProfileIds.length
    ? await redisService.getLocationsByMembers(AUTHORITY_GEO_KEY, nearbyAuthorityProfileIds)
    : {};

  // Only organisations are placed on the reporter's map. Nearby people are counted, never located:
  // returning their names, numbers and live positions would let anyone harvest them with an SOS.
  const mapSnapshot = {
    incident: { lat: location.lat, lng: location.lng },
    nearbyUsers: [],
    nearbyVolunteers: [],
    nearbyContacts: [],
    nearbyAuthorities: nearbyAuthorityProfiles
      .map((profile) => {
        const id = String(profile._id);
        const pos = authorityPositions[id] as { lat: number; lng: number } | undefined;
        return {
          authorityProfileId: id,
          authorityType: profile.authorityType,
          lat: typeof pos?.lat === "number" ? pos.lat : profile.location?.lat,
          lng: typeof pos?.lng === "number" ? pos.lng : profile.location?.lng,
        };
      })
      .filter((item) => typeof item.lat === "number" && typeof item.lng === "number"),
  };

  const summary = {
    nearbyUsers: nearbyUserIds.length,
    nearbyVolunteers: nearbyVolunteerIds.length,
    nearbyAuthorities: nearbyAuthorityRoomIds.length,
    controllerCenters: controllerCenterIds.length,
    contacts: contactUserIds.length + externalContactPhones.length,
    contactSms: contactSmsCount,
    smsFallback: smsFallbackCount,
    emailFallback: emailFallbackCount,
  };

  io.to(reporterRooms(emergency)).emit("emergency-dispatch-update", {
    ...emergencyPayload,
    status: "notifications_sent",
    summary,
    mapSnapshot,
    feed: [
      `Nearby users alerted: ${summary.nearbyUsers}`,
      `Nearby volunteers alerted: ${summary.nearbyVolunteers}`,
      `Nearby authorities alerted: ${summary.nearbyAuthorities}`,
      `Control center notified: ${summary.controllerCenters > 0 ? "yes" : "no"}`,
      `Emergency contacts texted: ${contactSmsCount} of ${externalContactPhones.length + contactUserIds.length}`,
      `SMS sent to offline nearby users: ${smsFallbackCount}`,
      `Authority email fallback sent: ${emailFallbackCount}`,
    ],
  });

  return {
    summary,
    mapSnapshot,
    timelineEvent: `Emergency notifications sent (contacts texted: ${contactSmsCount}, SMS fallback: ${smsFallbackCount}, email fallback: ${emailFallbackCount})`,
  };
};

const extractEmbeddingId = (payload: any): string | undefined => {
  const candidates = [
    payload?.embeddingId,
    payload?.embeddingID,
    payload?.faceEmbeddingId,
    payload?.faceEmbeddingID,
    payload?.data?.embeddingId,
    payload?.data?.embeddingID,
    payload?.result?.embeddingId,
    payload?.result?.embeddingID,
  ];

  const embeddingId = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof embeddingId === "string" ? embeddingId.trim() : undefined;
};

const toSafeEmergencyType = (value: any): EmergencyType => {
  if (typeof value === "string" && VALID_TYPES.includes(value as EmergencyType)) {
    return value as EmergencyType;
  }
  return "medical";
};

const toSafeSeverity = (value: any): EmergencySeverity => {
  if (typeof value === "string" && VALID_SEVERITIES.includes(value as EmergencySeverity)) {
    return value as EmergencySeverity;
  }
  return "high";
};

const toSafeRelation = (value: any, fallback: RelationToVictim): RelationToVictim => {
  if (typeof value === "string" && VALID_RELATIONS.includes(value as RelationToVictim)) {
    return value as RelationToVictim;
  }
  return fallback;
};

const strangerMatchKey = (reporterId: string, matchedUserId: string) => `stranger-match:${reporterId}:${matchedUserId}`;

export const processEmergencyStrangerPhoto = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser?.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { fileKey } = req.body as { fileKey?: string };
    if (!fileKey || typeof fileKey !== "string") {
      return res.status(400).json({ error: "fileKey is required" });
    }

    // The face service derives an identity from the file name, so the key format is fixed here:
    // the caller's own folder and a timestamp name, never another user's id.
    if (!new RegExp(`^emergency/stranger/${userId}/\\d{10,16}(-[a-z0-9]{1,12})?\\.jpg$`).test(fileKey)) {
      return res.status(400).json({ error: "Photo must be uploaded to your emergency/stranger folder" });
    }

    const head = await s3Service.headObject(fileKey, "profile");
    if (!head) {
      return res.status(400).json({ error: "Photo has not been uploaded yet. Please try again." });
    }
    if (!head.contentType.startsWith("image/") || head.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Photo must be an image smaller than 5 MB" });
    }

    if (!env.REMOTE_PYTHON_SCRIPT_URL) {
      return res.status(503).json({ error: "Face identification is not available right now" });
    }

    const endpoint = `${env.REMOTE_PYTHON_SCRIPT_URL.replace(/\/$/, "")}/process-image-EMERGENCY`;
    let pythonResponse: globalThis.Response;
    try {
      pythonResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      console.error("Face service unreachable:", error instanceof Error ? error.message : error);
      return res.status(503).json({ error: "Face identification is not available right now" });
    }

    if (!pythonResponse.ok) {
      const text = await pythonResponse.text();
      console.error("Face service error:", pythonResponse.status, text.slice(0, 300));
      return res.status(502).json({ error: "We couldn't read a face in that photo. Try again with the face clearly visible." });
    }

    const payload = await pythonResponse.json();
    const embeddingId = extractEmbeddingId(payload);
    const sourceVector = extractVectorFromPythonPayload(payload);

    if (!embeddingId) {
      return res.status(502).json({ error: "Embedding ID missing in face processing response" });
    }

    // Similarity step: fetch vector by embeddingId from Qdrant, run similarity search,
    // map matched embedding ids back to user DB. Fallback to direct exact lookup.
    let matchMeta: any = null;
    let matchedUser = null as any;

    try {
      const qdrantResult = await findBestMatchUsingQdrant(embeddingId, sourceVector);
      matchedUser = qdrantResult.matchedUser;
      matchMeta = qdrantResult;
    } catch (qdrantError: any) {
      console.warn("Qdrant similarity step failed, fallback to exact embedding match:", qdrantError?.message || qdrantError);
    }

    // Remember the suggestion so initiateEmergency only links a victim this reporter was shown.
    if (matchedUser?.userId) {
      await redisService.redis
        .set(strangerMatchKey(userId, matchedUser.userId), String(matchMeta?.matchedScore ?? ""), { EX: 30 * 60 })
        .catch(() => undefined);
    }

    // The stranger's embedding was only needed for this lookup; don't keep their biometrics.
    try {
      await getQdrantClient()?.delete(getQdrantCollectionName(), { points: [embeddingId] });
    } catch (deleteError) {
      console.warn("Could not delete temporary stranger embedding:", deleteError instanceof Error ? deleteError.message : deleteError);
    }

    return res.status(200).json({
      embeddingId,
      matchedUser: matchedUser || null,
      // A face match is a suggestion for the reporter to confirm, never a verified identity.
      matchKind: matchedUser ? "possible" : "none",
      similarity: {
        qdrantUsed: matchMeta?.qdrantUsed ?? false,
        matchedScore: matchMeta?.matchedScore,
        minSimilarity: matchMeta?.minSimilarity,
        reason: matchMeta?.reason,
      },
    });
  } catch (error) {
    console.error("Error processing emergency stranger photo:", error);
    return res.status(500).json({ error: "Failed to process stranger photo" });
  }
};

export const chatWithEmergencyBot = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || !Types.ObjectId.isValid(authUser.userId)) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!env.REMOTE_PYTHON_SCRIPT_URL) {
      return res.status(500).json({ error: "REMOTE_PYTHON_SCRIPT_URL is not configured" });
    }

    const {
      message,
      session,
      sessionId,
      emergencyId,
    } = req.body as {
      message?: string;
      session?: boolean;
      sessionId?: string;
      emergencyId?: string;
    };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "message is required" });
    }

    const publicUser = await PublicUserModel.findById(authUser.userId)
      .select("_id name phoneNumber age gender role isVerified isprofileComplete avatarUrl")
      .lean();

    const profile = await ProfilePublicUserModel.findOne({ userId: authUser.userId })
      .select("name userType contacts appContacts medicalRecord sosMessage autoShareMedical location")
      .lean();

    const resolvedEmergencyId =
      typeof emergencyId === "string" && Types.ObjectId.isValid(emergencyId)
        ? emergencyId
        : undefined;

    const emergency = resolvedEmergencyId
      ? await EmergencyModel.findById(resolvedEmergencyId)
          .select("_id title description type severity status location relationToVictim victimsCount")
          .lean()
      : null;

    const endpoint = `${env.REMOTE_PYTHON_SCRIPT_URL.replace(/\/$/, "")}/chatbot`;

    const payload = {
      message: message.trim(),
      session: Boolean(session),
      sessionId: typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : undefined,
      userId: String(authUser.userId),
      userDetails: {
        user: {
          userId: String(authUser.userId),
          role: authUser.role,
          name: profile?.name || publicUser?.name || authUser.name || "",
          phoneNumber: publicUser?.phoneNumber || "",
          age: publicUser?.age,
          gender: publicUser?.gender,
          isVerified: publicUser?.isVerified,
          isprofileComplete: publicUser?.isprofileComplete,
          avatarUrl: publicUser?.avatarUrl,
        },
        profile: {
          userType: profile?.userType,
          contacts: profile?.contacts || [],
          appContacts: (profile?.appContacts || []).map((id: any) => String(id)),
          medicalRecord: profile?.medicalRecord,
          sosMessage: profile?.sosMessage,
          autoShareMedical: profile?.autoShareMedical,
          location: profile?.location,
        },
        emergency: emergency
          ? {
              emergencyId: String(emergency._id),
              title: emergency.title,
              description: emergency.description,
              type: emergency.type,
              severity: emergency.severity,
              status: emergency.status,
              relationToVictim: emergency.relationToVictim,
              victimsCount: emergency.victimsCount,
              location: {
                lat: emergency.location?.coordinates?.[1],
                lng: emergency.location?.coordinates?.[0],
                address: emergency.location?.address,
              },
            }
          : null,
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({
        status: "error",
        error: "Chatbot upstream request failed",
        details: text,
      });
    }

    const raw = await response.json();
    const result = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};

    return res.status(200).json({
      status: String(result.status || "success"),
      sessionId: String(result.sessionId || payload.sessionId || ""),
      message: String(result.message || ""),
      raw: result,
    });
  } catch (error) {
    console.error("Error in emergency chatbot route:", error);
    return res.status(500).json({ status: "error", error: "Failed to process chatbot request" });
  }
};

/** Voice SOS recordings live at voice/emergency/<userId>/<timestamp>.m4a (set by the app). */
const isOwnVoiceKey = (fileKey: string, userId: string) =>
  new RegExp(`^voice/emergency/${userId}/[A-Za-z0-9_-]{1,64}\\.(m4a|mp4|aac|wav|webm|3gp|caf)$`).test(fileKey);

export const enqueueVoiceEmergencyAnalysis = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!env.SQS_VOICE_QUEUE_URL) {
      return res.status(500).json({ error: "SQS_VOICE_QUEUE_URL is not configured" });
    }

    const { fileKey } = req.body as { fileKey?: string };
    if (!fileKey || typeof fileKey !== "string" || fileKey.trim().length === 0) {
      return res.status(400).json({ error: "fileKey is required" });
    }

    const normalizedFileKey = fileKey.trim();
    if (!isOwnVoiceKey(normalizedFileKey, String(authUser.userId))) {
      return res.status(403).json({ error: "Recording must be in your own voice folder" });
    }
    const sqsClient = getVoiceSqsClient();

    const messageBody = JSON.stringify({
      filekey: normalizedFileKey,
      fileKey: normalizedFileKey,
      filename: normalizedFileKey.split("/").pop() || normalizedFileKey,
      userId: String(authUser.userId),
      queuedAt: new Date().toISOString(),
    });

    const sendResult = await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.SQS_VOICE_QUEUE_URL,
        MessageBody: messageBody,
      }),
    );

    return res.status(202).json({
      status: "queued",
      fileKey: normalizedFileKey,
      messageId: sendResult.MessageId,
    });
  } catch (error) {
    console.error("Error queueing voice emergency analysis:", error);
    return res.status(500).json({ error: "Failed to queue voice emergency analysis" });
  }
};

export const getVoiceEmergencyAnalysis = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const fileKey = String(req.query.fileKey || "").trim();
    if (!fileKey) {
      return res.status(400).json({ error: "fileKey query param is required" });
    }
    // Transcripts are personal: only the person who recorded them may read the analysis.
    if (!isOwnVoiceKey(fileKey, String(authUser.userId))) {
      return res.status(403).json({ error: "Not your recording" });
    }

    const directKey = `voice-analysis:${fileKey}`;
    const fileName = fileKey.split("/").pop() || fileKey;
    const fileNameKey = `voice-analysis:${fileName}`;

    const cached = (await redisService.redis.get(directKey)) || (await redisService.redis.get(fileNameKey));

    if (!cached) {
      return res.status(200).json({
        status: "pending",
        fileKey,
        ttlSeconds: VOICE_ANALYSIS_REDIS_TTL_SECONDS,
      });
    }

    try {
      const parsed = JSON.parse(cached);
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({
        status: "pending",
        fileKey,
      });
    }
  } catch (error) {
    console.error("Error reading voice emergency analysis:", error);
    return res.status(500).json({ error: "Failed to read voice emergency analysis" });
  }
};

export const initiateEmergency = async (req: Request, res: Response) => {
  try {
    const reporterId = req.authUser?.userId;
    if (!reporterId || !Types.ObjectId.isValid(reporterId)) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const reporter = await PublicUserModel.findById(reporterId).lean();
    if (!reporter) {
      return res.status(404).json({ error: "Reporter not found" });
    }

    if (reporter.isPermanentlyBlocked) {
      return res.status(403).json({
        error: "Your account is permanently blocked due to repeated fake emergency reports",
      });
    }

    const {
      title,
      description,
      type,
      severity,
      relationToVictim,
      isForSelf,
      location,
      victimsCount,
      condition,
      strangerFaceKey,
      faceEmbeddingId,
      identifiedUserId,
      incidentMedia,
      clientRequestId: rawClientRequestId,
    } = req.body as {
      title?: string;
      description?: string;
      type?: EmergencyType;
      severity?: EmergencySeverity;
      relationToVictim?: RelationToVictim;
      isForSelf?: boolean;
      location?: { lat?: number; lng?: number; address?: string };
      victimsCount?: number;
      condition?: string;
      strangerFaceKey?: string;
      faceEmbeddingId?: string;
      identifiedUserId?: string;
      incidentMedia?: { key?: string; type?: "image" | "video" | "audio" }[];
      clientRequestId?: string;
    };

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return res.status(400).json({ error: "title is required (min 3 chars)" });
    }

    if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
      return res.status(400).json({ error: "Valid location (lat, lng) is required" });
    }

    const clientRequestId =
      typeof rawClientRequestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(rawClientRequestId)
        ? rawClientRequestId
        : undefined;

    // A retried request (flaky network, double tap) gets back the case it already created.
    if (clientRequestId) {
      const replayed = await EmergencyModel.findOne({ reportedBy: new Types.ObjectId(reporterId), clientRequestId })
        .select("_id status")
        .lean();
      if (replayed?._id) {
        return res.status(200).json({
          message: "Emergency already created for this request",
          emergencyId: String(replayed._id),
          status: replayed.status,
          replayed: true,
        });
      }
    }

    const activeCaseConflict = async () => {
      const existing = await EmergencyModel.findOne({
        reportedBy: new Types.ObjectId(reporterId),
        status: { $in: ACTIVE_EMERGENCY_STATUSES },
      })
        .select("_id status title")
        .lean();
      return existing?._id
        ? {
            error: "You already have an open emergency. We've opened it for you.",
            code: "ACTIVE_CASE_EXISTS",
            emergencyId: String(existing._id),
            status: existing.status,
            title: existing.title,
          }
        : null;
    };

    const conflict = await activeCaseConflict();
    if (conflict) {
      return res.status(409).json(conflict);
    }

    // One open case per user: a short lock closes the gap between the check above and the insert.
    const lockKey = `emergency-create-lock:${reporterId}`;
    const lockAcquired = await redisService.redis.set(lockKey, "1", { NX: true, EX: 20 });
    if (lockAcquired !== "OK") {
      const pending = await activeCaseConflict();
      return res.status(409).json(
        pending ?? {
          error: "Your emergency is already being sent. Please wait a moment.",
          code: "CREATE_IN_PROGRESS",
        },
      );
    }
    try {

    const emergencyType = toSafeEmergencyType(type);
    const emergencySeverity = toSafeSeverity(severity);

    const victims: any[] = [];

    if (isForSelf) {
      victims.push({
        userId: new Types.ObjectId(reporterId),
        name: reporter.name || req.authUser?.name || "Self",
        age: reporter.age,
        gender: reporter.gender,
        condition: condition || "Needs immediate help",
        isPrimary: true,
        faceImageUrl: reporter.faceEmbeddingPhoto || undefined,
        faceEmbeddingId: reporter.faceEmbeddingID || undefined,
        status: "identified",
        confidence: 1,
      });
    } else {
      let matchedUser: any = null;
      const suggestedScore =
        identifiedUserId && Types.ObjectId.isValid(identifiedUserId)
          ? await redisService.redis.get(strangerMatchKey(reporterId, identifiedUserId))
          : null;
      if (identifiedUserId && suggestedScore === null) {
        return res.status(400).json({ error: "That identification has expired. Retake the photo to identify the person again." });
      }
      if (identifiedUserId && Types.ObjectId.isValid(identifiedUserId)) {
        const matchedBaseUser = await PublicUserModel.findById(identifiedUserId).select("_id name phoneNumber age gender avatarUrl faceEmbeddingID").lean();
        const matchedProfile = matchedBaseUser
          ? await ProfilePublicUserModel.findOne({ userId: matchedBaseUser._id })
            .select("name profileImage medicalRecord contacts sosMessage")
            .lean()
          : null;

        if (matchedBaseUser) {
          matchedUser = {
            userId: String(matchedBaseUser._id),
            name: matchedProfile?.name || matchedBaseUser.name || "Unknown Person",
            phoneNumber: matchedBaseUser.phoneNumber,
            age: matchedBaseUser.age,
            gender: matchedBaseUser.gender,
            profileImage: matchedProfile?.profileImage || matchedBaseUser.avatarUrl || null,
            medicalRecord: matchedProfile?.medicalRecord,
            contacts: matchedProfile?.contacts ?? [],
            sosMessage: matchedProfile?.sosMessage,
            matchedByEmbeddingId: matchedBaseUser.faceEmbeddingID,
          };
        }
      }

      // `identifiedUserId` is only sent when the reporter confirmed a face-match suggestion.
      victims.push({
        userId: matchedUser?.userId ? new Types.ObjectId(matchedUser.userId) : undefined,
        name: matchedUser?.name || "Unknown Person",
        age: matchedUser?.age,
        gender: matchedUser?.gender,
        condition: condition || "Emergency victim",
        isPrimary: true,
        contactInfo: matchedUser?.phoneNumber,
        faceImageUrl: strangerFaceKey,
        faceEmbeddingId: faceEmbeddingId,
        status: matchedUser ? "identified" : "unknown",
        confidence: matchedUser && suggestedScore ? Math.min(1, Math.max(0, Number(suggestedScore) || 0)) : undefined,
      });
    }

    const defaultControlCenter = await AdminUserModel.findOne({
      role: "controller-center",
      email: DEFAULT_CONTROL_CENTER_EMAIL,
      isverified: true,
    })
      .select("_id")
      .lean();

    const emergency = await EmergencyModel.create({
      title: title.trim(),
      description: typeof description === "string" ? description.trim() : undefined,
      type: emergencyType,
      severity: emergencySeverity,
      status: "reported",
      reportedBy: new Types.ObjectId(reporterId),
      relationToVictim: toSafeRelation(relationToVictim, isForSelf ? "self" : "bystander"),
      location: {
        type: "Point",
        coordinates: [location.lng, location.lat],
        address: typeof location.address === "string" ? location.address : undefined,
      },
      media: Array.isArray(incidentMedia)
        ? incidentMedia
            .map((item) => ({
              type: item?.type === "video" || item?.type === "audio" ? item.type : "image",
              url: String(item?.key || "").trim(),
            }))
            .filter((item) => item.url.length > 0)
        : [],
      victims,
      victimsCount: typeof victimsCount === "number" ? victimsCount : victims.length,
      timeline: [
        {
          event: "Emergency initiated",
          timestamp: new Date(),
          actorId: new Types.ObjectId(reporterId),
          meta: {
            type: emergencyType,
            severity: emergencySeverity,
            isForSelf: Boolean(isForSelf),
          },
        },
      ],
      // The control center monitors every case; it is stored as a responder for legacy readers
      // but tagged with its real role so the apps don't present it as a field responder.
      responders: defaultControlCenter?._id
        ? [
            {
              userId: new Types.ObjectId(String(defaultControlCenter._id)),
              role: "authority",
              actorRole: "controller-center",
              status: "assigned",
              joinedAt: new Date(),
            },
          ]
        : [],
      reporterLocation: { coordinates: [location.lng, location.lat], updatedAt: new Date() },
      clientRequestId,
      priorityScore: emergencySeverity === "critical" ? 100 : emergencySeverity === "high" ? 80 : emergencySeverity === "medium" ? 60 : 40,
    });

    const dispatchResult = await dispatchEmergencyNotifications({
      emergency,
      reporterId,
      location: { lat: location.lat, lng: location.lng },
      relationToVictim: toSafeRelation(relationToVictim, isForSelf ? "self" : "bystander"),
    });

    emergency.timeline.push({
      event: dispatchResult.timelineEvent,
      timestamp: new Date(),
      actorId: new Types.ObjectId(reporterId),
      meta: {
        summary: dispatchResult.summary,
        defaultControlCenterAssigned: Boolean(defaultControlCenter?._id),
        controlCenterPrivileges: getControlCenterPrivileges(),
      },
    });
    await emergency.save();

    return res.status(201).json({
      message: "Emergency initiated successfully",
      emergencyId: String(emergency._id),
      emergency,
      dispatch: dispatchResult,
      nextStep: "Dispatch notifications sent via websocket",
    });
    } finally {
      await redisService.redis.del(lockKey).catch(() => undefined);
    }
  } catch (error) {
    console.error("Error initiating emergency:", error);
    return res.status(500).json({ error: "Failed to initiate emergency" });
  }
};

export const acceptEmergencyResponse = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { emergencyId } = req.body as { emergencyId?: string };
    if (!emergencyId || !Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Valid emergencyId is required" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const actor = toActor(authUser);
    const clientLocation = parseClientLocation(req.body?.location);
    const existingResponder = emergency.responders.find((item) => String(item.userId) === actor.userId);

    if (existingResponder) {
      return res.status(200).json({
        message: "You are already responding to this emergency",
        emergencyId: String(emergency._id),
        trackingNotice: "Your location is shared with this case while you respond.",
        responderRole: responderActorRole(existingResponder),
        alreadyAssigned: true,
      });
    }

    if (!isActiveStatus(emergency.status)) {
      return res.status(409).json({ error: `This emergency is already ${emergency.status.replace("_", " ")}.`, status: emergency.status });
    }

    const { permissions, context } = await permissionsFor(emergency, actor, clientLocation);
    if (!permissions.canAccept) {
      const reason =
        String(emergency.reportedBy) === actor.userId
          ? "You reported this emergency, so you can't also respond to it."
          : context.distanceKm == null
            ? "Share your location so we can confirm you're close enough to help."
            : "This emergency is outside your response area.";
      return res.status(403).json({ error: reason });
    }

    let responderLocation: { type: "Point"; coordinates: [number, number] } | undefined = undefined;
    const location = clientLocation ?? context.actorLocation;
    if (location) {
      responderLocation = { type: "Point", coordinates: [location.lng, location.lat] };
    }

    emergency.responders.push({
      userId: new Types.ObjectId(actor.userId),
      role: legacyResponderRole(actor.role),
      actorRole: actor.role,
      status: "assigned",
      location: responderLocation,
      locationUpdatedAt: responderLocation ? new Date() : undefined,
      joinedAt: new Date(),
    } as any);

    if (emergency.status === "reported" || emergency.status === "verified") {
      emergency.status = "in_progress";
    }
    emergency.timeline.push({
      event: "Responder accepted emergency request",
      timestamp: new Date(),
      actorId: new Types.ObjectId(actor.userId),
      meta: {
        responderRole: actor.role,
        responderUserId: actor.userId,
        locationTracked: Boolean(responderLocation),
      },
    });
    await emergency.save();

    const dispatchUpdatePayload = {
      emergencyId: String(emergency._id),
      message: `A ${actor.role === "public" ? "nearby helper" : actor.role} accepted your emergency`,
      responder: { userId: actor.userId, role: actor.role },
      trackingNotice: "Your location is shared with this case while you respond.",
    };

    const io = getGlobalIO();
    if (io) {
      io.to(reporterRooms(emergency)).emit("emergency-dispatch-update", dispatchUpdatePayload);
      io.to("controller-center").emit("emergency-dispatch-update", {
        ...dispatchUpdatePayload,
        controlCenterPrivileges: getControlCenterPrivileges(),
      });
      io.to(`${actor.role}:${actor.userId}`).emit("emergency-response-accepted", dispatchUpdatePayload);
    }
    broadcastCaseUpdate(emergency, "responder-joined", { userId: actor.userId });

    return res.status(200).json({
      message: "Emergency response accepted",
      emergencyId: String(emergency._id),
      trackingNotice: dispatchUpdatePayload.trackingNotice,
      responderRole: actor.role,
      alreadyAssigned: false,
    });
  } catch (error) {
    console.error("Error accepting emergency response:", error);
    return res.status(500).json({ error: "Failed to accept emergency response" });
  }
};

export const getNearbyOngoingEmergencies = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || !["public", "volunteer"].includes(authUser.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const latRaw = req.query.lat;
    const lngRaw = req.query.lng;
    const radiusRaw = req.query.radiusKm;
    const radiusKm = Math.max(1, Math.min(25, Number(radiusRaw || 10)));

    let lat = typeof latRaw === "string" ? Number(latRaw) : NaN;
    let lng = typeof lngRaw === "string" ? Number(lngRaw) : NaN;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      const geo = await redisService.getLocationsByMembers(USER_GEO_KEY, [authUser.userId]);
      const current = geo[authUser.userId] as { lat: number; lng: number } | undefined;
      lat = current?.lat ?? NaN;
      lng = current?.lng ?? NaN;
    }

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required (or user live location must be available)" });
    }

    const emergencies = await EmergencyModel.find({
      status: { $in: ACTIVE_EMERGENCY_STATUSES },
      location: {
        $nearSphere: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: radiusKm * 1000,
        },
      },
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    return res.status(200).json({
      count: emergencies.length,
      radiusKm,
      emergencies: emergencies.map((emergency) => ({
        ...toEmergencyCard(emergency),
        isMine: String(emergency.reportedBy) === authUser.userId,
        amResponding: (emergency.responders || []).some((responder: any) => String(responder.userId) === authUser.userId),
        distanceKm: haversineDistanceKm({ lat, lng }, incidentPoint(emergency) ?? { lat, lng }),
      })),
    });
  } catch (error) {
    console.error("Error loading nearby ongoing emergencies:", error);
    return res.status(500).json({ error: "Failed to load nearby ongoing emergencies" });
  }
};

export const getAllOngoingEmergenciesForControlCenter = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || authUser.role !== "controller-center") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const emergencies = await EmergencyModel.find({ status: { $in: ACTIVE_EMERGENCY_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Filter to only include valid emergencies with proper data
    const validEmergencies = emergencies.filter((emergency) => {
      if (!emergency._id || !emergency.reportedBy || !emergency.location?.coordinates) {
        console.warn("[Emergency] Skipping invalid emergency record:", emergency._id);
        return false;
      }
      return true;
    });

    return res.status(200).json({
      count: validEmergencies.length,
      privileges: getControlCenterPrivileges(),
      emergencies: validEmergencies.map((emergency) => ({
        ...toEmergencyCard(emergency),
        privileges: getControlCenterPrivileges(),
      })),
    });
  } catch (error) {
    console.error("Error loading control-center ongoing emergencies:", error);
    return res.status(500).json({ error: "Failed to load ongoing emergencies" });
  }
};

export const getDirectiveEmergencies = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || !["authority", "responder", "controller-center"].includes(authUser.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const actorLocation = await resolveActorLocation({ userId: authUser.userId, role: authUser.role });
    const emergencies = await EmergencyModel.find({ status: { $in: ACTIVE_EMERGENCY_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const withDistances = emergencies
      .map((emergency) => {
        const incidentLat = emergency.location?.coordinates?.[1];
        const incidentLng = emergency.location?.coordinates?.[0];
        const distanceFromRequesterKm =
          actorLocation && typeof incidentLat === "number" && typeof incidentLng === "number"
            ? haversineDistanceKm(actorLocation, { lat: incidentLat, lng: incidentLng })
            : null;

        const myEntry = (emergency.responders || []).find((responder: any) => String(responder.userId) === authUser.userId);
        return {
          ...toEmergencyCard(emergency),
          respondersConnected: (emergency.responders || []).filter((r: any) => responderActorRole(r) !== "controller-center").length,
          distanceFromRequesterKm,
          assignedToMe: Boolean(myEntry),
          myStatus: myEntry?.status ?? null,
          assignedByRole: myEntry?.assignedByRole ?? null,
        };
      })
      .filter((item) => {
        if (authUser.role === "controller-center" || item.assignedToMe) return true;
        if (item.distanceFromRequesterKm == null) return true;
        return item.distanceFromRequesterKm <= ADMIN_CASE_RADIUS_KM;
      })
      // Cases I'm on first, then by severity and recency.
      .sort((left, right) => Number(right.assignedToMe) - Number(left.assignedToMe));

    return res.status(200).json({
      count: withDistances.length,
      requesterLocation: actorLocation,
      directives: withDistances,
      privileges: authUser.role === "controller-center" ? getControlCenterPrivileges() : undefined,
    });
  } catch (error) {
    console.error("Error loading directive emergencies:", error);
    return res.status(500).json({ error: "Failed to load directive emergencies" });
  }
};

export const getEmergencyById = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const emergency = await EmergencyModel.findById(emergencyId).lean();
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const actor = toActor(authUser);
    // App users may pass their current position so a nearby helper can preview the case.
    const locationHint = parseClientLocation({ lat: req.query.lat, lng: req.query.lng });
    const { permissions, context } = await permissionsFor(emergency, actor, locationHint);

    if (!permissions.canPreview) {
      return res.status(403).json({ error: "Not authorized to view this emergency" });
    }

    const payload = await buildEmergencyDetailsPayload(emergency, { actor, permissions, context });

    return res.status(200).json({
      emergency: payload,
      permissions,
      // Legacy shape read by older clients.
      privileges: {
        canEditCase: permissions.canVerify || permissions.canResolve,
        canCloseCase: permissions.canClose,
        canBroadcastUpdates: actor.role === "controller-center",
        canViewReporterDetails: permissions.canView,
      },
    });
  } catch (error) {
    console.error("Error loading emergency by id:", error);
    return res.status(500).json({ error: "Failed to load emergency details" });
  }
};

/** The caller's open case, as reporter or as responder, so the apps can resume it after a restart. */
export const getMyActiveEmergency = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || !Types.ObjectId.isValid(authUser.userId)) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const userObjectId = new Types.ObjectId(authUser.userId);
    const [reported, responding] = await Promise.all([
      EmergencyModel.findOne({ reportedBy: userObjectId, status: { $in: ACTIVE_EMERGENCY_STATUSES } })
        .sort({ createdAt: -1 })
        .lean(),
      EmergencyModel.find({ "responders.userId": userObjectId, status: { $in: ACTIVE_EMERGENCY_STATUSES } })
        .sort({ updatedAt: -1 })
        .limit(5)
        .lean(),
    ]);

    return res.status(200).json({
      asReporter: reported ? toEmergencyCard(reported) : null,
      asResponder: responding.map((emergency) => {
        const mine = (emergency.responders || []).find((responder: any) => String(responder.userId) === authUser.userId);
        return { ...toEmergencyCard(emergency), myStatus: mine?.status ?? "assigned" };
      }),
    });
  } catch (error) {
    console.error("Error loading active emergency:", error);
    return res.status(500).json({ error: "Failed to load your active emergency" });
  }
};

export const closeEmergencyCase = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!(["controller-center", "authority"] as EmergencyActorRole[]).includes(authUser.role as EmergencyActorRole)) {
      return res.status(403).json({ error: "Only controller-center or authority can close emergency cases" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    if (emergency.status === "closed") {
      return res.status(200).json({ message: "Emergency case already closed", emergencyId, status: "closed" });
    }

    const { permissions } = await permissionsFor(emergency, toActor(authUser));
    if (!permissions.canClose) {
      return res.status(403).json({ error: "This case is outside your authority's area" });
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 260) : "";
    await closeEmergencyCaseAndBroadcast(
      emergency,
      {
        userId: authUser.userId,
        role: authUser.role as "authority" | "controller-center",
      },
      reason || undefined,
    );

    return res.status(200).json({
      message: "Emergency case closed and media streams terminated",
      emergencyId,
      status: "closed",
    });
  } catch (error) {
    console.error("Error closing emergency case:", error);
    return res.status(500).json({ error: "Failed to close emergency case" });
  }
};

export const flagEmergencyAsFake = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || req.body?.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    if (String(emergency.reportedBy) === authUser.userId) {
      return res.status(400).json({ error: "Reporter cannot flag own emergency" });
    }

    const existingFlags = Array.isArray(emergency.fakeFlags) ? emergency.fakeFlags : [];
    const alreadyFlagged = existingFlags.some((entry: any) => String(entry.flaggedBy) === authUser.userId);
    if (alreadyFlagged) {
      return res.status(200).json({
        message: "You already flagged this emergency",
        emergencyId,
        uniqueFlags: uniqueStrings(existingFlags.map((entry: any) => String(entry.flaggedBy))).length,
        threshold: FAKE_EMERGENCY_FLAG_THRESHOLD,
      });
    }

    // Product decision: only people on the case and admins may flag (the threshold and block are unchanged).
    const { permissions } = await permissionsFor(emergency, toActor(authUser));
    if (!permissions.canFlagFake) {
      return res.status(403).json({ error: "Only people responding to this case, or authorities, can report it as fake" });
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 260) : "";
    const flaggerRole = authUser.role as EmergencyActorRole;
    emergency.fakeFlags = [
      ...existingFlags,
      {
        flaggedBy: new Types.ObjectId(authUser.userId),
        flaggerRole,
        reason,
        createdAt: new Date(),
      },
    ] as any;

    const uniqueFlaggerIds = uniqueStrings((emergency.fakeFlags || []).map((entry: any) => String(entry.flaggedBy)));
    const reachedThreshold = uniqueFlaggerIds.length >= FAKE_EMERGENCY_FLAG_THRESHOLD;

    emergency.timeline.push({
      event: "Emergency flagged as fake",
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: {
        reason,
        flaggedByRole: authUser.role,
        uniqueFlags: uniqueFlaggerIds.length,
        threshold: FAKE_EMERGENCY_FLAG_THRESHOLD,
      },
    });

    let reporterBlocked = false;
    if (reachedThreshold) {
      emergency.isFake = true;
      emergency.confidenceScore = 1;

      const reporter = await PublicUserModel.findById(emergency.reportedBy);
      if (reporter) {
        const accumulated = uniqueStrings([
          ...(reporter.fraudFlaggedBy || []).map((id: any) => String(id)),
          ...uniqueFlaggerIds,
        ]);

        reporter.fraudFlaggedBy = accumulated.map((id) => new Types.ObjectId(id));
        reporter.fraudFlagCount = accumulated.length;

        if (accumulated.length >= FAKE_EMERGENCY_FLAG_THRESHOLD && !reporter.isPermanentlyBlocked) {
          reporter.isPermanentlyBlocked = true;
          reporter.permanentlyBlockedAt = new Date();
          reporter.permanentBlockReason = "Repeated fake emergency triggers flagged by multiple users";
          reporterBlocked = true;
        }

        await reporter.save();
      }

      if (emergency.status !== "closed") {
        await closeEmergencyCaseAndBroadcast(
          emergency,
          {
            userId: authUser.userId,
            role: authUser.role === "controller-center" ? "controller-center" : "authority",
          },
          "Emergency closed after fake-report threshold was reached",
        );
      } else {
        await emergency.save();
      }
    } else {
      await emergency.save();
    }
    broadcastCaseUpdate(emergency, "fake-flag", { uniqueFlags: uniqueFlaggerIds.length });

    return res.status(200).json({
      message: reachedThreshold
        ? "Fake-emergency threshold reached. Reporter account has been reviewed and blocked if threshold met."
        : "Fake-emergency flag recorded",
      emergencyId,
      uniqueFlags: uniqueFlaggerIds.length,
      threshold: FAKE_EMERGENCY_FLAG_THRESHOLD,
      reporterBlocked,
      emergencyMarkedFake: Boolean(emergency.isFake),
    });
  } catch (error) {
    console.error("Error flagging fake emergency:", error);
    return res.status(500).json({ error: "Failed to flag emergency" });
  }
};

export const rewardEmergencyParticipant = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!(["authority", "controller-center"] as EmergencyActorRole[]).includes(authUser.role as EmergencyActorRole)) {
      return res.status(403).json({ error: "Only authority or controller-center can award points" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const participantUserId = String(req.body?.participantUserId || "");
    const points = Number(req.body?.points);
    const closeCase = Boolean(req.body?.closeCase);
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 260) : "";
    const awardedByRole = authUser.role as "authority" | "controller-center";

    if (!Types.ObjectId.isValid(participantUserId)) {
      return res.status(400).json({ error: "Valid participantUserId is required" });
    }

    if (!Number.isFinite(points) || points < 1 || points > MAX_REWARD_POINTS_PER_AWARD) {
      return res.status(400).json({ error: `points must be between 1 and ${MAX_REWARD_POINTS_PER_AWARD}` });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const { permissions } = await permissionsFor(emergency, toActor(authUser));
    if (!permissions.canAwardPoints) {
      return res.status(403).json({ error: "This case is outside your authority's area" });
    }

    const isReporter = String(emergency.reportedBy) === participantUserId;
    const isResponder = Array.isArray(emergency.responders)
      ? emergency.responders.some((entry: any) => String(entry.userId) === participantUserId)
      : false;

    if (!isReporter && !isResponder) {
      return res.status(400).json({ error: "Participant is not part of this emergency" });
    }

    const participant = await PublicUserModel.findById(participantUserId);
    if (!participant) {
      return res.status(404).json({ error: "Participant public user not found" });
    }

    participant.rewardPoints = (participant.rewardPoints || 0) + Math.floor(points);
    await participant.save();

    emergency.pointsAwards = [
      ...(Array.isArray(emergency.pointsAwards) ? emergency.pointsAwards : []),
      {
        userId: new Types.ObjectId(participantUserId),
        points: Math.floor(points),
        awardedBy: new Types.ObjectId(authUser.userId),
        awardedByRole,
        note,
        awardedAt: new Date(),
      },
    ] as any;

    emergency.timeline.push({
      event: "Participation points awarded",
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: {
        participantUserId,
        points: Math.floor(points),
        awardedByRole: authUser.role,
        note,
      },
    });

    if (closeCase && emergency.status !== "closed") {
      await closeEmergencyCaseAndBroadcast(
        emergency,
        {
          userId: authUser.userId,
          role: authUser.role as "authority" | "controller-center",
        },
        "Emergency case closed after participation rewards were granted",
      );
    } else {
      await emergency.save();
      broadcastCaseUpdate(emergency, "points-awarded", { participantUserId });
    }

    return res.status(200).json({
      message: closeCase ? "Points awarded and case closed" : "Points awarded successfully",
      emergencyId,
      participantUserId,
      awardedPoints: Math.floor(points),
      totalPoints: participant.rewardPoints,
      closed: emergency.status === "closed",
    });
  } catch (error) {
    console.error("Error rewarding emergency participant:", error);
    return res.status(500).json({ error: "Failed to reward participant" });
  }
};

export const leaveEmergencyCase = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    if (String(emergency.reportedBy) === authUser.userId) {
      return res.status(403).json({ error: "Reporter cannot leave their own emergency case" });
    }

    const responderIndex = emergency.responders.findIndex((r: any) => String(r.userId) === authUser.userId);
    if (responderIndex === -1) {
      return res.status(400).json({ error: "You are not responding to this emergency" });
    }
    if (!isActiveStatus(emergency.status)) {
      return res.status(409).json({ error: `This emergency is already ${emergency.status}.`, status: emergency.status });
    }

    // Anyone who joined (public helpers included) may step away; the reporter is told.
    const [removed] = emergency.responders.splice(responderIndex, 1);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 260) : "";
    emergency.timeline.push({
      event: `${authUser.role} left emergency case`,
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: { leftByRole: authUser.role, leftByUserId: authUser.userId, reason: reason || undefined },
    });
    await emergency.save();

    const payload = {
      emergencyId,
      userId: authUser.userId,
      role: removed ? responderActorRole(removed) : authUser.role,
      message: "A responder has left the case",
    };
    const io = getGlobalIO();
    if (io) {
      io.to([...caseRooms(emergency), `${authUser.role}:${authUser.userId}`, `stream:emergency:${emergencyId}`]).emit(
        "emergency-responder-left",
        payload,
      );
    }
    broadcastCaseUpdate(emergency, "responder-left", { userId: authUser.userId });

    return res.status(200).json({
      message: "You have left this emergency",
      emergencyId,
      remainingResponders: emergency.responders.filter((r: any) => responderActorRole(r) !== "controller-center").length,
    });
  } catch (error) {
    console.error("Error leaving emergency case:", error);
    return res.status(500).json({ error: "Failed to leave emergency case" });
  }
};

/** reported → verified (authority / control center) and verified|in_progress → resolved. Closing has its own route. */
export const updateEmergencyStatus = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    const action = String(req.body?.action || "") as keyof typeof STATUS_TRANSITIONS;
    if (!Types.ObjectId.isValid(emergencyId) || !(action in STATUS_TRANSITIONS)) {
      return res.status(400).json({ error: "Valid emergency id and action (verify | resolve) are required" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const transition = STATUS_TRANSITIONS[action];
    if (!transition.from.includes(emergency.status as any)) {
      return res.status(409).json({ error: `Can't ${action} a case that is ${emergency.status.replace("_", " ")}.`, status: emergency.status });
    }

    const { permissions } = await permissionsFor(emergency, toActor(authUser));
    if ((action === "verify" && !permissions.canVerify) || (action === "resolve" && !permissions.canResolve)) {
      return res.status(403).json({ error: `You can't ${action} this case` });
    }

    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 260) : "";
    emergency.status = transition.to;
    emergency.timeline.push({
      event: action === "verify" ? "Emergency verified" : "Emergency resolved",
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: { byRole: authUser.role, note: note || undefined },
    });
    await emergency.save();
    broadcastCaseUpdate(emergency, `status-${transition.to}`);

    return res.status(200).json({ emergencyId, status: emergency.status });
  } catch (error) {
    console.error("Error updating emergency status:", error);
    return res.status(500).json({ error: "Failed to update emergency status" });
  }
};

const RESPONDER_STATUS_ORDER = ["assigned", "enroute", "on_scene", "completed"] as const;

/** A responder reports their own progress: en route → on scene → done. */
export const updateMyResponderStatus = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    const status = String(req.body?.status || "") as (typeof RESPONDER_STATUS_ORDER)[number];
    if (!Types.ObjectId.isValid(emergencyId) || !RESPONDER_STATUS_ORDER.includes(status)) {
      return res.status(400).json({ error: "status must be one of enroute, on_scene, completed" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }
    const entry = emergency.responders.find((responder: any) => String(responder.userId) === authUser.userId);
    if (!entry) {
      return res.status(403).json({ error: "You are not responding to this emergency" });
    }
    if (!isActiveStatus(emergency.status)) {
      return res.status(409).json({ error: `This emergency is already ${emergency.status}.`, status: emergency.status });
    }
    if (entry.status === status) {
      return res.status(200).json({ emergencyId, status });
    }

    entry.status = status;
    entry.updatedAt = new Date();
    emergency.timeline.push({
      event: { enroute: "Responder is on the way", on_scene: "Responder arrived on scene", completed: "Responder finished", assigned: "Responder assigned" }[status],
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: { responderRole: authUser.role, status },
    });
    await emergency.save();
    broadcastCaseUpdate(emergency, "responder-status", { userId: authUser.userId, responderStatus: status });

    return res.status(200).json({ emergencyId, status });
  } catch (error) {
    console.error("Error updating responder status:", error);
    return res.status(500).json({ error: "Failed to update your status" });
  }
};

/**
 * Live position for an open case, from the reporter or a responder. Updates carry the device's
 * `recordedAt`; anything older than what's stored is ignored so out-of-order delivery can't
 * move a marker backwards.
 */
export const updateCaseLocation = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    const location = parseClientLocation(req.body);
    if (!Types.ObjectId.isValid(emergencyId) || !location) {
      return res.status(400).json({ error: "Valid emergency id, lat and lng are required" });
    }
    const recordedAtMs = Number(new Date(req.body?.recordedAt ?? Date.now()));
    // Clamp device clocks: never in the future, never more than 10 minutes old.
    const recordedAt = new Date(Math.min(Date.now(), Number.isFinite(recordedAtMs) ? recordedAtMs : Date.now()));
    if (Date.now() - recordedAt.getTime() > 10 * 60 * 1000) {
      return res.status(400).json({ error: "Location is too old" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }
    if (!isActiveStatus(emergency.status)) {
      return res.status(409).json({ error: `This emergency is already ${emergency.status}.`, status: emergency.status });
    }

    const isReporter = String(emergency.reportedBy) === authUser.userId;
    const entry = emergency.responders.find((responder: any) => String(responder.userId) === authUser.userId);
    if (!isReporter && !entry) {
      return res.status(403).json({ error: "Only the reporter and responders share location on a case" });
    }

    const previous = isReporter ? emergency.reporterLocation?.updatedAt : entry?.locationUpdatedAt;
    if (previous && new Date(previous).getTime() >= recordedAt.getTime()) {
      return res.status(200).json({ emergencyId, stale: true });
    }

    if (isReporter) {
      emergency.reporterLocation = { coordinates: [location.lng, location.lat], updatedAt: recordedAt };
    } else if (entry) {
      entry.location = { type: "Point", coordinates: [location.lng, location.lat] };
      entry.locationUpdatedAt = recordedAt;
    }
    await emergency.save();

    emitToCase(emergency, "emergency-location-update", {
      emergencyId,
      userId: authUser.userId,
      party: isReporter ? "reporter" : "responder",
      lat: location.lat,
      lng: location.lng,
      recordedAt: recordedAt.toISOString(),
    });

    return res.status(200).json({ emergencyId, recordedAt: recordedAt.toISOString() });
  } catch (error) {
    console.error("Error updating case location:", error);
    return res.status(500).json({ error: "Failed to update location" });
  }
};

/** Responders an admin may assign: all of them for the control center, its own for an authority. */
export const listAssignableResponders = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || !["authority", "controller-center"].includes(authUser.role)) {
      return res.status(403).json({ error: "Only authorities and the control center can assign responders" });
    }

    let filter: Record<string, unknown> = { role: "responder", isverified: true };
    if (authUser.role === "authority") {
      const profile = await AuthorityProfileModel.findOne({ userId: authUser.userId }).select("_id").lean();
      if (!profile) {
        return res.status(200).json({ responders: [] });
      }
      filter = { ...filter, authorityProfileId: profile._id };
    }

    const responders = await AdminUserModel.find(filter).select("_id name email authorityProfileId").lean();
    const orgIds = responders.map((responder: any) => responder.authorityProfileId).filter(Boolean);
    const orgs = await AuthorityProfileModel.find({ _id: { $in: orgIds } }).select("_id organizationName authorityType").lean();
    const orgById = new Map(orgs.map((org) => [String(org._id), org]));
    const online = await redisService.getSocketIdsByUserIds("responder", responders.map((r) => String(r._id)));

    return res.status(200).json({
      responders: responders.map((responder: any) => {
        const org = responder.authorityProfileId ? orgById.get(String(responder.authorityProfileId)) : null;
        return {
          userId: String(responder._id),
          name: responder.name,
          email: responder.email,
          organization: org ? { authorityProfileId: String(org._id), name: org.organizationName, type: org.authorityType } : null,
          online: Boolean(online[String(responder._id)]),
        };
      }),
    });
  } catch (error) {
    console.error("Error listing responders:", error);
    return res.status(500).json({ error: "Failed to load responders" });
  }
};

export const assignResponderToEmergency = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId || !["authority", "controller-center"].includes(authUser.role)) {
      return res.status(403).json({ error: "Only authorities and the control center can assign responders" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    const responderUserId = String(req.body?.responderUserId || "");
    if (!Types.ObjectId.isValid(emergencyId) || !Types.ObjectId.isValid(responderUserId)) {
      return res.status(400).json({ error: "Valid emergency id and responderUserId are required" });
    }

    const [emergency, responderUser] = await Promise.all([
      EmergencyModel.findById(emergencyId),
      AdminUserModel.findById(responderUserId).select("_id role name isverified authorityProfileId").lean(),
    ]);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }
    if (!responderUser || responderUser.role !== "responder" || !responderUser.isverified) {
      return res.status(400).json({ error: "That account is not an active responder" });
    }

    const { permissions } = await permissionsFor(emergency, toActor(authUser));
    if (!permissions.canAssignResponders) {
      return res.status(403).json({ error: "You can't assign responders to this case" });
    }

    if (authUser.role === "authority") {
      const profile = await AuthorityProfileModel.findOne({ userId: authUser.userId }).select("_id").lean();
      if (!profile || String(profile._id) !== String((responderUser as any).authorityProfileId || "")) {
        return res.status(403).json({ error: "You can only assign responders from your own organisation" });
      }
    }

    const existing = emergency.responders.find((responder: any) => String(responder.userId) === responderUserId);
    if (existing) {
      return res.status(200).json({ message: `${responderUser.name} is already on this case`, emergencyId, alreadyAssigned: true });
    }

    emergency.responders.push({
      userId: new Types.ObjectId(responderUserId),
      role: "authority",
      actorRole: "responder",
      status: "assigned",
      assignedBy: new Types.ObjectId(authUser.userId),
      assignedByRole: authUser.role as "authority" | "controller-center",
      joinedAt: new Date(),
    } as any);
    if (emergency.status === "reported" || emergency.status === "verified") {
      emergency.status = "in_progress";
    }
    emergency.timeline.push({
      event: "Responder assigned",
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: { responderUserId, responderName: responderUser.name, assignedByRole: authUser.role },
    });
    await emergency.save();

    const io = getGlobalIO();
    io?.to(`responder:${responderUserId}`).emit("emergency-assigned", {
      emergencyId,
      title: emergency.title,
      severity: emergency.severity,
      type: emergency.type,
      location: incidentPoint(emergency),
      assignedByRole: authUser.role,
      message: "You have been assigned to an emergency",
    });
    broadcastCaseUpdate(emergency, "responder-assigned", { userId: responderUserId });

    return res.status(200).json({ message: `${responderUser.name} assigned`, emergencyId, alreadyAssigned: false });
  } catch (error) {
    console.error("Error assigning responder:", error);
    return res.status(500).json({ error: "Failed to assign responder" });
  }
};
