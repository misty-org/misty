import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../../AuthContext";
import AuthCard from "../Auth/AuthCard";
import AuthShell from "../Auth/AuthShell";
import { forgotPasswordRequest, signInRequest } from "../Auth/api";
import ForgotPasswordForm from "./ForgotPasswordForm";
import SignInForm from "./SignInForm";

type SignInMode = "signin" | "forgot";

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const from = (location.state as { from?: string })?.from || "/";

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
      setUser(user);
      navigate(from, { replace: true });
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
      ? "Sign in to your Misty account."
      : "Enter your email and we’ll send a reset link.";

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
