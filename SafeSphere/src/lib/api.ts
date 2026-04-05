import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';
console.log('API Base URL:', config.apiBaseUrl);
console.log('API Fallback URL:', config.fallbackApiBaseUrl);
export const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 15000,
});

api.interceptors.request.use(async (requestConfig) => {
  const token = await AsyncStorage.getItem('authToken');
  console.log('Retrieved token from AsyncStorage:', token);
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
  return response.data;
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
  return response.data as { url: string };
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
    similarity?: {
      qdrantUsed?: boolean;
      reason?: string;
      collection?: string;
      matchedScore?: number;
      candidates?: string[];
    };
  };
}

export async function initiateEmergency(payload: {
  title: string;
  description?: string;
  type: "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
  severity: "low" | "medium" | "high" | "critical";
  relationToVictim: "self" | "family" | "bystander" | "authority";
  isForSelf: boolean;
  location: { lat: number; lng: number; address?: string };
  victimsCount?: number;
  condition?: string;
  strangerFaceKey?: string;
  faceEmbeddingId?: string;
  identifiedUserId?: string;
}) {
  const response = await api.post("/public-user/emergency/initiate", payload);
  return response.data as {
    message: string;
    emergencyId: string;
    emergency: any;
    dispatch?: {
      summary?: {
        nearbyUsers: number;
        nearbyVolunteers: number;
        nearbyAuthorities: number;
        controllerCenters: number;
        contacts: number;
      };
      mapSnapshot?: {
        incident: { lat: number; lng: number };
        nearbyUsers: { lat: number; lng: number; userId?: string; role?: string; name?: string; phoneNumber?: string; profileImage?: string | null }[];
        nearbyVolunteers: { lat: number; lng: number; userId?: string; role?: string; name?: string; phoneNumber?: string; profileImage?: string | null }[];
        nearbyContacts: { lat: number; lng: number; userId?: string; role?: string; name?: string; phoneNumber?: string; profileImage?: string | null }[];
        nearbyAuthorities: { lat: number; lng: number; authorityProfileId?: string; authorityType?: string }[];
      };
      timelineEvent?: string;
    };
    nextStep: string;
  };
}

export async function acceptEmergencyResponse(emergencyId: string) {
  const response = await api.post("/public-user/emergency/respond", { emergencyId });
  return response.data as {
    message: string;
    emergencyId: string;
    trackingNotice: string;
    responderRole: "volunteer" | "authority";
    alreadyAssigned: boolean;
  };
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
    emergencies: {
      emergencyId: string;
      title: string;
      description?: string;
      type: "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
      severity: "low" | "medium" | "high" | "critical";
      status: "reported" | "verified" | "in_progress" | "resolved" | "closed";
      reportedBy: string;
      location?: { lat?: number; lng?: number; address?: string };
      victimsCount?: number;
      respondersCount: number;
      createdAt?: string;
      updatedAt?: string;
    }[];
  };
}

export async function getEmergencyById(emergencyId: string) {
  const response = await api.get(`/public-user/emergency/${emergencyId}`);
  return response.data as {
    emergency: {
      emergencyId: string;
      title: string;
      description?: string;
      type: "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
      severity: "low" | "medium" | "high" | "critical";
      status: "reported" | "verified" | "in_progress" | "resolved" | "closed";
      relationToVictim?: "self" | "family" | "bystander" | "authority";
      location?: { lat?: number; lng?: number; address?: string };
      victimsCount?: number;
      respondersConnected: number;
      responders: {
        userId: string;
        role: "volunteer" | "authority";
        status: "assigned" | "enroute" | "on_scene" | "completed";
        location?: { lat?: number; lng?: number } | null;
        joinedAt?: string;
      }[];
      victims?: any[];
      timeline?: any[];
      distanceFromRequesterKm?: number | null;
      createdAt?: string;
      updatedAt?: string;
    };
    privileges?: {
      canEditCase?: boolean;
      canCloseCase?: boolean;
      canBroadcastUpdates?: boolean;
      canViewReporterDetails?: boolean;
    };
  };
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
