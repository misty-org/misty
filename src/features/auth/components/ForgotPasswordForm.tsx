import { Button } from "@/shared/ui";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { accountForgotPassword } from "../store/useAccountStore";
import AuthField from "./AuthField";
import AuthMessage from "./AuthMessage";
import AuthSubmitButton from "./AuthSubmitButton";

const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPasswordForm({ initialEmail, onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldown > 0) return;
    setError("");
    setLoading(true);
    try {
      await accountForgotPassword(email);
      setSubmitted(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (forgotError) {
      setError(
        forgotError instanceof Error ? forgotError.message : "Could not send the reset link.",
      );
    } finally {
      setLoading(false);
    }
  }

  const waiting = submitted && cooldown > 0;
  const idleLabel = submitted
    ? waiting
      ? `Resend in ${cooldown}s`
      : "Resend link"
    : "Send reset link";

  return (
    <div className="flex flex-col gap-5">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <AuthField
          id="forgot-email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          required
          disabled={loading || waiting}
          onChange={setEmail}
        />
        {submitted ? (
          <AuthMessage tone="success" message="Check your email for the reset link." />
        ) : null}
        {error ? <AuthMessage tone="error" message={error} /> : null}
        <AuthSubmitButton
          idleLabel={idleLabel}
          loadingLabel="Sending..."
          loading={loading}
          disabled={waiting}
        />
      </form>
      <Button
        type="button"
        variant="link"
        className="h-auto self-start p-0 text-cream"
        onClick={onBack}
      >
        Back to sign in
      </Button>
    </div>
  );
}

export interface ForgotPasswordFormProps {
  initialEmail: string;
  onBack: () => void;
}
