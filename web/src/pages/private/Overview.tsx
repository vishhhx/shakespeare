import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthServices, EmergencyServices } from "@/services";
import { useAppSelector } from "@/store/hooks";
import { useProfileImage } from "@/hooks/useProfileImage";
import { useSocket, useSocketEvent, useSocketEvents } from "@/context/socket";
import IncidentMap, { type MapMarker } from "@/components/maps/IncidentMap";
import { Panel, SeverityBadge, Skeleton, StatTile, StatusBadge } from "@/components/emergency/badges";
import {
  RESPONDER_STATUS_LABELS,
  SEVERITY_ORDER,
  STATUS_LABELS,
  TYPE_LABELS,
  errorMessage,
  timeAgo,
  type DirectiveCase,
  type EmergencySeverity,
  type EmergencyStatus,
} from "@/lib/emergency";

type UserProfile = {
  name: string;
  phoneNumber: string;
  profileImage?: string;
  location?: { lat: number; lng: number };
  medicalRecord?: {
    bloodGroup: string;
    allergies: string[];
    medications: string[];
    diseases: string[];
    notes?: string;
  };
  userType?: string;
};

type VolunteerApplication = {
  _id: string;
  userId: string;
  skills: string[];
  preferredRoles: string[];
  status: "pending" | "approved" | "rejected";
  createdAt?: string;
  documents?: Array<{ name?: string; signedUrl?: string | null }>;
  experience?: string;
  userProfile?: UserProfile;
};

const ROLE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "controller-center": { title: "Control center", subtitle: "Every open emergency, live." },
  authority: { title: "Authority dashboard", subtitle: "Emergencies in your area and the volunteers you review." },
  responder: { title: "Responder dashboard", subtitle: "Cases assigned to you first, then open cases nearby." },
};

const REFRESH_EVENTS = [
  "emergency-authority-alert",
  "emergency-controller-alert",
  "emergency-case-updated",
  "emergency-case-closed",
  "emergency-assigned",
  "emergency-responder-left",
];

function ApplicantCard({ profile }: { profile: UserProfile }) {
  const { imageUrl } = useProfileImage(profile.profileImage);
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
            {profile.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{profile.name}</p>
        <p className="text-xs text-muted-foreground">{profile.phoneNumber}</p>
      </div>
    </div>
  );
}

