import AuthField from "../Auth/AuthField";
import AuthMessage from "../Auth/AuthMessage";
import AuthSubmitButton from "../Auth/AuthSubmitButton";

interface ForgotPasswordFormProps {
  email: string;
  loading: boolean;
  error: string;
  submitted: boolean;
  resendCooldown: number;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}

export default function ForgotPasswordForm({
  email,
  loading,
  error,
  submitted,
  resendCooldown,
  onEmailChange,
  onSubmit,
  onBack,
}: ForgotPasswordFormProps) {
  const buttonLabel = submitted
    ? resendCooldown > 0
      ? `Resend in ${resendCooldown}s`
      : "Resend link"
    : "Send reset link";

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <AuthField
          id="forgot-email"
          type="email"
          label="Email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          required
          disabled={loading || (submitted && resendCooldown > 0)}
          onChange={onEmailChange}
        />

        {submitted ? (
          <p className="text-sm text-text-muted">
            Check your email for the reset link.
          </p>
        ) : null}
        {error ? <AuthMessage tone="error" message={error} /> : null}

        <AuthSubmitButton
          idleLabel={buttonLabel}
          loadingLabel="Sending..."
          loading={loading}
          disabled={submitted && resendCooldown > 0}
        />
      </form>

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-text-muted transition hover:text-text"
      >
        Back to sign in
      </button>
    </>
  );
}
