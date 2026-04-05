import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AuthServices } from "@/services";
import { useAppSelector } from "@/store/hooks";
import { useProfileImage } from "@/hooks/useProfileImage";
import { useSocket } from "@/context/socketContext";

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
  sosMessage?: string;
  autoShareMedical?: boolean;
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
  availability?: { isAvailable: boolean; timeSlots?: string[] };
  userProfile?: UserProfile;
};

type DirectiveEmergency = {
  emergencyId: string;
  title: string;
  description?: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "reported" | "verified" | "in_progress" | "resolved" | "closed";
  location?: { lat?: number; lng?: number; address?: string };
  victimsCount?: number;
  respondersConnected?: number;
  respondersCount?: number;
  distanceFromRequesterKm?: number | null;
  createdAt?: string;
};

// Component to display user profile with presigned image URL
function UserProfileCard({ profile }: { profile: UserProfile }) {
  const { imageUrl, loading } = useProfileImage(profile.profileImage);

  return (
    <div className="mt-3 rounded-md border border-border/50 bg-muted/30 p-3">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
            {loading ? (
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
              </div>
            ) : imageUrl ? (
              <img src={imageUrl} alt={profile.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                {profile.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium text-foreground">{profile.name}</p>
            <p className="text-xs text-muted-foreground">{profile.phoneNumber}</p>
          </div>
          {profile.userType && (
            <span className="inline-block shrink-0 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
              {profile.userType}
            </span>
          )}
        </div>

        {/* Location */}
        {profile.location && (
          <p className="text-xs text-muted-foreground">
            📍 Location: {profile.location.lat.toFixed(4)}, {profile.location.lng.toFixed(4)}
          </p>
        )}

        {/* Medical Info */}
        {profile.medicalRecord && (
          <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
            <p className="text-xs font-medium text-foreground">Medical Record:</p>
            <p className="text-xs text-muted-foreground">🩸 Blood Group: {profile.medicalRecord.bloodGroup}</p>
            {(profile.medicalRecord.allergies ?? []).length > 0 && (
              <p className="text-xs text-red-600">
                ⚠️ Allergies: {profile.medicalRecord.allergies.join(", ")}
              </p>
            )}
            {(profile.medicalRecord.medications ?? []).length > 0 && (
              <p className="text-xs text-muted-foreground">
                💊 Medications: {profile.medicalRecord.medications.join(", ")}
              </p>
            )}
            {(profile.medicalRecord.diseases ?? []).length > 0 && (
              <p className="text-xs text-muted-foreground">
                🏥 Diseases: {profile.medicalRecord.diseases.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Overview() {
  const user = useAppSelector((state) => state.auth.authData);
  const navigate = useNavigate();
  const [applications, setApplications] = useState<VolunteerApplication[]>([]);
  const [directives, setDirectives] = useState<DirectiveEmergency[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDirectives, setLoadingDirectives] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const { socket, connected } = useSocket();

  useEffect(() => {
    const fetchAssignedApplications = async () => {
      if (user?.role !== "authority") {
        return;
      }

      setLoading(true);
      try {
        const response = await AuthServices.getAssignedVolunteerApplications();
        setApplications((response?.applications as VolunteerApplication[]) ?? []);
      } catch (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "response" in error &&
          typeof (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
            ?.error === "string"
            ? (error as { response?: { data?: { error?: string; message?: string } } }).response!.data!.error!
            : "Failed to load assigned applications.";

        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    fetchAssignedApplications();
  }, [user?.role]);

  useEffect(() => {
    const canViewDirectives = ["authority", "responder", "controller-center"].includes(user?.role || "");
    if (!canViewDirectives) {
      setDirectives([]);
      return;
    }

    const fetchDirectives = async () => {
      setLoadingDirectives(true);
      try {
        const response = await AuthServices.getDirectiveEmergencies();
        setDirectives((response?.directives as DirectiveEmergency[]) ?? []);
      } catch (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "response" in error &&
          typeof (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
            ?.error === "string"
            ? (error as { response?: { data?: { error?: string; message?: string } } }).response!.data!.error!
            : "Failed to load emergency directives.";

        toast.error(message);
      } finally {
        setLoadingDirectives(false);
      }
    };

    void fetchDirectives();
  }, [user?.role]);

  // Subscribe to volunteer updates on the shared authenticated socket.
  useEffect(() => {
    const authorityRoomId = (user as any)?.authorityProfileId || user?._id;
    if (!authorityRoomId || user?.role !== "authority" || !socket) return;

    if (connected) {
      socket.emit("join-authority", { authorityId: authorityRoomId });
    }

    const handleConnect = () => {
      socket.emit("join-authority", { authorityId: authorityRoomId });
    };

    const handleApplicationCreated = (data: any) => {
      console.log("New volunteer application received:", data);
      toast.info("New volunteer application assigned to you!");
      setApplications((prev) => [data.application, ...prev]);
    };

    const handleSocketError = (error: any) => {
      console.error("Socket error:", error);
    };

    socket.on("connect", handleConnect);
    socket.on("volunteer-application-created", handleApplicationCreated);
    socket.on("error", handleSocketError);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("volunteer-application-created", handleApplicationCreated);
      socket.off("error", handleSocketError);
    };
  }, [socket, connected, user?._id, user?.role, (user as any)?.authorityProfileId]);

  const handleReview = async (applicationId: string, status: "approved" | "rejected") => {
    setReviewingId(applicationId);
    try {
      await AuthServices.reviewVolunteerApplication(applicationId, { status });
      setApplications((current) =>
        current.map((application) =>
          application._id === applicationId ? { ...application, status } : application,
        ),
      );
      
      // Emit update through socket
      socket?.emit("volunteer-application-reviewed", {
        applicationId,
        status,
      });

      toast.success(`Application ${status}.`);
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
          ?.error === "string"
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response!.data!.error!
          : "Failed to review application.";

      toast.error(message);
    } finally {
      setReviewingId(null);
    }
  };

  if (!["authority", "responder", "controller-center"].includes(user?.role || "")) {
    return <main className="p-6" />;
  }

  return (
    <main className="space-y-4 p-6">
      <section className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold">Emergency Directives</h1>
          <p className="text-sm text-muted-foreground">
            Active incidents with operational context for rapid response.
          </p>
        </header>

        {loadingDirectives ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Loading directives...
          </div>
        ) : directives.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No active emergencies in your directive feed.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {directives.map((directive) => (
              <article key={directive.emergencyId} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{directive.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                      {directive.type} · {directive.severity} · {directive.status}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/emergency/${directive.emergencyId}`)}>
                    Open
                  </Button>
                </div>

                {directive.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{directive.description}</p>
                )}

                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {directive.location?.address && <p>Location: {directive.location.address}</p>}
                  {typeof directive.distanceFromRequesterKm === "number" && (
                    <p>Distance: {directive.distanceFromRequesterKm.toFixed(1)} km</p>
                  )}
                  <p>Responders: {directive.respondersConnected ?? directive.respondersCount ?? 0}</p>
                  <p>Victims: {directive.victimsCount ?? 0}</p>
                  {directive.createdAt && <p>Reported: {new Date(directive.createdAt).toLocaleString()}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {user?.role === "authority" && (
      <header>
        <h1 className="text-xl font-semibold">Assigned Volunteer Requests</h1>
        <p className="text-sm text-muted-foreground">
          Review applications routed to your authority profile.
        </p>
      </header>
      )}

      {user?.role === "authority" && loading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading applications...
        </div>
      ) : user?.role === "authority" && applications.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          No assigned applications yet.
        </div>
      ) : user?.role === "authority" ? (
        <div className="space-y-3">
          {applications.map((application) => (
            <article key={application._id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Application #{application._id.slice(-6)}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{application.status}</p>
              </div>

              {/* User Profile Information */}
              {application.userProfile && <UserProfileCard profile={application.userProfile} />}

              <p className="mt-3 text-sm text-muted-foreground">
                Skills: {application.skills.join(", ") || "N/A"}
              </p>
              <p className="text-sm text-muted-foreground">
                Preferred roles: {application.preferredRoles.join(", ") || "N/A"}
              </p>

              {application.experience && (
                <p className="text-sm text-muted-foreground">
                  Experience: {application.experience}
                </p>
              )}

              {(application.documents ?? []).length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-foreground">Documents</p>
                  {(application.documents ?? []).map((doc, index) => (
                    <a
                      key={`${application._id}-doc-${index}`}
                      href={doc.signedUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-xs text-emerald-500 hover:underline"
                    >
                      {doc.name || `Document ${index + 1}`}
                    </a>
                  ))}
                </div>
              )}

              {application.status === "pending" && (
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    disabled={reviewingId === application._id}
                    onClick={() => handleReview(application._id, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewingId === application._id}
                    onClick={() => handleReview(application._id, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}

export default Overview;
