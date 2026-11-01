import { useAuth } from "../authState";
import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { accountSetFirstPassword } from "../store/accountPassword";
import { passwordResetToken } from "../store/passwordReset";
import { pendingPasswordEmail } from "../store/pendingPassword";
import { Button, Spinner } from "@/shared/ui";
import { useState, type FormEvent } from "react";

/**
 * Right after a setup key signs in: the account's first password, or, for an account that has
 * one, a new password in place of a forgotten one (the server sends no email, so a sign-in link
 * is the reset). It signs in on other computers and opens the sync vault, so sync stays off
 * until a first one is set. Leaving it for later is allowed; for a first password the wizard
 * asks again the next time the account is signed in here.
 */
export function ChoosePasswordScreen(props: {
  onDone: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { user } = useAuth();
  // An account that already has a password is resetting it.
  const resetting = Boolean(user && !pendingPasswordEmail(user.id) && passwordResetToken(user.id));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      setError("Your session ended. Use a new setup key to sign in again.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords don't match.");
      return;
    }
    setError("");
    setBusy(true);
    props.onBusy(true);
    try {
      // The keys come from the email the account was signed in with, as the server spelled it.
      await accountSetFirstPassword(user.id, pendingPasswordEmail(user.id) ?? user.email, password);
      props.onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Misty couldn't set that password.");
    } finally {
      setBusy(false);
      props.onBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
      <AuthField
        id="first-password"
        label="Password"
        type="password"
        value={password}
        autoComplete="new-password"
        required
        disabled={busy}
        onChange={setPassword}
      />
      <AuthField
        id="first-password-confirm"
        label="Confirm password"
        type="password"
        value={confirmation}
        autoComplete="new-password"
        required
        disabled={busy}
        onChange={setConfirmation}
      />
      <p className="m-0 text-sm text-cream-muted">
        {resetting
          ? "Synced data encrypted with your old password stays locked. If no other computer has it open, reset sync in Settings › Sync."
          : "Your synced data is encrypted with it on this computer. Misty can't reset it without erasing what's synced, so keep it somewhere safe."}
      </p>
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={busy || !password || !confirmation}
        aria-busy={busy}
      >
        {busy ? <Spinner size="sm" label={false} /> : null}
        Continue
      </Button>
    </form>
  );
}
