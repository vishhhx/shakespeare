// Call shapes from backend/src/models/call/call.service.ts → toCallView (twin of web/src/services/callServices.ts).

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

export type MediaPayload = { token: string; mediaUrl: string; expiresIn: number; roomId: string };
