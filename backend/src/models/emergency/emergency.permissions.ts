// Single source of truth for who may do what on an emergency case.
// Controllers enforce these rules, and the case-details payload reports them to clients
// (`viewer.permissions`) so the apps never re-derive authorization on their own.

export type ActorRole = "public" | "volunteer" | "responder" | "authority" | "controller-center";
export type EmergencyStatus = "reported" | "verified" | "in_progress" | "resolved" | "closed";

export const APP_ROLES: ActorRole[] = ["public", "volunteer"];
export const ADMIN_ROLES: ActorRole[] = ["responder", "authority", "controller-center"];
export const ACTIVE_STATUSES: EmergencyStatus[] = ["reported", "verified", "in_progress"];

/** Authorities and responders see (and may act on) cases within this distance of them. */
export const ADMIN_CASE_RADIUS_KM = 30;
/** App users can preview open cases within this distance before offering help. */
export const APP_PREVIEW_RADIUS_KM = 10;

export const isAdminRole = (role: string): boolean => ADMIN_ROLES.includes(role as ActorRole);
export const isAppRole = (role: string): boolean => APP_ROLES.includes(role as ActorRole);
export const isActiveStatus = (status: string): boolean => ACTIVE_STATUSES.includes(status as EmergencyStatus);

/** Responder entries written before `actorRole` existed only stored "volunteer" or "authority". */
export const responderActorRole = (responder: { role?: string; actorRole?: string }): ActorRole => {
  if (responder.actorRole) return responder.actorRole as ActorRole;
  return responder.role === "authority" ? "authority" : "volunteer";
};

/** The legacy `role` value stored alongside `actorRole`. */
export const legacyResponderRole = (actorRole: ActorRole): "volunteer" | "authority" =>
  isAdminRole(actorRole) ? "authority" : "volunteer";

/** Socket rooms a responder entry can be reached in (legacy entries fan out to every admin room). */
export const responderSocketRooms = (responder: { userId: unknown; role?: string; actorRole?: string }): string[] => {
  const userId = String(responder.userId);
  if (responder.actorRole) return [`${responder.actorRole}:${userId}`];
  return responder.role === "authority"
    ? [`authority:${userId}`, `responder:${userId}`, `controller-center:${userId}`]
    : [`volunteer:${userId}`, `public:${userId}`];
};

export type CaseActor = { userId: string; role: ActorRole };

export type CaseSubject = {
  status: EmergencyStatus;
  reportedBy: unknown;
  responders?: Array<{ userId: unknown; role?: string; actorRole?: string }>;
  fakeFlags?: Array<{ flaggedBy: unknown }>;
};

export type CaseRelation = {
  isReporter: boolean;
  isResponder: boolean;
  /** Admin within ADMIN_CASE_RADIUS_KM, or whose location is unknown (matches the directive list). */
  isAdminInArea: boolean;
  /** App user within APP_PREVIEW_RADIUS_KM of the incident. */
  isAppUserNearby: boolean;
  hasFlagged: boolean;
  /** The reporter listed this user as an emergency contact (they were alerted directly). */
  isReporterContact: boolean;
};

export type CasePermissions = {
  /** Full details: people, medical notes the subject allows, timeline. */
  canView: boolean;
  /** Limited summary for a nearby app user deciding whether to help. */
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

export type CaseContext = {
  /** Distance from the actor's last known location to the incident, if known. */
  distanceKm: number | null;
  isReporterContact?: boolean;
  /** The person needing help allows volunteers to see their medical notes (`autoShareMedical`). */
  subjectSharesMedical?: boolean;
};

export const getCaseRelation = (emergency: CaseSubject, actor: CaseActor, context: CaseContext): CaseRelation => {
  const { distanceKm } = context;
  const responders = Array.isArray(emergency.responders) ? emergency.responders : [];
  const flags = Array.isArray(emergency.fakeFlags) ? emergency.fakeFlags : [];
  return {
    isReporter: String(emergency.reportedBy) === actor.userId,
    isResponder: responders.some((responder) => String(responder.userId) === actor.userId),
    isAdminInArea:
      isAdminRole(actor.role) && (distanceKm == null || distanceKm <= ADMIN_CASE_RADIUS_KM),
    isAppUserNearby: isAppRole(actor.role) && distanceKm != null && distanceKm <= APP_PREVIEW_RADIUS_KM,
    hasFlagged: flags.some((flag) => String(flag.flaggedBy) === actor.userId),
    isReporterContact: isAppRole(actor.role) && Boolean(context.isReporterContact),
  };
};

export const getCasePermissions = (emergency: CaseSubject, actor: CaseActor, context: CaseContext): CasePermissions => {
  const relation = getCaseRelation(emergency, actor, context);
  const isController = actor.role === "controller-center";
  const isAuthority = actor.role === "authority";
  const active = isActiveStatus(emergency.status);

  const canView =
    isController || relation.isReporter || relation.isResponder || relation.isAdminInArea || relation.isReporterContact;
  const canPreview = canView || (active && relation.isAppUserNearby);
  const canManage = isController || (isAuthority && (relation.isResponder || relation.isAdminInArea));
  // Professionals see medical notes; volunteers and public helpers only when the subject opted in.
  const canViewMedical =
    relation.isReporter ||
    isController ||
    (canView && isAdminRole(actor.role)) ||
    relation.isReporterContact ||
    (relation.isResponder && context.subjectSharesMedical !== false);

  return {
    canView,
    canPreview,
    canAccept: active && !relation.isReporter && !relation.isResponder && (canView || relation.isAppUserNearby),
    canLeave: active && relation.isResponder && !relation.isReporter,
    // Decided by the product owner: only people on the case and admins may flag a report as fake.
    canFlagFake:
      !relation.isReporter && !relation.hasFlagged && (relation.isResponder || (isAdminRole(actor.role) && canView)),
    canVerify: canManage && emergency.status === "reported",
    canResolve:
      (canManage || (actor.role === "responder" && relation.isResponder)) &&
      (emergency.status === "verified" || emergency.status === "in_progress"),
    canClose: canManage && emergency.status !== "closed",
    canAwardPoints: canManage,
    canAssignResponders: canManage && active,
    canUpdateOwnStatus: active && relation.isResponder,
    canShareLocation: active && (relation.isResponder || relation.isReporter),
    canViewMedical,
    canViewContacts: canViewMedical,
    canJoinVideo: emergency.status !== "closed" && (isController || relation.isReporter || relation.isResponder),
  };
};

/** Allowed status transitions besides closing (which has its own endpoint). */
export const STATUS_TRANSITIONS: Record<"verify" | "resolve", { from: EmergencyStatus[]; to: EmergencyStatus }> = {
  verify: { from: ["reported"], to: "verified" },
  resolve: { from: ["verified", "in_progress"], to: "resolved" },
};

export const haversineDistanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
};
