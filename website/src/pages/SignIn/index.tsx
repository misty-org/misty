import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useAuth } from "../../AuthContext";
import { safeInternalPath } from "@/lib/navigation";
import AuthCard from "../Auth/AuthCard";
import AuthShell from "../Auth/AuthShell";
import { forgotPasswordRequest, signInRequest, type AuthUser } from "../Auth/api";
import type { MeResponse } from "../AccountSettings/api";
import ForgotPasswordForm from "./ForgotPasswordForm";
import SignInForm from "./SignInForm";
import { marketingCopy } from "@/content/marketingCopy";

type SignInMode = "signin" | "forgot";

interface SignInContext {
  email: string;
  password: string;
  me: MeResponse | null;
}

interface SignInProps {
  onSignedIn?: (user: AuthUser, context: SignInContext) => void | Promise<void>;
}

export default function SignIn({ onSignedIn }: SignInProps = {}) {
  const { refreshSession } = useAuth();
  const location = useLocation();
  // The nav links have always set this state; until now nothing read it.
  const returnTo = safeInternalPath(
    (location.state as { from?: string } | null)?.from,
  );

  const [mode, setMode] = useState<SignInMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await signInRequest(email, password);
      const me = await refreshSession();
      await onSignedIn?.(user, { email, password, me });
      // Return to wherever the visitor was headed — a settings deep link from
      // the desktop app, say — instead of always dropping them on home.
      window.location.replace(returnTo ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (forgotSubmitted && resendCooldown > 0) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      await forgotPasswordRequest(email);
      setForgotSubmitted(true);
      setResendCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  function showForgotPassword() {
    setMode("forgot");
    setError("");
  }

  function showSignIn() {
    setMode("signin");
    setError("");
    setForgotSubmitted(false);
    setResendCooldown(0);
  }

  const cardTitle = mode === "signin" ? "Welcome back" : "Forgot your password?";
  const shellDescription =
    mode === "signin"
      ? marketingCopy.auth.signInDescription
      : marketingCopy.auth.forgotDescription;

  return (
    <AuthShell title={cardTitle} description={shellDescription}>
      <AuthCard title="" description="">
        <div className="flex flex-col gap-5">
          {mode === "signin" ? (
            <SignInForm
              email={email}
              password={password}
              loading={loading}
              error={error}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onSubmit={handleSignIn}
              onForgotPasswordClick={showForgotPassword}
            />
          ) : (
            <ForgotPasswordForm
              email={email}
              loading={loading}
              error={error}
              submitted={forgotSubmitted}
              resendCooldown={resendCooldown}
              onEmailChange={setEmail}
              onSubmit={handleForgotPassword}
              onBack={showSignIn}
            />
          )}
        </div>
      </AuthCard>
    </AuthShell>
  );
}
