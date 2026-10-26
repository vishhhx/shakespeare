import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Wallet } from "ethers";
import { ShieldPlus, KeyRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AuthServices, EmergencyServices } from "@/services";
import type { AuthorityOption } from "@/services/emergencyServices";
import { errorMessage } from "@/lib/emergency";
import { encryptPrivateKey, saveEncryptedKeyToUSB } from "@/utils";
import { useAppSelector } from "@/store/hooks";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function AddAuthority() {
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.authData);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isControllerCenter = useMemo(() => user?.role === "controller-center", [user?.role]);

  const handleAddAuthority = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isControllerCenter) {
      toast.error("Only controller-center can create authorities.");
      return;
    }

    if (!name.trim() || !email.trim() || !password.trim() || !keyPassword.trim()) {
      toast.error("Please fill out all fields.");
      return;
    }

    if (password.trim().length < 8) {
      toast.error("Account password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      const authorityWallet = Wallet.createRandom();

      const response = await AuthServices.adminRegister({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "authority",
        publicKey: authorityWallet.address,
      });

      const createdAuthorityUserId = response?.safeUser?.userId as string | undefined;
      if (!createdAuthorityUserId) {
        throw new Error("Authority account created but user id was not returned.");
      }

      const encryptedPrivateKey = await encryptPrivateKey(authorityWallet.privateKey, keyPassword);
      const suggestedName = `safesphere-authority-${email
        .trim()
        .replace(/[^a-zA-Z0-9]/g, "-")}.json`;
      await saveEncryptedKeyToUSB(encryptedPrivateKey, suggestedName);

      toast.success("Authority account created. Complete profile details next.");
      setName("");
      setEmail("");
      setPassword("");
      setKeyPassword("");
      navigate(`/authority-profile/${createdAuthorityUserId}`, {
        state: { name: name.trim(), email: email.trim() },
      });
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { error?: string; message?: string } } }).response
          ?.data?.error === "string"
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response!
              .data!.error!
          : typeof error === "object" &&
              error !== null &&
              "response" in error &&
              typeof (error as { response?: { data?: { error?: string; message?: string } } })
                .response?.data?.message === "string"
            ? (error as { response?: { data?: { error?: string; message?: string } } }).response!
                .data!.message!
            : error instanceof Error
              ? error.message
              : "Failed to create authority account.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isControllerCenter) {
    return (
      <main className="p-6">
        <section className="mx-auto max-w-3xl rounded-xl border border-border bg-card/70 p-6 backdrop-blur">
          <h1 className="text-xl font-semibold text-foreground">Access Restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is available only to controller-center users.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="p-6">
      <section className="mx-auto max-w-3xl space-y-6 rounded-xl border border-border bg-card/70 p-6 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] backdrop-blur">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">Controller Center</p>
          <h1 className="text-2xl font-semibold text-foreground">Add Authority</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Provision a new authority identity. A protected key file will be generated for secure login.
          </p>
        </header>

        <form onSubmit={handleAddAuthority} className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-foreground">Authority Name</p>
            <Input
              id="authority-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Government Hospital Mysore"
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-foreground">Authority Email</p>
            <Input
              id="authority-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="authority@safesphere.gov"
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-foreground">Initial Password</p>
            <Input
              id="authority-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Set a secure password"
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              This is the authority account password used for backend login.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-foreground">Key Password</p>
            <Input
              id="authority-key-password"
              type="password"
              value={keyPassword}
              onChange={(event) => setKeyPassword(event.target.value)}
              placeholder="Used to encrypt the secure key file"
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              The authority user will need this key password to decrypt the saved key file.
            </p>
          </div>

          <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <p className="flex items-center gap-2 font-medium text-emerald-200">
              <KeyRound className="size-4" /> Key handling notice
            </p>
            <p className="mt-1">
              You will be prompted to save an encrypted key file after account creation. Share it securely
              with the authority user.
            </p>
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            <ShieldPlus className="mr-2 size-4" />
            {isSubmitting ? "Creating Authority..." : "Create Authority"}
          </Button>
        </form>
      </section>

      <ResponderForm />
    </main>
  );
}

/** Field responders belong to an authority; the control center provisions them here. */
function ResponderForm() {
  const [authorities, setAuthorities] = useState<AuthorityOption[]>([]);
  const [loadingAuthorities, setLoadingAuthorities] = useState(true);
  const [authorityProfileId, setAuthorityProfileId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    EmergencyServices.authorities()
      .then((response) => setAuthorities(response.authorities))
      .catch((error) => toast.error(errorMessage(error, "Couldn't load authorities.")))
      .finally(() => setLoadingAuthorities(false));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authorityProfileId || !name.trim() || !email.trim() || password.length < 8) {
      toast.error("Choose an authority and fill in every field (password at least 8 characters).");
      return;
    }
    setSubmitting(true);
    try {
      const response = await AuthServices.adminRegister({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "responder",
        authorityProfileId,
      });
      toast.success(
        response?.verificationRequired
          ? "Responder created. They'll get a verification code by email before first login."
          : "Responder created.",
      );
      setName("");
      setEmail("");
      setPassword("");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't create the responder."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto mt-6 max-w-3xl space-y-4 rounded-xl border border-border bg-card p-6">
      <header>
        <h2 className="text-xl font-semibold text-foreground">Add field responder</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Responders work for one authority. That authority and the control center can assign them to emergencies.
        </p>
      </header>
      {loadingAuthorities ? (
        <p className="text-sm text-muted-foreground">Loading authorities…</p>
      ) : authorities.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create an authority and complete its profile first.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 sm:col-span-2">
            <span className="text-sm text-foreground">Authority</span>
            <select
              value={authorityProfileId}
              onChange={(event) => setAuthorityProfileId(event.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">Choose the authority they work for…</option>
              {authorities.map((authority) => (
                <option key={authority.authorityProfileId} value={authority.authorityProfileId}>
                  {authority.name} · {authority.type}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm text-foreground">Full name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
          </label>
          <label className="space-y-2">
            <span className="text-sm text-foreground">Work email</span>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
          </label>
          <label className="space-y-2 sm:col-span-2">
            <span className="text-sm text-foreground">Initial password</span>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </label>
          <Button type="submit" disabled={submitting} className="sm:col-span-2">
            {submitting ? "Creating responder…" : "Create responder"}
          </Button>
        </form>
      )}
    </section>
  );
}

export default AddAuthority;
