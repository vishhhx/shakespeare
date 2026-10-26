import { Button } from "@/components/ui/button";
import Logo from "../../../components/other/logo";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addUser } from "@/store/slices/authSlice";
import { AuthServices } from "@/services";
import { Wallet } from "ethers";
import { useSocket } from "@/context/socket";
import { decryptPrivateKey, getKeyFromUSB } from "@/utils";

const getInputValue = (form: HTMLFormElement, fieldName: string) =>
  (form.elements.namedItem(fieldName) as HTMLInputElement).value;

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } }).response;
    return response?.data?.message || response?.data?.error || fallback;
  }

  return fallback;
};

function Login() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const authData = useAppSelector((state) => state.auth.authData);
  const { socket } = useSocket();
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [selectedRole, setSelectedRole] = useState<"responder" | "authority" | "controller-center">("responder");

  const buildAuthoritySignature = async (form: HTMLFormElement, email: string) => {
    const keyPassword = getInputValue(form, "keyPassword");
    if (!keyPassword.trim()) {
      throw new Error("Authority login requires the key password.");
    }

    const keyData = await getKeyFromUSB();
    if (keyData.type !== "SecureKey") {
      throw new Error("Invalid key file selected.");
    }

    const privateKey = await decryptPrivateKey(keyData.encryptedPrivateKey, keyPassword);
    const { challenge } = await AuthServices.adminChallenge(email);
    return new Wallet(privateKey).signMessage(challenge);
  };

  useEffect(() => {
    if (authData?.token) {
      const nextPath = authData.role === "controller-center" ? "/add-authority" : "/overview";
      navigate(nextPath, { replace: true });
    }
  }, [authData?.token, authData?.role, navigate]);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    try {
      e.preventDefault();
      setError(null);

      const form = e.currentTarget;
      const email = getInputValue(form, "email");
      const password = getInputValue(form, "password");
      const role = selectedRole;

      if (!email.trim() || !password.trim()) {
        setError("Email and password are required.");
        return;
      }

      let signature: string | undefined;

      if (role === "authority") {
        signature = await buildAuthoritySignature(form, email);
      }

      const response = await AuthServices.adminLogin({
        email,
        password,
        role,
        signature,
      });

      const authPayload = {
        _id: response.safeUser.userId,
        name: response.safeUser.name,
        email: response.safeUser.email,
        role: response.safeUser.role,
        token: response.token,
        isVerified: response.safeUser.isverified,
        isprofileComplete: response.safeUser.isprofileComplete,
      };

      localStorage.setItem("safesphere-auth", JSON.stringify(authPayload));
      dispatch(addUser(authPayload));
      socket?.connect();
      const nextPath = authPayload.role === "controller-center" ? "/add-authority" : "/overview";
      navigate(nextPath, { replace: true });
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Login failed");
      setError(message);
      if (message.toLowerCase().includes("verification")) {
        setNeedsVerification(true);
        setVerificationEmail(getInputValue(e.currentTarget, "email"));
      }
    }
  };

  const handleVerification = async () => {
    try {
      setError(null);
      await AuthServices.adminVerifyVerificationCode(verificationEmail, verificationCode);
      setNeedsVerification(false);
      setVerificationCode("");
      alert("Email verified. You can log in now.");
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Verification failed"));
    }
  };

  const handleResendCode = async () => {
    try {
      setError(null);
      await AuthServices.adminSendVerificationCode(verificationEmail);
      alert("Verification code sent again.");
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Unable to resend code"));
    }
  };

  return (
    <div className="h-full w-full flex justify-center items-center px-4 py-10 lg:py-16">
      <div className="w-full max-w-md flex flex-col gap-1">
        <div className="flex flex-col gap-2">
          <Logo />

          <p className="text-2xl font-bold dark:text-neutral-100 text-neutral-900">
            Login in to your account
          </p>

          <form className="mt-6 flex flex-col gap-3" onSubmit={handleLogin}>
            <div>
              <p className=" dark:text-neutral-100 text-neutral-900 mb-2 ml-1 text-sm">
                Role
              </p>
              <Select
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(value as typeof selectedRole)}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="responder">Responder</SelectItem>
                  <SelectItem value="authority">Authority</SelectItem>
                  <SelectItem value="controller-center">Controller Center</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className=" dark:text-neutral-100 text-neutral-900 mb-2 ml-1 text-sm">
                Email address
              </p>
              <Input name="email" type="email" placeholder="tylordurdun@f****c****.com" />
            </div>
            <div>
              <p className=" dark:text-neutral-100 text-neutral-900 mb-3 ml-1 text-sm">
                Password
              </p>
              <Input
                name="password"
                type="password"
                placeholder="......."
                autoComplete="current-password"
              />
            </div>

            {selectedRole === "authority" && (
              <div>
                <p className=" dark:text-neutral-100 text-neutral-900 mb-3 ml-1 text-sm">
                  Key password
                </p>
                <Input
                  name="keyPassword"
                  type="password"
                  placeholder="Password used to decrypt your secure key file"
                  autoComplete="current-password"
                  required
                />
              </div>
            )}

            <p className=" dark:text-neutral-300 text-neutral-600 ml-1 text-sm cursor-pointer" >
              Forgot password?
            </p>

            <div className="flex flex-col justify-center items-center gap-1 mt-6">
              <Button type="submit" className="w-full cursor-pointer">
                {selectedRole === "authority" ? "Login with Secure Key" : "Login"}
              </Button>
            </div>
          </form>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {needsVerification && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">
                Enter the verification code sent to {verificationEmail}.
              </p>
              <Input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="Verification code"
              />
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={handleVerification}>
                  Verify email
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={handleResendCode}>
                  Resend code
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center gap-6">
          <p className="dark:text-neutral-400 text-neutral-500 mb-4 ml-1 text-sm text-center tracking-normal">
            By clicking on sign in, you agree to our Terms of Service and
            Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
