import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AuthServices } from "@/services";
import { useAppSelector } from "@/store/hooks";

type VolunteerApplication = {
  _id: string;
  skills: string[];
  preferredRoles: string[];
  status: "pending" | "approved" | "rejected";
  createdAt?: string;
  documents?: Array<{ name?: string; signedUrl?: string | null }>;
};

function Overview() {
  const user = useAppSelector((state) => state.auth.authData);
  const [applications, setApplications] = useState<VolunteerApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

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

  const handleReview = async (applicationId: string, status: "approved" | "rejected") => {
    setReviewingId(applicationId);
    try {
      await AuthServices.reviewVolunteerApplication(applicationId, { status });
      setApplications((current) =>
        current.map((application) =>
          application._id === applicationId ? { ...application, status } : application,
        ),
      );
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

  if (user?.role !== "authority") {
    return <main className="p-6" />;
  }

  return (
    <main className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">Assigned Volunteer Requests</h1>
        <p className="text-sm text-muted-foreground">
          Review applications routed to your authority profile.
        </p>
      </header>

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading applications...
        </div>
      ) : applications.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          No assigned applications yet.
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((application) => (
            <article key={application._id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Application #{application._id.slice(-6)}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{application.status}</p>
              </div>

              <p className="mt-2 text-sm text-muted-foreground">
                Skills: {application.skills.join(", ") || "N/A"}
              </p>
              <p className="text-sm text-muted-foreground">
                Preferred roles: {application.preferredRoles.join(", ") || "N/A"}
              </p>

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
      )}
    </main>
  );
}

export default Overview;
