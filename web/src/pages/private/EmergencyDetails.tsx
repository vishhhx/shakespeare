import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import TwilioEmergencyCallPanel from "@/components/streams/TwilioEmergencyCallPanel";
import { AuthServices } from "@/services";
import { useAppSelector } from "@/store/hooks";

type EmergencyResponder = {
  userId: string;
  role: "volunteer" | "authority";
  status: "assigned" | "enroute" | "on_scene" | "completed";
  location?: { lat?: number; lng?: number } | null;
  joinedAt?: string;
};

type EmergencyParticipant = {
  userId: string;
  role: "reporter" | "volunteer" | "authority";
  status?: string;
  joinedAt?: string;
};

type EmergencyDetail = {
  emergencyId: string;
  title: string;
  description?: string;
  type: string;
  severity: string;
  status: string;
  relationToVictim?: string;
  location?: { lat?: number; lng?: number; address?: string };
  victimsCount?: number;
  respondersConnected: number;
  responders: EmergencyResponder[];
  participants?: EmergencyParticipant[];
  media?: {
    type: "image" | "video" | "audio";
    url: string;
    signedUrl?: string;
  }[];
  timeline?: unknown[];
  distanceFromRequesterKm?: number | null;
  createdAt?: string;
  updatedAt?: string;
  privileges?: {
    canEditCase?: boolean;
    canCloseCase?: boolean;
    canBroadcastUpdates?: boolean;
    canViewReporterDetails?: boolean;
  };
};

const PARTICIPANT_LABELS: Record<EmergencyParticipant["role"], string> = {
  reporter: "Reporter",
  volunteer: "Volunteer",
  authority: "Authority",
};

