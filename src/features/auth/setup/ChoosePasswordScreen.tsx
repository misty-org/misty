import { useAuth } from "../authState";
import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { accountSetFirstPassword } from "../store/accountPassword";
import { authButtonClass } from "../components/authButtonClass";
import { Button, Spinner } from "@/shared/ui";
import { useState, type FormEvent } from "react";

/**
 * Right after a setup key signs in: the account's first password, or a new one in place of a
 * forgotten one (a sign-in link is the reset). Leaving it for later is allowed.
 */
export function ChoosePasswordScreen(props: {
  onDone: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { user } = useAuth();
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
      await accountSetFirstPassword(user.id, password);
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
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className={authButtonClass}
        disabled={busy || !password || !confirmation}
        aria-busy={busy}
      >
        {busy ? <Spinner size="sm" label={false} /> : null}
        Continue
      </Button>
    </form>
  );
}