function Overview() {
  const user = useAppSelector((state) => state.auth.authData);
  const role = user?.role ?? "";
  const navigate = useNavigate();
  const { connected } = useSocket();

  const [cases, setCases] = useState<DirectiveCase[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [casesError, setCasesError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<EmergencyStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<EmergencySeverity | "all">("all");
  const [applications, setApplications] = useState<VolunteerApplication[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdmin = ["authority", "responder", "controller-center"].includes(role);

  const loadCases = useCallback(async () => {
    try {
      const response = await EmergencyServices.directives();
      setCases(response.directives ?? []);
      setCasesError("");
    } catch (error) {
      setCasesError(errorMessage(error, "Couldn't load emergencies."));
    } finally {
      setLoadingCases(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadCases();
    const timer = setInterval(() => void loadCases(), 30000);
    return () => clearInterval(timer);
  }, [isAdmin, loadCases]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void loadCases(), 400);
  }, [loadCases]);
  useSocketEvents(REFRESH_EVENTS, scheduleRefresh);

  useEffect(() => {
    if (role !== "authority") return;
    setLoadingApplications(true);
    AuthServices.getAssignedVolunteerApplications()
      .then((response) => setApplications((response?.applications as VolunteerApplication[]) ?? []))
      .catch((error) => toast.error(errorMessage(error, "Couldn't load volunteer applications.")))
      .finally(() => setLoadingApplications(false));
  }, [role]);

  useSocketEvent<{ application: VolunteerApplication }>("volunteer-application-created", (data) => {
    toast.info("New volunteer application");
    setApplications((previous) => [data.application, ...previous]);
  });

  const handleReview = async (applicationId: string, status: "approved" | "rejected") => {
    setReviewingId(applicationId);
    try {
      await AuthServices.reviewVolunteerApplication(applicationId, { status });
      setApplications((current) => current.map((item) => (item._id === applicationId ? { ...item, status } : item)));
      toast.success(status === "approved" ? "Volunteer approved." : "Application rejected.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't review the application."));
    } finally {
      setReviewingId(null);
    }
  };

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return cases
      .filter((item) => statusFilter === "all" || item.status === statusFilter)
      .filter((item) => severityFilter === "all" || item.severity === severityFilter)
      .filter(
        (item) =>
          !text ||
          [item.title, item.description, item.location?.address, item.emergencyId, TYPE_LABELS[item.type]]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(text)),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.assignedToMe)) - Number(Boolean(a.assignedToMe)) ||
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
  }, [cases, query, severityFilter, statusFilter]);

  const stats = useMemo(
    () => ({
      open: cases.length,
      critical: cases.filter((item) => item.severity === "critical").length,
      waiting: cases.filter((item) => (item.respondersConnected ?? item.respondersCount ?? 0) === 0).length,
      mine: cases.filter((item) => item.assignedToMe).length,
    }),
    [cases],
  );

  const markers = useMemo<MapMarker[]>(
    () =>
      filtered
        .filter((item) => typeof item.location?.lat === "number" && typeof item.location?.lng === "number")
        .map((item) => ({
          id: item.emergencyId,
          kind: "incident",
          position: { lat: item.location!.lat!, lng: item.location!.lng! },
          title: `${item.title} · ${STATUS_LABELS[item.status]}`,
          emphasis: item.severity,
        })),
    [filtered],
  );

  const onSelectCase = useCallback((id: string) => navigate(`/emergency/${id}`), [navigate]);

  if (!isAdmin) {
    return <main className="p-6 text-sm text-muted-foreground">This dashboard is for authorities, responders and the control center.</main>;
  }

  const heading = ROLE_TITLES[role] ?? ROLE_TITLES.authority!;
  const mine = cases.filter((item) => item.assignedToMe);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{heading.title}</h1>
          <p className="text-sm text-muted-foreground">{heading.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground"}`} />
            {connected ? "Live" : "Reconnecting…"}
          </span>
          <Button variant="outline" size="sm" onClick={() => void loadCases()}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Open cases" value={stats.open} />
        <StatTile label="Critical" value={stats.critical} tone={stats.critical ? "danger" : "default"} />
        <StatTile label="No responder yet" value={stats.waiting} tone={stats.waiting ? "danger" : "default"} />
        {role === "responder" ? <StatTile label="Assigned to you" value={stats.mine} /> : <StatTile label="In progress" value={cases.filter((item) => item.status === "in_progress").length} />}
      </div>

      {role === "responder" && mine.length > 0 && (
        <Panel title="Assigned to you">
          <ul className="grid gap-3 md:grid-cols-2">
            {mine.map((item) => (
              <li key={item.emergencyId}>
                <button
                  onClick={() => onSelectCase(item.emergencyId)}
                  className="w-full rounded-lg border-2 border-amber-400 bg-amber-50/60 p-3 text-left transition hover:bg-amber-50 dark:bg-amber-950/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{item.title}</p>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your status: {item.myStatus ? RESPONDER_STATUS_LABELS[item.myStatus] : "Assigned"}
                    {typeof item.distanceFromRequesterKm === "number" ? ` · ${item.distanceFromRequesterKm.toFixed(1)} km away` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Emergency queue" action={<span className="text-xs text-muted-foreground">{filtered.length} shown</span>}>
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="relative min-w-48 flex-1">
              <span className="sr-only">Search emergencies</span>
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, address or case id" className="pl-8" />
            </label>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as EmergencyStatus | "all")}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="all">All statuses</option>
              {(["reported", "verified", "in_progress"] as EmergencyStatus[]).map((value) => (
                <option key={value} value={value}>{STATUS_LABELS[value]}</option>
              ))}
            </select>
            <select
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as EmergencySeverity | "all")}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="all">All severities</option>
              {(["critical", "high", "medium", "low"] as EmergencySeverity[]).map((value) => (
                <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>
              ))}
            </select>
          </div>

          {loadingCases ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16" />)}
            </div>
          ) : casesError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {casesError} <button className="underline" onClick={() => void loadCases()}>Try again</button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
              {cases.length === 0 ? "No open emergencies right now." : "No emergencies match these filters."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((item) => {
                const responders = item.respondersConnected ?? item.respondersCount ?? 0;
                return (
                  <li key={item.emergencyId}>
                    <button
                      onClick={() => onSelectCase(item.emergencyId)}
                      className="flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <SeverityBadge severity={item.severity} className="mt-0.5 w-20 justify-center" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-foreground">{item.title}</p>
                          {item.assignedToMe && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">Assigned to you</span>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {TYPE_LABELS[item.type]} · reported {timeAgo(item.createdAt)}
                          {typeof item.distanceFromRequesterKm === "number" ? ` · ${item.distanceFromRequesterKm.toFixed(1)} km` : ""}
                          {item.location?.address ? ` · ${item.location.address}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={item.status} />
                        <span className={`text-xs ${responders === 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                          {responders === 0 ? "No responder" : `${responders} responding`}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="lg:col-span-2" title="Live map">
          <IncidentMap markers={markers} onSelect={onSelectCase} className="h-[420px] w-full" />
          <p className="mt-2 text-xs text-muted-foreground">Pins are incident locations, darker for higher severity. Click one to open the case.</p>
        </Panel>
      </div>

      {role === "authority" && (
        <Panel title="Volunteer applications" action={<span className="text-xs text-muted-foreground">Routed to your organisation</span>}>
          {loadingApplications ? (
            <Skeleton className="h-24" />
          ) : applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications waiting for review.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {applications.map((application) => (
                <li key={application._id} className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    {application.userProfile ? <ApplicantCard profile={application.userProfile} /> : <p className="font-medium">Application #{application._id.slice(-6)}</p>}
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{application.status}</span>
                  </div>
                  <dl className="grid gap-1 text-sm">
                    <div><dt className="inline text-muted-foreground">Skills: </dt><dd className="inline">{application.skills.join(", ") || "None listed"}</dd></div>
                    <div><dt className="inline text-muted-foreground">Wants to help with: </dt><dd className="inline">{application.preferredRoles.join(", ") || "Any"}</dd></div>
                    {application.experience && <div><dt className="inline text-muted-foreground">Experience: </dt><dd className="inline">{application.experience}</dd></div>}
                    {application.userProfile?.medicalRecord?.bloodGroup && (
                      <div><dt className="inline text-muted-foreground">Blood group: </dt><dd className="inline">{application.userProfile.medicalRecord.bloodGroup}</dd></div>
                    )}
                  </dl>
                  {(application.documents ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(application.documents ?? []).map((doc, index) => (
                        <a key={index} href={doc.signedUrl ?? "#"} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-700 underline dark:text-blue-300">
                          {doc.name || `Document ${index + 1}`}
                        </a>
                      ))}
                    </div>
                  )}
                  {application.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={reviewingId === application._id} onClick={() => void handleReview(application._id, "approved")}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={reviewingId === application._id} onClick={() => void handleReview(application._id, "rejected")}>Reject</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </main>
  );
}

export default Overview;
