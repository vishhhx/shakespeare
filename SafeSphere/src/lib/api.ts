import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';
console.log('API Base URL:', config.apiBaseUrl);
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

export type PublicProfilePayload = {
  name: string;
  profileImage?: string;
  contacts: Array<{
    name: string;
    phoneNumber: string;
    relation?: string;
    isPrimary?: boolean;
  }>;
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
  documents: Array<{ name: string; url: string }>;
  preferredRoles: Array<"medical" | "rescue" | "logistics" | "general">;
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

export async function getS3UploadUrl(payload: { key: string; contentType?: string }) {
  const response = await api.post("/public-user/upload-url", payload);
  return response.data as { url: string };
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
