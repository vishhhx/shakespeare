// Shapes returned by the emergency API. Mirrors backend/src/models/emergency/emergency.controller.ts
// (buildEmergencyDetailsPayload) and emergency.permissions.ts. Authorization is decided on the
// server; screens only read `viewer.permissions`.

export type EmergencyType = "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
export type EmergencySeverity = "low" | "medium" | "high" | "critical";
export type EmergencyStatus = "reported" | "verified" | "in_progress" | "resolved" | "closed";
export type ActorRole = "public" | "volunteer" | "responder" | "authority" | "controller-center";
export type ResponderStatus = "assigned" | "enroute" | "on_scene" | "completed";

export type LatLng = { lat: number; lng: number };

export type CasePermissions = {
  canView: boolean;
  canPreview: boolean;
  canAccept: boolean;
  canLeave: boolean;
  canFlagFake: boolean;
  canVerify: boolean;
  canResolve: boolean;
  canClose: boolean;
  canAwardPoints: boolean;
  canAssignResponders: boolean;
  canUpdateOwnStatus: boolean;
  canShareLocation: boolean;
  canViewMedical: boolean;
  canViewContacts: boolean;
  canJoinVideo: boolean;
};

export type Organization = {
  authorityProfileId: string;
  name: string;
  type: string;
  contactNumber?: string;
  /** The organisation's registered station (not a person's live position). */
  location?: LatLng | null;
};

export type CaseResponder = {
  userId: string;
  actorRole: ActorRole;
  name: string;
  organization: Organization | null;
  phoneNumber?: string;
  status: ResponderStatus;
  assignedByRole?: "authority" | "controller-center";
  joinedAt?: string;
  updatedAt?: string;
  location: LatLng | null;
  locationUpdatedAt: string | null;
  isMe: boolean;
};

export type MedicalRecord = {
  bloodGroup?: string;
  allergies?: string[];
  medications?: string[];
  diseases?: string[];
  notes?: string;
};

export type CaseDetails = {
  emergencyId: string;
  title: string;
  description?: string;
  type: EmergencyType;
  severity: EmergencySeverity;
  status: EmergencyStatus;
  isFake: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** updatedAt in ms; socket notifications older than this are ignored. */
  version: number;
  incident: (LatLng & { address?: string; reportedAt?: string }) | null;
  victimsCount?: number;
  respondersConnected: number;
  distanceFromRequesterKm: number | null;
  viewer: {
    userId: string;
    role: ActorRole;
    isReporter: boolean;
    isResponder: boolean;
    isReporterContact: boolean;
    hasFlagged: boolean;
    permissions: CasePermissions;
  };
  /** True when the viewer may only preview (nearby helper who hasn't joined). */
  preview: boolean;
  relationToVictim?: "self" | "family" | "bystander" | "authority";
  reporter?: {
    userId: string;
    name: string;
    phoneNumber?: string;
    profileImage?: string | null;
    liveLocation: (LatLng & { updatedAt: string }) | null;
  };
  subject?: {
    /** Preview mode only. */
    label?: string;
    isReporter?: boolean;
    userId?: string;
    name?: string;
    identification?: "identified" | "unknown";
    matchConfidence?: number;
    age?: number;
    gender?: string;
    condition?: string;
    medicalRecord?: MedicalRecord;
    contacts?: { name: string; phoneNumber: string; relation?: string; isPrimary?: boolean }[];
    sosMessage?: string;
  };
  responders?: CaseResponder[];
  monitoredByControlCenter?: boolean;
  responsibleAuthority?: Organization | null;
  media?: { type: "image" | "video" | "audio"; url: string; signedUrl?: string }[];
  timeline?: { event: string; timestamp: string; actorName?: string; actorRole?: string }[];
  fakeReports?: { count: number; threshold: number };
};

export type EmergencyCard = {
  emergencyId: string;
  title: string;
  description?: string;
  type: EmergencyType;
  severity: EmergencySeverity;
  status: EmergencyStatus;
  reportedBy: string;
  location?: { lat?: number; lng?: number; address?: string };
  victimsCount?: number;
  respondersCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ActiveCases = {
  asReporter: EmergencyCard | null;
  asResponder: (EmergencyCard & { myStatus: ResponderStatus })[];
};

/** Payload of the `emergency-case-updated` socket event. */
export type CaseUpdatedEvent = {
  emergencyId: string;
  status: EmergencyStatus;
  reason: string;
  version: number;
  userId?: string;
};

/** Payload of the `emergency-location-update` socket event. */
export type CaseLocationEvent = {
  emergencyId: string;
  userId: string;
  party: "reporter" | "responder";
  lat: number;
  lng: number;
  recordedAt: string;
};

export const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
  medical: "Medical",
  accident: "Accident",
  fire: "Fire",
  crime: "Crime",
  missing_child: "Missing child",
  other: "Other",
};

export const SEVERITY_LABELS: Record<EmergencySeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const STATUS_LABELS: Record<EmergencyStatus, string> = {
  reported: "Reported",
  verified: "Verified",
  in_progress: "Help on the way",
  resolved: "Resolved",
  closed: "Closed",
};

export const RESPONDER_STATUS_LABELS: Record<ResponderStatus, string> = {
  assigned: "Assigned",
  enroute: "On the way",
  on_scene: "On scene",
  completed: "Finished",
};

/** People-facing names for roles: never just "User" or "Responder" when we know more. */
export const ROLE_LABELS: Record<ActorRole, string> = {
  public: "Community helper",
  volunteer: "Volunteer",
  responder: "Field responder",
  authority: "Authority",
  "controller-center": "Control center",
};
