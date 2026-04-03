import { useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { SettingSidebar } from "@/components/nav/SettingSidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuthServices } from "@/services";

function ProfileSettings() {
  const { section = "security" } = useParams<{ section: string }>();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isSecuritySection = useMemo(() => section === "security", [section]);

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentPassword.trim() || !newPassword.trim() || !confirmNewPassword.trim()) {
      toast.error("Please fill all password fields.");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast.error("New passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      await AuthServices.adminChangePassword({
        currentPassword,
        newPassword,
        confirmNewPassword,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      toast.success("Password changed successfully.");
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { message?: string; error?: string } } }).response
          ?.data?.message === "string"
          ? (error as { response?: { data?: { message?: string; error?: string } } }).response!.data!
              .message!
          : typeof error === "object" &&
              error !== null &&
              "response" in error &&
              typeof (error as { response?: { data?: { message?: string; error?: string } } }).response
                ?.data?.error === "string"
            ? (error as { response?: { data?: { message?: string; error?: string } } }).response!.data!
                .error!
            : "Failed to change password.";

      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex h-full w-full">
      <SettingSidebar />

      <section className="h-full flex-1 overflow-auto px-6 py-10">
        <div className="mx-auto w-full max-w-2xl">
          {isSecuritySection ? (
            <article className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h1 className="text-2xl font-semibold tracking-tight">Security & Privacy</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Change your account password.
              </p>

              <form onSubmit={handleChangePassword} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <p className="text-sm">Current Password</p>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm">New Password</p>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Enter new password"
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm">Confirm New Password</p>
                  <Input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                </div>

                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "Updating Password..." : "Change Password"}
                </Button>
              </form>
            </article>
          ) : (
            <article className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h1 className="text-2xl font-semibold tracking-tight">{section}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This settings section is coming soon.
              </p>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}

export default ProfileSettings;
