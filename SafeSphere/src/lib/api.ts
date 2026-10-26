import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';
import type {
  ActiveCases,
  ActorRole,
  CaseDetails,
  CasePermissions,
  EmergencyCard,
  EmergencySeverity,
  EmergencyType,
  LatLng,
  ResponderStatus,
} from './emergencyTypes';
console.log('API Base URL:', config.apiBaseUrl);
console.log('API Fallback URL:', config.fallbackApiBaseUrl);
export const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 15000,
});

api.interceptors.request.use(async (requestConfig) => {
  const token = await AsyncStorage.getItem('authToken');
  if (token) {
    requestConfig.headers = requestConfig.headers ?? {};
    (requestConfig.headers as any).Authorization = `Bearer ${token}`;
  }
  return requestConfig;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error?.config;
    const isNetworkError = !error?.response;

    if (originalRequest && isNetworkError && !originalRequest.__fallbackRetry && config.fallbackApiBaseUrl && config.fallbackApiBaseUrl !== config.apiBaseUrl) {
      originalRequest.__fallbackRetry = true;
      originalRequest.baseURL = config.fallbackApiBaseUrl;
      console.warn('[API] Primary backend unreachable. Retrying on fallback backend:', config.fallbackApiBaseUrl);
      return api(originalRequest);
    }

    return Promise.reject(error);
  },
);

export type PublicProfilePayload = {
  name: string;
  age?: number;
  gender?: "male" | "female" | "other";
  profileImage?: string;
  userType?: "medical" | "fire" | "police" | "ngo" | "other";
  faceEmbeddingPhoto: string;
  /** ISO timestamp of the user's consent to biometric use of the face photo. */
  faceConsentAt?: string;
  contacts: {
    name: string;
    phoneNumber: string;
    relation?: string;
    isPrimary?: boolean;
  }[];
  appContacts?: string[];
  medicalRecord: {
    bloodGroup: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
    allergies?: string[];
    medications?: string[];
    diseases?: string[];
    notes?: string;
  };
  sosMessage?: string;
  autoShareMedical?: boolean;
  location?: { lat: number; lng: number };
  enableContinuousTracking?: boolean;
};

export type VolunteerApplicationPayload = {
  skills: string[];
  experience?: string;
  documents: { name: string; url: string }[];
  preferredRoles: ("medical" | "rescue" | "logistics" | "general")[];
  availability: { isAvailable: boolean; timeSlots?: string[] };
  location: { lat: number; lng: number };
};

export async function upsertPublicProfile(payload: PublicProfilePayload) {
  const response = await api.post("/public-user/profile", payload);
  return response.data;
}

export async function getPublicProfile() {
  const response = await api.get("/public-user/profile");
  return response.data as {
    profile: {
      name?: string;
      phoneNumber?: string;
      profileImage?: string;
      profileImageSignedUrl?: string;
      userType?: "medical" | "fire" | "police" | "ngo" | "other";
      contacts?: { name: string; phoneNumber: string; relation?: string }[];
      medicalRecord?: {
        bloodGroup?: string;
        allergies?: string[];
        medications?: string[];
        diseases?: string[];
        notes?: string;
      };
      sosMessage?: string;
      autoShareMedical?: boolean;
      enableContinuousTracking?: boolean;
    };
    gamification?: {
      points: number;
    };
    accountStatus?: {
      isPermanentlyBlocked: boolean;
      fraudFlagCount: number;
      permanentlyBlockedAt?: string | null;
      permanentBlockReason?: string;
    };
  };
}

export async function getAppUsers() {
  const response = await api.get("/public-user/app-users");
  return response.data as {
    users: {
      userId: string;
      name: string;
      phoneNumber: string;
      role: string;
      isVerified: boolean;
      isprofileComplete: boolean;
      profileImage?: string | null;
      profileImageSignedUrl?: string | null;
    }[];
  };
}

export async function getS3UploadUrl(payload: {
  key: string;
  contentType?: string;
  bucket?: "profile" | "face" | "voice";
}) {
  const response = await api.post("/public-user/upload-url", payload);
  // `key` is the server-chosen object key (face uploads ignore the requested key).
  return response.data as { url: string; key?: string };
}