export default function EmergencyDetails() {
  const { emergencyId } = useParams<{ emergencyId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const authUser = useAppSelector((state) => state.auth.authData);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<EmergencyDetail | null>(null);
  const [autoJoinHandled, setAutoJoinHandled] = useState(false);
  const mapsApiKey =
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
    (import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined);

  useEffect(() => {
    const loadDetails = async () => {
      if (!emergencyId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await AuthServices.getEmergencyById(emergencyId);
        setDetails((response?.emergency as EmergencyDetail) ?? null);
      } catch (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "response" in error &&
          typeof (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
            ?.error === "string"
            ? (error as { response?: { data?: { error?: string; message?: string } } }).response!.data!.error!
            : "Failed to load emergency details.";

        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    void loadDetails();
  }, [emergencyId]);

  if (loading) {
    return (
      <main className="p-6">
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading emergency details...
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="space-y-3 p-6">
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Emergency details are unavailable.
        </div>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Back
        </Button>
      </main>
    );
  }

  const hasMapCoordinates =
    typeof details.location?.lat === "number" && typeof details.location?.lng === "number";

  const isControllerCenter = authUser?.role === "controller-center";
  const isResponder = authUser?.role === "responder" || authUser?.role === "authority";
  const isUserResponding = details.responders.some((r) => r.userId === authUser?._id);
  const participants = details.participants ?? [];

  const handleLeaveCase = async () => {
    if (!emergencyId) return;
    try {
      await AuthServices.leaveEmergencyCase(emergencyId);
      toast.success("You have left the emergency case.");
      navigate("/overview", { replace: true });
    } catch (error: unknown) {
      const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
      toast.error(maybeError?.response?.data?.error || maybeError?.message || "Failed to leave emergency case.");
    }
  };

  const mapEmbedUrl =
    hasMapCoordinates && mapsApiKey
      ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapsApiKey)}&q=${details.location!.lat},${details.location!.lng}&zoom=14`
      : null;

  const autoJoinFromQuery = searchParams.get("autoJoin");
  const shouldAutoJoinCall = !autoJoinHandled && (autoJoinFromQuery === "1" || autoJoinFromQuery === "true");

  return (
    <main className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{details.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {details.type} · {details.severity} · {details.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/overview">Back to Overview</Link>
          </Button>
          {isControllerCenter && emergencyId && (
            <Button
              variant="destructive"
              onClick={() => {
                void AuthServices.closeEmergencyCase(emergencyId)
                  .then(() => {
                    toast.success("Emergency case closed. All live tracks stopped.");
                    navigate("/overview", { replace: true });
                  })
                  .catch((error: unknown) => {
                    const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
                    toast.error(maybeError?.response?.data?.error || maybeError?.message || "Failed to close emergency case.");
                  });
              }}
            >
              Close Case
            </Button>
          )}
          {isResponder && isUserResponding && emergencyId && (
            <Button
              variant="outline"
              onClick={handleLeaveCase}
            >
              Leave Case
            </Button>
          )}
          <Button
            onClick={() => {
              const lat = details.location?.lat;
              const lng = details.location?.lng;
              if (typeof lat === "number" && typeof lng === "number") {
                window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, "_blank");
              }
            }}
          >
            Open Map
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-border bg-card p-4">
          {details.description && <p className="text-sm text-foreground">{details.description}</p>}
          {details.media && details.media.length > 0 && (
            <div className="mt-4 space-y-3">
              <h2 className="text-base font-semibold">Incident Media</h2>
              {details.media.map((item) => (
                <article key={`${item.url}-${item.type}`} className="overflow-hidden rounded-md border border-border/60 bg-background">
                  {item.type === "image" && item.signedUrl ? (
                    <img src={item.signedUrl} alt="Incident evidence" className="h-56 w-full object-cover" />
                  ) : (
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{item.type === "video" ? "Video evidence" : "Audio evidence"}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{item.url}</p>
                      </div>
                      {!!item.signedUrl && (
                        <a href={item.signedUrl} target="_blank" rel="noreferrer" className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                          Open
                        </a>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <p>Victims: {details.victimsCount ?? 0}</p>
            <p>Responders connected: {details.respondersConnected}</p>
            {typeof details.distanceFromRequesterKm === "number" && (
              <p>Distance from you: {details.distanceFromRequesterKm.toFixed(1)} km</p>
            )}
            {details.location?.address && <p>Address: {details.location.address}</p>}
            {details.createdAt && <p>Reported: {new Date(details.createdAt).toLocaleString()}</p>}
            {details.updatedAt && <p>Updated: {new Date(details.updatedAt).toLocaleString()}</p>}
          </div>
        </article>

        <article className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Incident Map</h2>
          {mapEmbedUrl ? (
            <iframe
              title="Emergency incident map"
              src={mapEmbedUrl}
              className="mt-3 h-80 w-full rounded-md border border-border"
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : hasMapCoordinates ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Google Maps API key is missing. Add VITE_GOOGLE_MAPS_API_KEY or PUBLIC_GOOGLE_MAPS_API_KEY.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Incident coordinates are unavailable for map rendering.</p>
          )}
        </article>
      </section>

      {details.privileges && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Control Center Access</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {[
              ["Close case", details.privileges.canCloseCase],
              ["Broadcast updates", details.privileges.canBroadcastUpdates],
              ["Edit case", details.privileges.canEditCase],
              ["View reporter", details.privileges.canViewReporterDetails],
            ].map(([label, enabled]) => (
              <span
                key={String(label)}
                className={`rounded-full px-3 py-1 font-medium ${enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
              >
                {label}: {enabled ? "enabled" : "disabled"}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Participants</h2>
        {participants.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No participant data is available yet.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {participants.map((participant) => (
              <article key={`${participant.userId}-${participant.role}`} className="rounded-md border border-border/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{PARTICIPANT_LABELS[participant.role]}</p>
                  {participant.status && (
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{participant.status}</p>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">User ID: {participant.userId}</p>
                {participant.joinedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Joined: {new Date(participant.joinedAt).toLocaleString()}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Responder Assignment</h2>
        {details.responders.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No responders assigned yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {details.responders.map((responder) => (
              <article key={`${responder.userId}-${responder.joinedAt || "na"}`} className="rounded-md border border-border/60 p-3">
                <p className="text-sm font-medium">
                  {responder.role} · {responder.status}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Responder ID: {responder.userId}</p>
                {responder.joinedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Joined: {new Date(responder.joinedAt).toLocaleString()}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {emergencyId && (
        <TwilioEmergencyCallPanel
          emergencyId={emergencyId}
          autoJoin={shouldAutoJoinCall}
          onAutoJoinHandled={() => {
            setAutoJoinHandled(true);
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete("autoJoin");
            setSearchParams(nextParams, { replace: true });
          }}
        />
      )}
    </main>
  );
}
