import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import AuthCard from "../Auth/AuthCard";
import AuthField from "../Auth/AuthField";
import AuthMessage from "../Auth/AuthMessage";
import AuthShell from "../Auth/AuthShell";
import AuthSubmitButton from "../Auth/AuthSubmitButton";
import { resetPasswordRequest, validateResetTokenRequest } from "../Auth/api";
import NotFound from "../NotFound";

export default function ResetPassword() {
  const [validationState, setValidationState] = useState<"checking" | "ready" | "invalid">("checking");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    setValidationState("checking");

    validateResetTokenRequest()
      .then(() => {
        if (!cancelled) {
          setValidationState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setValidationState("invalid");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPasswordRequest(password);
      setSuccess("Your password has been updated. You can sign in with the new password now.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (err instanceof Error && err.message.includes("invalid or expired reset token")) {
        setValidationState("invalid");
      } else {
        setError(err instanceof Error ? err.message : "Could not connect to server");
      }
    } finally {
      setLoading(false);
    }
  }

  if (validationState === "invalid") {
    return <NotFound />;
  }

  if (validationState === "checking") {
    return (
      <AuthShell title="Reset your password" description="Checking your reset link.">
        <AuthCard>
          <p className="text-sm text-text-muted">Please wait a moment.</p>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Choose a new password."
    >
      <AuthCard
        title=""
        description=""
        footer={
          <div className="text-center text-sm text-text-muted">
            <NavLink to="/signin" className="transition hover:text-text">
              Back to sign in
            </NavLink>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <AuthField
            id="reset-password"
            type="password"
            label="New password"
            value={password}
            autoComplete="new-password"
            placeholder="Choose a strong password"
            required
            disabled={!!success}
            onChange={setPassword}
          />

          <AuthField
            id="reset-confirm-password"
            type="password"
            label="Confirm password"
            value={confirmPassword}
            autoComplete="new-password"
            placeholder="Repeat your new password"
            required
            disabled={!!success}
            onChange={setConfirmPassword}
          />

          {error ? <AuthMessage tone="error" message={error} /> : null}
          {success ? <AuthMessage tone="success" message={success} /> : null}

          <AuthSubmitButton
            idleLabel="Reset password"
            loadingLabel="Updating password..."
            loading={loading}
            disabled={!!success}
          />
        </form>
      </AuthCard>
    </AuthShell>
  );
}
