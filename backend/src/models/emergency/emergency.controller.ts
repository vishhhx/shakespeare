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
import snsService from "../../utils/sns";
import { canSendEmergencyEmail, sendEmergencyEmail } from "../../utils/mailer";

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

  // 2) Similarity search with fetched vector in Qdrant
  let hits: any[] = [];
  const minSimilarity = getEmergencyMinSimilarity();
  try {
    let searchResult = await client.search(collection, {
      vector,
      limit: 10,
      with_payload: true,
      with_vector: false,
      score_threshold: minSimilarity,
    });

    // If no candidate crosses threshold, do a fallback search without threshold
    // and let downstream matching pick the best possible user.
    if (!Array.isArray(searchResult) || searchResult.length === 0) {
      searchResult = await client.search(collection, {
        vector,
        limit: 10,
        with_payload: true,
        with_vector: false,
      });
    }

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

  const scoredCandidatesRaw = hits
    .map((point: any) => ({
      embeddingId: extractEmbeddingCandidateFromPoint(point),
      score: typeof point?.score === "number" ? point.score : undefined,
    }));

  const scoredCandidates: Array<{ embeddingId: string; score?: number }> = scoredCandidatesRaw
    .filter((entry: { embeddingId: string | null; score?: number }) => {
      return typeof entry.embeddingId === "string" && entry.embeddingId.length > 0;
    })
    .map((entry: { embeddingId: string | null; score?: number }) => ({
      embeddingId: String(entry.embeddingId),
      score: typeof entry.score === "number" ? entry.score : undefined,
    }));

  const candidateEmbeddingIds: string[] = Array.from(new Set<string>(scoredCandidates.map((entry) => entry.embeddingId)));

  // Prefer matches other than the current embedding, fallback includes it.
  const prioritizedCandidates = [
    ...candidateEmbeddingIds.filter((id) => id !== embeddingId),
    ...candidateEmbeddingIds.filter((id) => id === embeddingId),
  ];

  const pointIds = uniqueStrings(hits.map((point: any) => String(point?.id || "")));
  const payloadUserIds = uniqueStrings(
    hits
      .map((point: any) => point?.payload?.publicUserId || point?.payload?.userId || point?.payload?.userID)
      .map((id: any) => String(id || "")),
  );

  const matchedUserByUserId = await findUserByPublicUserIds(payloadUserIds);
  const matchedUserByEmbedding = matchedUserByUserId ? null : await findUserByEmbeddingCandidates(prioritizedCandidates);
  const matchedUserByPointId = matchedUserByUserId || matchedUserByEmbedding
    ? null
    : await findUserByEmbeddingCandidates(pointIds);
  const matchedUser = matchedUserByUserId || matchedUserByEmbedding || matchedUserByPointId;
  const matchedCandidate = matchedUser
    ? scoredCandidates.find((entry) => entry.embeddingId === matchedUser.matchedByEmbeddingId)
    : null;

  return {
    matchedUser,
    qdrantUsed: true,
    collection,
    minSimilarity,
    candidates: prioritizedCandidates,
    pointIds,
    payloadUserIds,
    matchedScore: matchedCandidate?.score,
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

const canJoinEmergencyVideoRoom = (emergency: any, authUser: { userId: string; role: string }) => {
  if (authUser.role === "controller-center") {
    return true;
  }

  if (String(emergency.reportedBy) === authUser.userId) {
    return true;
  }

  if (!Array.isArray(emergency.responders)) {
    return false;
  }

  return emergency.responders.some((responder: any) => String(responder.userId) === authUser.userId);
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

    const emergency = await EmergencyModel.findById(emergencyId).select("reportedBy responders status").lean();
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    if (emergency.status === "closed") {
      return res.status(400).json({ error: "Emergency is already closed" });
    }

    if (!canJoinEmergencyVideoRoom(emergency, { userId: authUser.userId, role: authUser.role })) {
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
            role: responder.role === "authority" ? "authority" as const : "volunteer" as const,
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

const haversineDistanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return earthRadiusKm * c;
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

const buildEmergencyDetailsPayload = (emergency: any, actorLocation?: { lat: number; lng: number } | null) => {
  const incident = {
    lat: emergency.location?.coordinates?.[1],
    lng: emergency.location?.coordinates?.[0],
    address: emergency.location?.address,
  };

  const responders = Array.isArray(emergency.responders)
    ? emergency.responders.map((responder: any) => ({
        userId: String(responder.userId),
        role: responder.role,
        status: responder.status,
        joinedAt: responder.joinedAt,
        updatedAt: responder.updatedAt,
        location:
          responder.location?.coordinates?.length === 2
            ? {
                lat: responder.location.coordinates[1],
                lng: responder.location.coordinates[0],
              }
            : null,
      }))
    : [];

  const distanceFromRequesterKm =
    actorLocation && typeof incident.lat === "number" && typeof incident.lng === "number"
      ? haversineDistanceKm(actorLocation, { lat: incident.lat, lng: incident.lng })
      : null;

  return {
    emergencyId: String(emergency._id),
    title: emergency.title,
    description: emergency.description,
    type: emergency.type,
    severity: emergency.severity,
    status: emergency.status,
    relationToVictim: emergency.relationToVictim,
    reportedBy: String(emergency.reportedBy),
    location: incident,
    victimsCount: emergency.victimsCount,
    respondersConnected: responders.length,
    responders,
    victims: emergency.victims || [],
    timeline: emergency.timeline || [],
    createdAt: emergency.createdAt,
    updatedAt: emergency.updatedAt,
    distanceFromRequesterKm,
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
  respondersCount: Array.isArray(emergency.responders) ? emergency.responders.length : 0,
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
    ProfilePublicUserModel.findOne({ userId: reporterId }).select("appContacts contacts").lean(),
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
    ? await PublicUserModel.find({ phoneNumber: { $in: manualContactPhones } }).select("_id").lean()
    : [];
  const manualContactIds = manualContactUsers.map((user) => String(user._id));

  const contactUserIds = uniqueStrings([...contactIdsFromApp, ...manualContactIds].filter((id) => id !== reporterId));

  const contactUsers = contactUserIds.length
    ? await PublicUserModel.find({ _id: { $in: contactUserIds } })
      .select("_id role name phoneNumber avatarUrl")
      .lean()
    : [];

  const allPublicProfileIds = uniqueStrings([...nearbyPublicIds, ...contactUserIds]);
  const publicProfiles = allPublicProfileIds.length
    ? await ProfilePublicUserModel.find({ userId: { $in: allPublicProfileIds } })
      .select("userId name profileImage")
      .lean()
    : [];
  const profileByUserId = new Map(publicProfiles.map((profile) => [String(profile.userId), profile]));

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
  let smsFallbackCount = 0;
  let emailFallbackCount = 0;

  const smsTargets = [
    ...nearbyPublicUsers,
    ...contactUsers.filter((contact) => !nearbyPublicUsers.some((nearby) => String(nearby._id) === String(contact._id))),
  ];

  for (const user of smsTargets) {
    const userId = String(user._id);
    const socketRole = user.role === "volunteer" ? "volunteer" : "public";
    const isOnline = await isSocketUserOnline(socketRole, userId);
    if (isOnline) {
      continue;
    }

    if (!user.phoneNumber) {
      continue;
    }

    try {
      await snsService.sendSMS(
        user.phoneNumber,
        `SafeSphere Emergency Alert\n${emergencyDetailsText}\nRespond in app if available.`,
      );
      smsFallbackCount += 1;
    } catch (error) {
      console.error("Failed to send emergency SMS fallback:", error);
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

  const publicPositions = nearbyPublicIds.length
    ? await redisService.getLocationsByMembers(USER_GEO_KEY, nearbyPublicIds)
    : {};
  const authorityPositions = nearbyAuthorityProfileIds.length
    ? await redisService.getLocationsByMembers(AUTHORITY_GEO_KEY, nearbyAuthorityProfileIds)
    : {};

  const nearbyContactIds = contactUserIds.filter((id) => nearbyPublicIds.includes(id));

  const mapSnapshot = {
    incident: { lat: location.lat, lng: location.lng },
    nearbyUsers: nearbyUserIds
      .map((id) => {
        const user = nearbyPublicUsers.find((item) => String(item._id) === id);
        const profile = profileByUserId.get(id);
        return {
          userId: id,
          role: "public",
          name: profile?.name || user?.name || "Unknown",
          phoneNumber: user?.phoneNumber,
          profileImage: profile?.profileImage || user?.avatarUrl || null,
          ...(publicPositions[id] || {}),
        };
      })
      .filter((item) => typeof item.lat === "number" && typeof item.lng === "number"),
    nearbyVolunteers: nearbyVolunteerIds
      .map((id) => {
        const user = nearbyPublicUsers.find((item) => String(item._id) === id);
        const profile = profileByUserId.get(id);
        return {
          userId: id,
          role: "volunteer",
          name: profile?.name || user?.name || "Unknown",
          phoneNumber: user?.phoneNumber,
          profileImage: profile?.profileImage || user?.avatarUrl || null,
          ...(publicPositions[id] || {}),
        };
      })
      .filter((item) => typeof item.lat === "number" && typeof item.lng === "number"),
    nearbyContacts: nearbyContactIds
      .map((id) => {
        const user = contactUsers.find((item) => String(item._id) === id);
        const profile = profileByUserId.get(id);
        return {
          userId: id,
          role: user?.role || "public",
          name: profile?.name || user?.name || "Unknown",
          phoneNumber: user?.phoneNumber,
          profileImage: profile?.profileImage || user?.avatarUrl || null,
          ...(publicPositions[id] || {}),
        };
      })
      .filter((item) => typeof item.lat === "number" && typeof item.lng === "number"),
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
    contacts: contactUserIds.length,
  };

  io.to(`public:${reporterId}`).emit("emergency-dispatch-update", {
    ...emergencyPayload,
    status: "notifications_sent",
    summary,
    mapSnapshot,
    feed: [
      `Nearby users notified: ${summary.nearbyUsers}`,
      `Nearby volunteers notified: ${summary.nearbyVolunteers}`,
      `Nearby contacts on map: ${mapSnapshot.nearbyContacts.length}`,
      `Nearby authorities notified: ${summary.nearbyAuthorities}`,
      `Controller centers notified: ${summary.controllerCenters}`,
      `Emergency contacts notified: ${summary.contacts}`,
      `SMS fallback sent: ${smsFallbackCount}`,
      `Authority email fallback sent: ${emailFallbackCount}`,
    ],
  });

  return {
    summary,
    mapSnapshot,
    timelineEvent: `Emergency notifications sent to nearby network (SMS fallback: ${smsFallbackCount}, email fallback: ${emailFallbackCount})`,
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

    if (!env.REMOTE_PYTHON_SCRIPT_URL) {
      return res.status(500).json({ error: "REMOTE_PYTHON_SCRIPT_URL is not configured" });
    }

    const endpoint = `${env.REMOTE_PYTHON_SCRIPT_URL.replace(/\/$/, "")}/process-image/emergency`;
    const pythonResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey }),
    });

    if (!pythonResponse.ok) {
      const text = await pythonResponse.text();
      return res.status(502).json({ error: `Face processing failed: ${pythonResponse.status}`, details: text });
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

    if (!matchedUser) {
      matchedUser = await findUserByEmbeddingCandidates([embeddingId]);
      if (!matchMeta) {
        matchMeta = { qdrantUsed: false, reason: "Fallback exact embedding match used" };
      }
    }

    return res.status(200).json({
      embeddingId,
      matchedUser: matchedUser || null,
      similarity: matchMeta,
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
    };

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return res.status(400).json({ error: "title is required (min 3 chars)" });
    }

    if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
      return res.status(400).json({ error: "Valid location (lat, lng) is required" });
    }

    const existingActiveEmergency = await EmergencyModel.findOne({
      reportedBy: new Types.ObjectId(reporterId),
      status: { $in: ACTIVE_EMERGENCY_STATUSES },
    })
      .select("_id status title")
      .lean();

    if (existingActiveEmergency?._id) {
      return res.status(409).json({
        error: "You already have an ongoing emergency. Close it before creating another.",
        emergencyId: String(existingActiveEmergency._id),
      });
    }

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

      victims.push({
        userId: matchedUser?._id,
        name: matchedUser?.name || "Unknown Person",
        age: matchedUser?.age,
        gender: matchedUser?.gender,
        condition: condition || "Emergency victim",
        isPrimary: true,
        contactInfo: matchedUser?.phoneNumber,
        faceImageUrl: strangerFaceKey,
        faceEmbeddingId: faceEmbeddingId,
        status: matchedUser ? "identified" : "unknown",
        confidence: matchedUser ? 0.95 : undefined,
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
      responders: defaultControlCenter?._id
        ? [
            {
              userId: new Types.ObjectId(String(defaultControlCenter._id)),
              role: "authority",
              status: "assigned",
              joinedAt: new Date(),
            },
          ]
        : [],
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

    if (!["public", "volunteer", "authority", "responder", "controller-center"].includes(authUser.role)) {
      return res.status(403).json({ error: "Only public/volunteer/authority/responder/controller-center can accept emergency" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const responderRole =
      authUser.role === "authority" || authUser.role === "responder" || authUser.role === "controller-center"
        ? "authority"
        : "volunteer";
    const responderUserId = new Types.ObjectId(authUser.userId);

    const existingResponder = emergency.responders.find(
      (item) => String(item.userId) === authUser.userId && item.role === responderRole,
    );

    let responderLocation: { type: "Point"; coordinates: [number, number] } | undefined = undefined;

    if (responderRole === "volunteer") {
      const geo = await redisService.getLocationsByMembers(USER_GEO_KEY, [authUser.userId]);
      const current = geo[authUser.userId] as { lat: number; lng: number } | undefined;
      if (typeof current?.lng === "number" && typeof current?.lat === "number") {
        responderLocation = {
          type: "Point",
          coordinates: [current.lng, current.lat],
        };
      }
    } else {
      const authorityProfile = await AuthorityProfileModel.findOne({ userId: authUser.userId })
        .select("_id location")
        .lean();

      if (authorityProfile?._id) {
        const authorityProfileId = String(authorityProfile._id);
        const geo = await redisService.getLocationsByMembers(AUTHORITY_GEO_KEY, [authorityProfileId]);
        const current = geo[authorityProfileId] as { lat: number; lng: number } | undefined;
        const fallback = authorityProfile.location;

        if (typeof current?.lng === "number" && typeof current?.lat === "number") {
          responderLocation = {
            type: "Point",
            coordinates: [current.lng, current.lat],
          };
        } else if (typeof fallback?.lng === "number" && typeof fallback?.lat === "number") {
          responderLocation = {
            type: "Point",
            coordinates: [fallback.lng, fallback.lat],
          };
        }
      }
    }

    if (!existingResponder) {
      emergency.responders.push({
        userId: responderUserId,
        role: responderRole,
        status: "assigned",
        location: responderLocation,
        joinedAt: new Date(),
      });
    }

    emergency.status = "in_progress";
    emergency.timeline.push({
      event: existingResponder ? "Responder already assigned and re-confirmed" : "Responder accepted emergency request",
      timestamp: new Date(),
      actorId: responderUserId,
      meta: {
        responderRole,
        responderUserId: authUser.userId,
        locationTracked: true,
      },
    });
    await emergency.save();

    const io = getGlobalIO();
    const dispatchUpdatePayload = {
      emergencyId: String(emergency._id),
      message: `${authUser.role} responder accepted emergency request`,
      responder: {
        userId: authUser.userId,
        role: responderRole,
      },
      trackingNotice: "Your location activity will be tracked for this emergency response.",
    };

    if (io) {
      io.to(`public:${String(emergency.reportedBy)}`).emit("emergency-dispatch-update", dispatchUpdatePayload);
      io.to("controller-center").emit("emergency-dispatch-update", {
        ...dispatchUpdatePayload,
        controlCenterPrivileges: getControlCenterPrivileges(),
      });

      const ackRoom = responderRole === "authority" ? `authority:${authUser.userId}` : `${responderRole}:${authUser.userId}`;
      io.to(ackRoom).emit("emergency-response-accepted", dispatchUpdatePayload);
    }

    return res.status(200).json({
      message: existingResponder ? "You are already assigned to this emergency" : "Emergency response accepted",
      emergencyId: String(emergency._id),
      trackingNotice: "Your location activity will be tracked for this emergency response.",
      responderRole,
      alreadyAssigned: Boolean(existingResponder),
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
      emergencies: emergencies.map(toEmergencyCard),
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

        return {
          ...toEmergencyCard(emergency),
          respondersConnected: Array.isArray(emergency.responders) ? emergency.responders.length : 0,
          distanceFromRequesterKm,
        };
      })
      .filter((item) => {
        if (authUser.role === "controller-center") return true;
        if (item.distanceFromRequesterKm == null) return true;
        return item.distanceFromRequesterKm <= 30;
      });

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

    const role = authUser.role;
    const isAdmin = ["authority", "responder", "controller-center"].includes(role);
    const isReporter = String(emergency.reportedBy) === authUser.userId;
    const isResponder = Array.isArray(emergency.responders)
      ? emergency.responders.some((responder: any) => String(responder.userId) === authUser.userId)
      : false;

    if (!isAdmin && !isReporter && !isResponder) {
      return res.status(403).json({ error: "Not authorized to view this emergency" });
    }

    const actorLocation = await resolveActorLocation({ userId: authUser.userId, role });
    const payload = buildEmergencyDetailsPayload(emergency, actorLocation);

    return res.status(200).json({
      emergency: payload,
      privileges: role === "controller-center" || isReporter ? getControlCenterPrivileges() : undefined,
    });
  } catch (error) {
    console.error("Error loading emergency by id:", error);
    return res.status(500).json({ error: "Failed to load emergency details" });
  }
};

export const closeEmergencyCase = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (authUser.role !== "controller-center") {
      return res.status(403).json({ error: "Only controller-center can close emergency cases" });
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
      return res.status(200).json({ message: "Emergency case already closed", emergencyId });
    }

    emergency.status = "closed";
    emergency.timeline.push({
      event: "Emergency case closed by control-center",
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: {
        closedByRole: authUser.role,
        closedByUserId: authUser.userId,
      },
    });

    await emergency.save();

    const io = getGlobalIO();
    if (io) {
      const payload = {
        emergencyId,
        status: "closed",
        message: "Emergency case closed by control-center. Camera/audio streaming has been stopped.",
      };

      const reporterId = String(emergency.reportedBy);
      io.to(`public:${reporterId}`).emit("emergency-case-closed", payload);

      for (const responder of emergency.responders || []) {
        const responderId = String(responder.userId);
        if (responder.role === "authority") {
          io.to(`authority:${responderId}`).emit("emergency-case-closed", payload);
          io.to(`responder:${responderId}`).emit("emergency-case-closed", payload);
          io.to(`controller-center:${responderId}`).emit("emergency-case-closed", payload);
        } else {
          io.to(`volunteer:${responderId}`).emit("emergency-case-closed", payload);
          io.to(`public:${responderId}`).emit("emergency-case-closed", payload);
        }
      }

      io.to("controller-center").emit("emergency-case-closed", payload);
    }

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

export const leaveEmergencyCase = async (req: Request, res: Response) => {
  try {
    const authUser = req.authUser;
    if (!authUser?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Only responder, authority, and volunteer can leave
    const allowedRoles = ["responder", "authority", "volunteer"];
    if (!allowedRoles.includes(authUser.role)) {
      return res.status(403).json({ error: "Only responders, authority, and volunteers can leave emergency cases" });
    }

    const emergencyId = String(req.params.emergencyId || "");
    if (!Types.ObjectId.isValid(emergencyId)) {
      return res.status(400).json({ error: "Invalid emergency id" });
    }

    const emergency = await EmergencyModel.findById(emergencyId);
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    // Prevent reporter from leaving their own case
    if (String(emergency.reportedBy) === authUser.userId) {
      return res.status(403).json({ error: "Reporter cannot leave their own emergency case" });
    }

    // Check if user is in responders array
    const responderIndex = Array.isArray(emergency.responders)
      ? emergency.responders.findIndex((r: any) => String(r.userId) === authUser.userId)
      : -1;

    if (responderIndex === -1) {
      return res.status(400).json({ error: "User is not a responder on this emergency" });
    }

    // Remove responder from array
    emergency.responders.splice(responderIndex, 1);

    // Add to timeline
    emergency.timeline.push({
      event: `${authUser.role} left emergency case`,
      timestamp: new Date(),
      actorId: new Types.ObjectId(authUser.userId),
      meta: {
        leftByRole: authUser.role,
        leftByUserId: authUser.userId,
      },
    });

    await emergency.save();

    console.log(`[Emergency] ${authUser.role} ${authUser.userId} left emergency ${emergencyId}`);

    const io = getGlobalIO();
    if (io) {
      const payload = {
        emergencyId,
        userId: authUser.userId,
        role: authUser.role,
        message: `${authUser.role} has left the emergency case`,
      };

      // Notify control center
      io.to("controller-center").emit("emergency-responder-left", payload);
      
      // Notify other responders
      io.to(`stream:emergency:${emergencyId}`).emit("emergency-responder-left", payload);
    }

    return res.status(200).json({
      message: `Successfully left emergency case`,
      emergencyId,
      remainingResponders: emergency.responders?.length || 0,
    });
  } catch (error) {
    console.error("Error leaving emergency case:", error);
    return res.status(500).json({ error: "Failed to leave emergency case" });
  }
};
