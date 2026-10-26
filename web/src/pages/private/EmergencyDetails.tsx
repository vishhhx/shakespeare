import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Building2, ExternalLink, Phone, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TwilioEmergencyCallPanel from "@/components/streams/TwilioEmergencyCallPanel";
import IncidentMap, { type MapMarker, type RouteResult } from "@/components/maps/IncidentMap";
import { Lifecycle, Panel, RoleBadge, SeverityBadge, Skeleton, StatusBadge } from "@/components/emergency/badges";
import { EmergencyServices } from "@/services";
import type { AssignableResponder } from "@/services/emergencyServices";
import { useSocketEvent } from "@/context/socket";
import {
  RESPONDER_STATUS_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  errorMessage,
  MARKER_COLORS,
  isStale,
  timeAgo,
  type CaseDetails,
  type LatLng,
  type ResponderStatus,
} from "@/lib/emergency";

const NEXT_STATUS: Partial<Record<ResponderStatus, { to: Exclude<ResponderStatus, "assigned">; label: string }>> = {
  assigned: { to: "enroute", label: "I'm en route" },
  enroute: { to: "on_scene", label: "I've arrived" },
  on_scene: { to: "completed", label: "I'm finished" },
};
const SHARE_EVERY_MS = 15000;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";

const metres = (a: LatLng, b: LatLng) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** Two-step button for actions with consequences: first click arms it, second confirms. */
function ConfirmButton({ label, confirmLabel, onConfirm, busy, variant = "outline" }: { label: string; confirmLabel: string; onConfirm: () => void; busy?: boolean; variant?: "outline" | "destructive" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      variant={armed ? "destructive" : variant}
      disabled={busy}
      aria-live="polite"
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

export default function EmergencyDetails() {
  const { emergencyId = "" } = useParams<{ emergencyId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [details, setDetails] = useState<CaseDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [myPosition, setMyPosition] = useState<LatLng | null>(null);
  const [geoError, setGeoError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("incident");
  const [responders, setResponders] = useState<AssignableResponder[]>([]);
  const [assignee, setAssignee] = useState("");
  const [rewardTo, setRewardTo] = useState("");
  const [rewardPoints, setRewardPoints] = useState("50");
  const [closeReason, setCloseReason] = useState("");
  const versionRef = useRef(0);
  const [autoJoinHandled, setAutoJoinHandled] = useState(false);

  const load = useCallback(async () => {
    if (!emergencyId) return;
    try {
      const response = await EmergencyServices.details(emergencyId);
      if (response.emergency.version < versionRef.current) return; // older than what we show
      versionRef.current = response.emergency.version;
      setDetails(response.emergency);
      setLoadError("");
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      setLoadError(status === 403 ? "This case is outside your area or you don't have access to it." : errorMessage(error, "Couldn't load this case."));
    }
  }, [emergencyId]);

  useEffect(() => {
    versionRef.current = 0; // a different case: accept whatever version it has
    void load();
  }, [load]);

  useSocketEvent<{ emergencyId: string; version: number }>("emergency-case-updated", (event) => {
    if (event?.emergencyId === emergencyId && event.version > versionRef.current) void load();
  });
  useSocketEvent<{ emergencyId: string }>("emergency-case-closed", (event) => {
    if (event?.emergencyId === emergencyId) void load();
  });
  useSocketEvent<{ emergencyId: string; userId: string; party: "reporter" | "responder"; lat: number; lng: number; recordedAt: string }>(
    "emergency-location-update",
    (event) => {
      if (event?.emergencyId !== emergencyId) return;
      const at = new Date(event.recordedAt).getTime();
      setDetails((current) => {
        if (!current) return current;
        if (event.party === "reporter" && current.reporter) {
          const known = current.reporter.liveLocation?.updatedAt;
          if (known && new Date(known).getTime() >= at) return current;
          return { ...current, reporter: { ...current.reporter, liveLocation: { lat: event.lat, lng: event.lng, updatedAt: event.recordedAt } } };
        }
        return {
          ...current,
          responders: (current.responders ?? []).map((responder) =>
            responder.userId !== event.userId || (responder.locationUpdatedAt && new Date(responder.locationUpdatedAt).getTime() >= at)
              ? responder
              : { ...responder, location: { lat: event.lat, lng: event.lng }, locationUpdatedAt: event.recordedAt },
          ),
        };
      });
    },
  );

  const permissions = details?.viewer.permissions;
  const isActive = details ? ["reported", "verified", "in_progress"].includes(details.status) : false;
  const me = details?.responders?.find((responder) => responder.isMe);
  const navigating = Boolean(me && isActive);

  // While responding: follow the browser's position for routing and share it with the case.
  useEffect(() => {
    if (!navigating || !permissions?.canShareLocation || !("geolocation" in navigator)) return;
    let lastShared = 0;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setMyPosition(point);
        setGeoError("");
        if (Date.now() - lastShared >= SHARE_EVERY_MS) {
          lastShared = Date.now();
          void EmergencyServices.shareLocation(emergencyId, { ...point, recordedAt: new Date(position.timestamp).toISOString() }).catch(() => undefined);
        }
      },
      (error) => setGeoError(error.code === error.PERMISSION_DENIED ? "Allow location in your browser to get directions and show the reporter you're coming." : "Your position is unavailable right now."),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [navigating, permissions?.canShareLocation, emergencyId]);

  useEffect(() => {
    if (!permissions?.canAssignResponders) return;
    EmergencyServices.responders()
      .then((response) => setResponders(response.responders))
      .catch(() => setResponders([]));
  }, [permissions?.canAssignResponders]);

  const act = async (key: string, run: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await run();
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const markers = useMemo<MapMarker[]>(() => {
    if (!details?.incident) return [];
    const list: MapMarker[] = [
      { id: "incident", kind: "incident", position: details.incident, title: "Incident location", emphasis: details.severity },
    ];
    const live = details.reporter?.liveLocation;
    if (live && metres(live, details.incident) > 25) {
      list.push({ id: "reporter", kind: "reporter", position: live, title: `${details.reporter!.name} (reporter, live)`, label: "R", stale: isStale(live.updatedAt) });
    }
    for (const responder of details.responders ?? []) {
      const position = responder.isMe && myPosition ? myPosition : responder.location;
      if (!position) continue;
      list.push({
        id: `responder-${responder.userId}`,
        kind: "responder",
        position,
        title: `${responder.isMe ? "You" : responder.name} · ${ROLE_LABELS[responder.actorRole]}`,
        label: initials(responder.isMe ? "Me" : responder.name),
        stale: !(responder.isMe && myPosition) && isStale(responder.locationUpdatedAt),
      });
    }
    if (details.responsibleAuthority?.location) {
      list.push({ id: "authority", kind: "authority", position: details.responsibleAuthority.location, title: `${details.responsibleAuthority.name} (station)` });
    }
    return list;
  }, [details, myPosition]);

  const routeRequest = navigating && myPosition && details?.incident ? { origin: myPosition, destination: details.incident } : null;
  const onRoute = useCallback((result: RouteResult) => setRoute(result), []);

  if (loadError && !details) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 p-6">
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{loadError}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>Try again</Button>
          <Button asChild variant="ghost"><Link to="/overview">Back to dashboard</Link></Button>
        </div>
      </main>
    );
  }

  if (!details || !permissions) {
    return (
      <main className="mx-auto max-w-7xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-28" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </main>
    );
  }

  const selected = markers.find((marker) => marker.id === selectedId);
  const participants = [
    { userId: details.reporter?.userId ?? "", label: `${details.reporter?.name ?? "Reporter"} (reporter)` },
    ...(details.responders ?? []).filter((r) => r.actorRole === "public" || r.actorRole === "volunteer").map((r) => ({ userId: r.userId, label: `${r.name} (${ROLE_LABELS[r.actorRole]})` })),
  ].filter((item) => item.userId);
  const assignable = responders.filter((responder) => !(details.responders ?? []).some((r) => r.userId === responder.userId));
  const autoJoin = !autoJoinHandled && ["1", "true"].includes(searchParams.get("autoJoin") ?? "");

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <Link to="/overview" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <header className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={details.status} />
              <SeverityBadge severity={details.severity} />
              <span className="text-xs text-muted-foreground">Case #{details.emergencyId.slice(-6).toUpperCase()}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{details.title}</h1>
            <p className="text-sm text-muted-foreground">
              {TYPE_LABELS[details.type]} · reported {timeAgo(details.createdAt)}
              {details.incident?.address ? ` · ${details.incident.address}` : ""}
              {typeof details.distanceFromRequesterKm === "number" ? ` · ${details.distanceFromRequesterKm.toFixed(1)} km from you` : ""}
            </p>
          </div>
          {details.incident && (
            <Button variant="outline" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${details.incident!.lat},${details.incident!.lng}`, "_blank", "noopener")}>
              <ExternalLink /> Directions in Google Maps
            </Button>
          )}
        </div>
        <Lifecycle status={details.status} />
        {details.isFake && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">Closed after being reported as fake.</p>}
        {!!details.description && <p className="text-sm text-foreground">{details.description}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Panel title="Map">
            {details.incident ? (
              <>
                <IncidentMap markers={markers} route={routeRequest} onRoute={onRoute} onSelect={setSelectedId} selectedId={selectedId} className="h-[380px] w-full" />
                <ul className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Map legend">
                  {(
                    [
                      ["incident", "Incident (pin)"],
                      ["reporter", "Reporter, live"],
                      ["responder", "Responders"],
                      ["authority", "Authority station"],
                    ] as const
                  ).map(([kind, label]) => (
                    <li key={kind} className="flex items-center gap-1.5">
                      <span className={kind === "authority" ? "h-3 w-3 rounded-sm" : "h-3 w-3 rounded-full"} style={{ background: MARKER_COLORS[kind] }} />
                      {label}
                    </li>
                  ))}
                  <li>Faded = position over 3 min old</li>
                </ul>
                {selected && <p className="mt-2 rounded-lg bg-muted/60 p-2 text-sm"><span className="font-medium">{selected.title}</span></p>}
                {navigating && (
                  <div className="mt-2 text-sm" aria-live="polite">
                    {geoError ? (
                      <p className="text-red-600 dark:text-red-400">{geoError}</p>
                    ) : !myPosition ? (
                      <p className="text-muted-foreground">Finding your position…</p>
                    ) : route?.status === "ready" ? (
                      <p><span className="font-semibold">{route.durationText}</span> · {route.distanceText} by road · updated {timeAgo(new Date(route.fetchedAt).toISOString())}</p>
                    ) : route?.status === "error" ? (
                      <p className="text-red-600 dark:text-red-400">{route.message}</p>
                    ) : (
                      <p className="text-muted-foreground">Working out your route…</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No location was recorded for this case.</p>
            )}
          </Panel>

          <Panel title="Who's involved">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reported by</dt>
                <dd className="mt-1">
                  <p className="font-medium">{details.reporter?.name ?? "SafeSphere user"}</p>
                  <p className="text-xs text-muted-foreground">
                    {details.relationToVictim && details.relationToVictim !== "self" ? `For someone else (${details.relationToVictim})` : "For themselves"}
                  </p>
                  {details.reporter?.phoneNumber && (
                    <a href={`tel:${details.reporter.phoneNumber}`} className="mt-1 inline-flex items-center gap-1 text-sm text-blue-700 underline dark:text-blue-300">
                      <Phone className="h-3.5 w-3.5" /> {details.reporter.phoneNumber}
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs help</dt>
                <dd className="mt-1">
                  <p className="font-medium">{details.subject?.isReporter ? `${details.reporter?.name ?? "The reporter"} (the reporter)` : details.subject?.name ?? "Unknown person"}</p>
                  <p className="text-xs text-muted-foreground">
                    {details.subject?.isReporter
                      ? "Same person as the reporter"
                      : details.subject?.identification === "identified"
                        ? `Face match confirmed by the reporter${typeof details.subject.matchConfidence === "number" ? ` (${Math.round(details.subject.matchConfidence * 100)}% similar)` : ""}; verify on scene`
                        : "Not identified"}
                    {details.subject?.condition ? ` · ${details.subject.condition}` : ""}
                    {details.victimsCount && details.victimsCount > 1 ? ` · ${details.victimsCount} people` : ""}
                  </p>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responsible authority</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  {details.responsibleAuthority ? (
                    <>
                      <Building2 className="h-4 w-4" />
                      <span className="font-medium">{details.responsibleAuthority.name}</span>
                      {details.responsibleAuthority.contactNumber && <a className="text-sm text-blue-700 underline dark:text-blue-300" href={`tel:${details.responsibleAuthority.contactNumber}`}>{details.responsibleAuthority.contactNumber}</a>}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">No authority has taken this case yet.</span>
                  )}
                  {details.monitoredByControlCenter && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Monitored by the control center</span>
                  )}
                </dd>
              </div>
            </dl>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responding ({details.responders?.length ?? 0})</h3>
            {(details.responders ?? []).length === 0 ? (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">Nobody is responding yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {(details.responders ?? []).map((responder) => (
                  <li key={responder.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{responder.isMe ? "You" : responder.name}</span>
                        <RoleBadge role={responder.actorRole} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[
                          responder.organization?.name,
                          RESPONDER_STATUS_LABELS[responder.status],
                          responder.assignedByRole ? `assigned by ${ROLE_LABELS[responder.assignedByRole].toLowerCase()}` : "self-accepted",
                          responder.location ? `position ${timeAgo(responder.locationUpdatedAt)}` : "no position shared",
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {!responder.isMe && responder.phoneNumber && (
                      <a href={`tel:${responder.phoneNumber}`} className="inline-flex items-center gap-1 text-sm text-blue-700 underline dark:text-blue-300">
                        <Phone className="h-3.5 w-3.5" /> Call
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {permissions.canViewMedical && (details.subject?.medicalRecord || details.subject?.sosMessage) && (
            <Panel title="Medical information">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {details.subject?.medicalRecord?.bloodGroup && <div><dt className="text-muted-foreground">Blood group</dt><dd className="font-medium">{details.subject.medicalRecord.bloodGroup}</dd></div>}
                {!!details.subject?.medicalRecord?.allergies?.length && <div><dt className="text-muted-foreground">Allergies</dt><dd className="font-medium text-red-700 dark:text-red-300">{details.subject.medicalRecord.allergies.join(", ")}</dd></div>}
                {!!details.subject?.medicalRecord?.medications?.length && <div><dt className="text-muted-foreground">Medications</dt><dd>{details.subject.medicalRecord.medications.join(", ")}</dd></div>}
                {!!details.subject?.medicalRecord?.diseases?.length && <div><dt className="text-muted-foreground">Conditions</dt><dd>{details.subject.medicalRecord.diseases.join(", ")}</dd></div>}
                {details.subject?.medicalRecord?.notes && <div className="sm:col-span-2"><dt className="text-muted-foreground">Notes</dt><dd>{details.subject.medicalRecord.notes}</dd></div>}
                {details.subject?.sosMessage && <div className="sm:col-span-2"><dt className="text-muted-foreground">Their SOS message</dt><dd>{details.subject.sosMessage}</dd></div>}
              </dl>
              {permissions.canViewContacts && !!details.subject?.contacts?.length && (
                <ul className="mt-3 space-y-1 text-sm">
                  {details.subject.contacts.map((contact) => (
                    <li key={contact.phoneNumber}>
                      {contact.name}{contact.relation ? ` (${contact.relation})` : ""} · <a className="text-blue-700 underline dark:text-blue-300" href={`tel:${contact.phoneNumber}`}>{contact.phoneNumber}</a>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {!!details.media?.length && (
            <Panel title="Evidence">
              <div className="grid gap-3 sm:grid-cols-2">
                {details.media.map((item) => (
                  <figure key={item.url} className="overflow-hidden rounded-lg border border-border">
                    {item.type === "image" && item.signedUrl ? (
                      <img src={item.signedUrl} alt="Incident evidence" className="h-48 w-full object-cover" />
                    ) : item.type === "video" && item.signedUrl ? (
                      <video src={item.signedUrl} controls className="h-48 w-full bg-black" />
                    ) : item.type === "audio" && item.signedUrl ? (
                      <audio src={item.signedUrl} controls className="w-full" />
                    ) : (
                      <p className="p-3 text-sm text-muted-foreground">File unavailable</p>
                    )}
                  </figure>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Panel title="Actions">
            <div className="flex flex-col gap-2">
              {!isActive && <p className="text-sm text-muted-foreground">This case is {STATUS_LABELS[details.status].toLowerCase()}.</p>}
              {permissions.canAccept && (
                <Button disabled={busy === "accept"} onClick={() => void act("accept", () => EmergencyServices.accept(emergencyId, myPosition), "You're responding to this case.")}>
                  Respond to this case
                </Button>
              )}
              {me && NEXT_STATUS[me.status] && permissions.canUpdateOwnStatus && (
                <Button disabled={busy === "status"} onClick={() => void act("status", () => EmergencyServices.myStatus(emergencyId, NEXT_STATUS[me.status]!.to), "Status updated.")}>
                  {NEXT_STATUS[me.status]!.label}
                </Button>
              )}
              {permissions.canVerify && (
                <Button variant="outline" disabled={busy === "verify"} onClick={() => void act("verify", () => EmergencyServices.setStatus(emergencyId, "verify"), "Marked as verified.")}>
                  Mark as verified
                </Button>
              )}
              {permissions.canResolve && (
                <Button variant="outline" disabled={busy === "resolve"} onClick={() => void act("resolve", () => EmergencyServices.setStatus(emergencyId, "resolve"), "Marked as resolved.")}>
                  Mark as resolved
                </Button>
              )}
              {permissions.canLeave && (
                <ConfirmButton label="Leave this case" confirmLabel="Click again to leave" busy={busy === "leave"} onConfirm={() => void act("leave", () => EmergencyServices.leave(emergencyId), "You left the case.")} />
              )}
              {permissions.canFlagFake && (
                <div className="space-y-1">
                  <ConfirmButton
                    label="Report as fake"
                    confirmLabel="Confirm: report as fake"
                    busy={busy === "flag"}
                    onConfirm={() => void act("flag", () => EmergencyServices.flagFake(emergencyId), "Fake report recorded.")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {details.fakeReports?.count ?? 0} of {details.fakeReports?.threshold ?? 3} reports. At {details.fakeReports?.threshold ?? 3} the case closes and the reporter is permanently blocked.
                  </p>
                </div>
              )}
              {details.viewer.hasFlagged && <p className="text-xs text-muted-foreground">You reported this case as fake.</p>}
            </div>
          </Panel>

          {permissions.canAssignResponders && (
            <Panel title="Assign a responder">
              {assignable.length === 0 ? (
                <p className="text-sm text-muted-foreground">{responders.length === 0 ? "No responders are linked to your organisation yet." : "Every available responder is already on this case."}</p>
              ) : (
                <div className="flex gap-2">
                  <select aria-label="Responder" value={assignee} onChange={(event) => setAssignee(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm">
                    <option value="">Choose a responder…</option>
                    {assignable.map((responder) => (
                      <option key={responder.userId} value={responder.userId}>
                        {responder.name}{responder.organization ? ` · ${responder.organization.name}` : ""}{responder.online ? " · online" : ""}
                      </option>
                    ))}
                  </select>
                  <Button disabled={!assignee || busy === "assign"} onClick={() => void act("assign", () => EmergencyServices.assign(emergencyId, assignee), "Responder assigned.").then(() => setAssignee(""))}>
                    Assign
                  </Button>
                </div>
              )}
            </Panel>
          )}

          {permissions.canAwardPoints && participants.length > 0 && (
            <Panel title="Award points">
              <div className="flex flex-wrap gap-2">
                <select aria-label="Participant" value={rewardTo} onChange={(event) => setRewardTo(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm">
                  <option value="">Choose a person…</option>
                  {participants.map((person) => <option key={person.userId} value={person.userId}>{person.label}</option>)}
                </select>
                <Input aria-label="Points" type="number" min={1} max={500} value={rewardPoints} onChange={(event) => setRewardPoints(event.target.value)} className="w-24" />
                <Button
                  disabled={!rewardTo || busy === "reward" || !(Number(rewardPoints) >= 1 && Number(rewardPoints) <= 500)}
                  onClick={() => void act("reward", () => EmergencyServices.reward(emergencyId, rewardTo, Number(rewardPoints)), "Points awarded.")}
                >
                  Award
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">1–500 points per award. App users only.</p>
            </Panel>
          )}

          {permissions.canClose && (
            <Panel title="Close the case">
              <div className="space-y-2">
                <Input aria-label="Reason for closing" placeholder="Reason (shared with the reporter)" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} />
                <ConfirmButton
                  label="Close case"
                  confirmLabel="Click again to close"
                  variant="destructive"
                  busy={busy === "close"}
                  onConfirm={() => void act("close", () => EmergencyServices.close(emergencyId, closeReason.trim() || undefined), "Case closed. Live streams stopped.")}
                />
              </div>
            </Panel>
          )}

          {permissions.canJoinVideo && (
            <TwilioEmergencyCallPanel
              emergencyId={emergencyId}
              autoJoin={autoJoin}
              onAutoJoinHandled={() => {
                setAutoJoinHandled(true);
                const next = new URLSearchParams(searchParams);
                next.delete("autoJoin");
                setSearchParams(next, { replace: true });
              }}
            />
          )}

          {!!details.timeline?.length && (
            <Panel title="Timeline">
              <ol className="space-y-3">
                {[...details.timeline].reverse().slice(0, 25).map((entry, index) => (
                  <li key={`${entry.timestamp}-${index}`} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${index === 0 ? "bg-amber-500" : "bg-border"}`} />
                    <div>
                      <p className="text-sm">{entry.event}</p>
                      <p className="text-xs text-muted-foreground">
                        {[entry.actorName, entry.actorRole ? ROLE_LABELS[entry.actorRole as keyof typeof ROLE_LABELS] : null, new Date(entry.timestamp).toLocaleString()].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}
