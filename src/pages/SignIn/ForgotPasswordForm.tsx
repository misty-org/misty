import { Button } from "@/components/ui/button";
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
          <AuthMessage tone="success" message="Check your email for the reset link." />
        ) : null}
        {error ? <AuthMessage tone="error" message={error} /> : null}

        <AuthSubmitButton
          idleLabel={buttonLabel}
          loadingLabel="Sending..."
          loading={loading}
          disabled={submitted && resendCooldown > 0}
        />
      </form>

      <Button
        type="button"
        variant="link"
        onClick={onBack}
        className="h-auto self-start p-0 text-foreground"
      >
        Back to sign in
      </Button>
    </>
  );
}
