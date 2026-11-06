import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { ConfirmEmailSent } from "../store/confirmEmailSent";
import {
  accountRegister,
  accountSignIn,
  accountWaitForConfirmation,
} from "../store/useAccountStore";
import AuthField from "./AuthField";
import AuthMessage from "./AuthMessage";
import AuthSubmitButton from "./AuthSubmitButton";
import GoogleSignInButton from "./GoogleSignInButton";

/** Username, email and password, or Google: the Create account page and the sign-in sheet
 * share it. */
export default function RegisterForm(props: { onSuccess: () => void }) {
  const { authenticateAccount } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [waitEnded, setWaitEnded] = useState(false);

  // The password stays here while the link is opened, wherever that happens, so the app signs
  // itself in as soon as the account exists.
  useEffect(() => {
    if (!confirming) return;
    const waiting = new AbortController();
    accountWaitForConfirmation(email, password, waiting.signal)
      .then(() => authenticateAccount(() => accountSignIn(email, password)))
      .then(() => props.onSuccess())
      .catch(() => {
        if (!waiting.signal.aborted) setWaitEnded(true);
      });
    return () => waiting.abort();
    // Starts once, when the form moves to waiting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      setError("Username must be 3–30 letters, numbers, or underscores.");
      return;
    }
    setLoading(true);
    try {
      await authenticateAccount(() => accountRegister(normalizedUsername, email, password));
      props.onSuccess();
    } catch (registerError) {
      if (registerError instanceof ConfirmEmailSent) {
        setConfirming(true);
        return;
      }
      setError(
        registerError instanceof Error ? registerError.message : "Could not create account.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <p role="status" className="text-sm text-foreground">
        {waitEnded
          ? "Misty couldn't sign you in. Open the link in your email, then sign in with your password."
          : `We sent a link to ${email}. Open it to finish creating your account.`}
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <AuthField
        id="register-username"
        label="Username"
        value={username}
        autoComplete="username"
        placeholder="misty_user"
        minLength={3}
        maxLength={30}
        pattern="[a-zA-Z0-9_]{3,30}"
        required
        disabled={loading}
        onChange={setUsername}
      />
      <AuthField
        id="register-email"
        label="Email"
        type="email"
        value={email}
        autoComplete="email"
        placeholder="you@example.com"
        required
        disabled={loading}
        onChange={setEmail}
      />
      <AuthField
        id="register-password"
        label="Password"
        type="password"
        value={password}
        autoComplete="new-password"
        placeholder="Password"
        required
        disabled={loading}
        onChange={setPassword}
      />
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <AuthSubmitButton
        idleLabel="Create account"
        loadingLabel="Creating account…"
        loading={loading}
      />
      <GoogleSignInButton
        disabled={loading}
        onBusy={setLoading}
        onError={setError}
        onSuccess={props.onSuccess}
      />
    </form>
  );
}
