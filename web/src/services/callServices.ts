import { axiosInstance } from "@/utils/axiosInstance";
import type { MediaCredentials } from "@/lib/mediaCall";

const base = "/api/admin-user/calls";

export type CallInviteStatus = "caller" | "invited" | "accepted" | "declined" | "expired" | "cancelled";
export type CallConnectionState = "not_joined" | "connected" | "reconnecting" | "left";

export type CallParticipantView = {
  userId: string;
  role: "public" | "volunteer" | "responder" | "authority" | "controller-center";
  name: string;
  organization: string | null;
  inviteStatus: CallInviteStatus;
  invitedByRole: string | null;
  invitedAt: string | null;
  connection: CallConnectionState;
  joinedAt: string | null;
  leftAt: string | null;
  isMe: boolean;
};

/** Call as returned by backend/src/models/call/call.service.ts → toCallView. */
export type CallView = {
  callId: string;
  emergencyId: string;
  status: "ringing" | "active" | "ended" | "failed";
  version: number;
  createdAt: string;
  answeredBy: { userId: string; name: string; at: string } | null;
  declinedBy: { userId: string; name: string; at: string }[];
  endedAt: string | null;
  endReason: string | null;
  emergency: {
    title: string;
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    status: string;
    createdAt: string;
    reporterName: string;
    location: { lat: number; lng: number; address?: string } | null;
  } | null;
  participants: CallParticipantView[];
  me: { role: string; inviteStatus: CallInviteStatus; connection: CallConnectionState } | null;
};

export type InviteCandidate = { userId: string; role: CallParticipantView["role"]; name: string; organization?: string; detail?: string };

type MediaPayload = MediaCredentials & { expiresIn: number; roomId: string };

/** Emergency-call API for the admin web (token attached by the axios interceptor). */
export const CallServices = {
  async incoming() {
    return (await axiosInstance.get(`${base}/incoming`)).data as { calls: CallView[] };
  },
  async mine() {
    return (await axiosInstance.get(`${base}/mine`)).data as { calls: CallView[] };
  },
  async forEmergency(emergencyId: string) {
    return (await axiosInstance.get(`${base}/by-emergency/${emergencyId}`)).data as { call: CallView | null };
  },
  async get(callId: string) {
    return (await axiosInstance.get(`${base}/${callId}`)).data as { call: CallView };
  },
  async start(emergencyId: string) {
    return (await axiosInstance.post(`${base}/start`, { emergencyId })).data as { call: CallView; created: boolean };
  },
  async answer(callId: string) {
    return (await axiosInstance.post(`${base}/${callId}/answer`)).data as { call: CallView; media: MediaPayload };
  },
  async decline(callId: string) {
    return (await axiosInstance.post(`${base}/${callId}/decline`)).data as { call: CallView };
  },
  async invitable(callId: string) {
    return (await axiosInstance.get(`${base}/${callId}/invitable`)).data as { candidates: InviteCandidate[] };
  },
  async invite(callId: string, userId: string) {
    return (await axiosInstance.post(`${base}/${callId}/invite`, { userId })).data as { call: CallView };
  },
  async respond(callId: string, accept: boolean) {
    return (await axiosInstance.post(`${base}/${callId}/respond`, { accept })).data as { call: CallView; media?: MediaPayload };
  },
  async token(callId: string) {
    return (await axiosInstance.post(`${base}/${callId}/token`)).data as { media: MediaPayload };
  },
  async leave(callId: string) {
    return (await axiosInstance.post(`${base}/${callId}/leave`)).data as { call: CallView };
  },
  async end(callId: string) {
    return (await axiosInstance.post(`${base}/${callId}/end`)).data as { call: CallView };
  },
};