/** Turns axios / fetch failures into one short, user-facing sentence. */
export function getApiErrorMessage(error: any, fallback = "Something went wrong. Please try again."): string {
  if (error?.code === "ECONNABORTED" || /timeout/i.test(String(error?.message ?? ""))) {
    return "The request timed out. Check your connection and try again.";
  }
  if (error?.isAxiosError && !error?.response) {
    return "Can't reach SafeSphere right now. Check your connection and try again.";
  }
  const status = error?.response?.status;
  if (status === 401) {
    return "Your session has expired. Please sign in again.";
  }
  const serverMessage = error?.response?.data?.error;
  if (typeof serverMessage === "string" && serverMessage.trim()) {
    return serverMessage;
  }
  if (typeof error?.message === "string" && error.message && !error?.isAxiosError) {
    return error.message;
  }
  return fallback;
}

const UPLOAD_TIMEOUT_MS = 30000;
// Must match MAX_PHOTO_BYTES in backend/src/models/ProfilePublicUser/profile.controller.ts.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Uploads a local image to S3 through a short-lived presigned URL issued by the backend.
 * Returns the object key the server assigned.
 */
export async function uploadImage(params: { uri: string; bucket: "profile" | "face"; key: string }) {
  const file = await fetch(params.uri);
  const blob = await file.blob();
  if (blob.size > MAX_PHOTO_BYTES) {
    throw new Error("This photo is larger than 5 MB. Please take or choose a smaller one.");
  }

  const { url, key } = await getS3UploadUrl({ key: params.key, contentType: "image/jpeg", bucket: params.bucket });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Upload failed. Please try again.");
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("The upload timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return key ?? params.key;
}

export async function enqueueVoiceEmergencyAnalysis(fileKey: string) {
  const response = await api.post("/public-user/emergency/voice/enqueue", { fileKey });
  return response.data as {
    status: "queued";
    fileKey: string;
    messageId?: string;
  };
}

export async function getVoiceEmergencyAnalysis(fileKey: string) {
  const response = await api.get("/public-user/emergency/voice/analysis", {
    params: { fileKey },
  });

  return response.data as {
    status: "pending" | "success" | "failed";
    analysis?: {
      reportedBy?: string;
      severity?: "low" | "medium" | "high" | "critical";
      status?: string;
      type?: "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
    };
    fileKey?: string;
    fileName?: string;
    transcribedText?: string;
    processedAt?: string;
  };
}

export async function chatWithEmergencyBot(payload: {
  message: string;
  session?: boolean;
  sessionId?: string;
  emergencyId?: string;
}) {
  const response = await api.post("/public-user/emergency/chatbot", payload);
  return response.data as {
    status: "success" | "error";
    sessionId: string;
    message: string;
    suggestedVideo?: string;
    raw?: Record<string, any>;
  };
}

export async function getS3ReadUrl(key: string) {
  const response = await api.post("/public-user/read-url", { key });
  return response.data as { url: string };
}

export async function processEmergencyStrangerPhoto(fileKey: string) {
  const response = await api.post("/public-user/emergency/process-stranger", { fileKey });
  return response.data as {
    embeddingId: string;
    matchedUser: {
      userId: string;
      name: string;
      phoneNumber: string;
      age?: number;
      gender?: "male" | "female" | "other";
      profileImage?: string | null;
      contacts?: {
        name: string;
        phoneNumber: string;
        relation?: string;
        isPrimary?: boolean;
      }[];
      medicalRecord?: {
        bloodGroup?: string;
        allergies?: string[];
        medications?: string[];
        diseases?: string[];
        notes?: string;
      };
      sosMessage?: string;
    } | null;
    /** "possible": a suggestion the reporter must confirm. Never a verified identity. */
    matchKind: "possible" | "none";
    similarity?: {
      qdrantUsed?: boolean;
      reason?: string;
      matchedScore?: number;
      minSimilarity?: number;
    };
  };
}

export type InitiateEmergencyPayload = {
  title: string;
  description?: string;
  type: EmergencyType;
  severity: EmergencySeverity;
  relationToVictim: "self" | "family" | "bystander" | "authority";
  isForSelf: boolean;
  location: { lat: number; lng: number; address?: string };
  victimsCount?: number;
  condition?: string;
  strangerFaceKey?: string;
  faceEmbeddingId?: string;
  identifiedUserId?: string;
  incidentMedia?: { key: string; type: "image" | "video" | "audio" }[];
  /** Same value on retries of one SOS, so the server returns the case it already created. */
  clientRequestId: string;
};

export type InitiateEmergencyResult =
  | { kind: "created"; emergencyId: string; dispatch?: DispatchResult }
  | { kind: "existing"; emergencyId: string; message: string };

export type DispatchResult = {
  summary?: {
    nearbyUsers: number;
    nearbyVolunteers: number;
    nearbyAuthorities: number;
    controllerCenters: number;
    contacts: number;
    contactSms?: number;
    smsFallback?: number;
    emailFallback?: number;
  };
  mapSnapshot?: {
    incident: LatLng;
    nearbyAuthorities: { lat: number; lng: number; authorityProfileId?: string; authorityType?: string }[];
  };
  timelineEvent?: string;
};

/** A new id per SOS attempt; reuse it when retrying that same attempt. */
export const newClientRequestId = () =>
  `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Sends an SOS. An already-open case (409 ACTIVE_CASE_EXISTS) or a replayed request is returned
 * as `existing`, so callers can open that case instead of showing an error.
 */
export async function initiateEmergency(payload: InitiateEmergencyPayload): Promise<InitiateEmergencyResult> {
  try {
    const response = await api.post("/public-user/emergency/initiate", payload, { timeout: 20000 });
    if (response.data?.replayed) {
      return { kind: "existing", emergencyId: response.data.emergencyId, message: "Your emergency was already sent." };
    }
    return { kind: "created", emergencyId: response.data.emergencyId, dispatch: response.data.dispatch };
  } catch (error: any) {
    const data = error?.response?.data;
    if (error?.response?.status === 409 && data?.emergencyId) {
      return { kind: "existing", emergencyId: String(data.emergencyId), message: data.error };
    }
    throw error;
  }
}

export async function acceptEmergencyResponse(emergencyId: string, location?: LatLng | null) {
  const response = await api.post("/public-user/emergency/respond", { emergencyId, location: location ?? undefined });
  return response.data as {
    message: string;
    emergencyId: string;
    trackingNotice: string;
    responderRole: ActorRole;
    alreadyAssigned: boolean;
  };
}

export async function leaveEmergencyCase(emergencyId: string, reason?: string) {
  const response = await api.patch(`/public-user/emergency/${emergencyId}/leave`, { reason });
  return response.data as { message: string; emergencyId: string; remainingResponders: number };
}

export async function flagEmergencyAsFake(emergencyId: string, reason?: string) {
  const response = await api.post(`/public-user/emergency/${emergencyId}/flag-fake`, { reason });
  return response.data as {
    message: string;
    uniqueFlags: number;
    threshold: number;
    reporterBlocked?: boolean;
    emergencyMarkedFake?: boolean;
  };
}

export async function updateMyResponderStatus(emergencyId: string, status: Exclude<ResponderStatus, "assigned">) {
  const response = await api.patch(`/public-user/emergency/${emergencyId}/responder-status`, { status });
  return response.data as { emergencyId: string; status: ResponderStatus };
}

export async function shareCaseLocation(emergencyId: string, location: LatLng & { recordedAt: string }) {
  const response = await api.post(`/public-user/emergency/${emergencyId}/location`, location, { timeout: 10000 });
  return response.data as { emergencyId: string; recordedAt?: string; stale?: boolean };
}

export async function getMyActiveEmergency() {
  const response = await api.get("/public-user/emergency/active");
  return response.data as ActiveCases;
}

export async function getNearbyOngoingEmergencies(params: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}) {
  const response = await api.get("/public-user/emergency/ongoing-nearby", {
    params,
  });

  return response.data as {
    count: number;
    radiusKm: number;
    emergencies: (EmergencyCard & { isMine: boolean; amResponding: boolean; distanceKm: number })[];
  };
}

/** `near` lets a nearby helper preview a case they haven't joined yet. */
export async function getEmergencyById(emergencyId: string, near?: LatLng | null) {
  const response = await api.get(`/public-user/emergency/${emergencyId}`, {
    params: near ? { lat: near.lat, lng: near.lng } : undefined,
  });
  return response.data as { emergency: CaseDetails; permissions: CasePermissions };
}

export async function getEmergencyVideoToken(emergencyId: string) {
  const response = await api.post(`/public-user/emergency/${emergencyId}/video/token`);
  return response.data as {
    emergencyId: string;
    roomName: string;
    identity: string;
    token: string;
    expiresIn: number;
    participants: { userId: string; role: "reporter" | "volunteer" | "authority" | "controller-center" }[];
  };
}

export async function applyVolunteer(payload: VolunteerApplicationPayload) {
  const response = await api.post("/public-user/apply-volunteer", payload);
  return response.data;
}

export async function getMyVolunteerApplication() {
  const response = await api.get("/public-user/volunteer-application");
  return response.data;
}

export async function updateUserLocation(location: { lat: number; lng: number }) {
  const response = await api.post("/public-user/location", { location });
  return response.data;
}
