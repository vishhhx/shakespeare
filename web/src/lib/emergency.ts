// Emergency shapes and display rules for the admin web. Mirrors the backend payload
// (backend/src/models/emergency/emergency.controller.ts → buildEmergencyDetailsPayload) and the
// permission rules in emergency.permissions.ts. The server decides what each viewer may do.

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
  location: LatLng | null;
  locationUpdatedAt: string | null;
  isMe: boolean;
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
  version: number;
  incident: (LatLng & { address?: string; reportedAt?: string }) | null;
  victimsCount?: number;
  respondersConnected: number;
  distanceFromRequesterKm: number | null;
  preview: boolean;
  viewer: {
    userId: string;
    role: ActorRole;
    isReporter: boolean;
    isResponder: boolean;
    hasFlagged: boolean;
    permissions: CasePermissions;
  };
  relationToVictim?: "self" | "family" | "bystander" | "authority";
  reporter?: {
    userId: string;
    name: string;
    phoneNumber?: string;
    liveLocation: (LatLng & { updatedAt: string }) | null;
  };
  subject?: {
    isReporter?: boolean;
    name?: string;
    identification?: "identified" | "unknown";
    matchConfidence?: number;
    age?: number;
    gender?: string;
    condition?: string;
    medicalRecord?: { bloodGroup?: string; allergies?: string[]; medications?: string[]; diseases?: string[]; notes?: string };
    contacts?: { name: string; phoneNumber: string; relation?: string }[];
    sosMessage?: string;
  };
  responders?: CaseResponder[];
  monitoredByControlCenter?: boolean;
  responsibleAuthority?: Organization | null;
  media?: { type: "image" | "video" | "audio"; url: string; signedUrl?: string }[];
  timeline?: { event: string; timestamp: string; actorName?: string; actorRole?: string }[];
  fakeReports?: { count: number; threshold: number };
  pointsAwards?: { userId: string; points: number; awardedByRole: string; note?: string; awardedAt: string }[];
};

export type DirectiveCase = {
  emergencyId: string;
  title: string;
  description?: string;
  type: EmergencyType;
  severity: EmergencySeverity;
  status: EmergencyStatus;
  location?: { lat?: number; lng?: number; address?: string };
  victimsCount?: number;
  respondersConnected?: number;
  respondersCount?: number;
  distanceFromRequesterKm?: number | null;
  assignedToMe?: boolean;
  myStatus?: ResponderStatus | null;
  createdAt?: string;
  updatedAt?: string;
};

export const TYPE_LABELS: Record<EmergencyType, string> = {
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
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const RESPONDER_STATUS_LABELS: Record<ResponderStatus, string> = {
  assigned: "Assigned",
  enroute: "En route",
  on_scene: "On scene",
  completed: "Finished",
};

export const ROLE_LABELS: Record<ActorRole, string> = {
  public: "Community helper",
  volunteer: "Volunteer",
  responder: "Field responder",
  authority: "Authority",
  "controller-center": "Control center",
};

export const LIFECYCLE: EmergencyStatus[] = ["reported", "verified", "in_progress", "resolved", "closed"];

export const SEVERITY_ORDER: Record<EmergencySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Tailwind classes per state; one colour meaning across the admin UI. */
export const STATUS_CLASSES: Record<EmergencyStatus, string> = {
  reported: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  verified: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  resolved: "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900",
  closed: "bg-muted text-muted-foreground ring-border",
};

export const SEVERITY_CLASSES: Record<EmergencySeverity, string> = {
  low: "bg-muted text-muted-foreground ring-border",
  medium: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  high: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  critical: "bg-red-600 text-white ring-red-600",
};

export const timeAgo = (iso?: string | null) => {
  if (!iso) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

/** A shared position older than this is shown as stale. */
export const STALE_AFTER_MS = 3 * 60 * 1000;
export const isStale = (iso?: string | null) => !iso || Date.now() - new Date(iso).getTime() > STALE_AFTER_MS;

export const errorMessage = (error: unknown, fallback = "Something went wrong.") => {
  const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error || data?.message || (error instanceof Error ? error.message : fallback);
};

export type MapMarkerKind = "incident" | "reporter" | "responder" | "authority";

/** Marker colours on admin maps (pins, circles and squares share them with the legends). */
export const MARKER_COLORS: Record<MapMarkerKind, string> = {
  incident: "#DC2626",
  reporter: "#1D4ED8",
  responder: "#15803D",
  authority: "#B45309",
};
