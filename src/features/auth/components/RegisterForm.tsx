import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "../AuthContext";
import { accountRegister } from "../store/useAccountStore";
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
      setError(
        registerError instanceof Error ? registerError.message : "Could not create account.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
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
        loadingLabel="Creating account..."
        loading={loading}
      />
      <div className="flex items-center gap-3 text-xs text-cream-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-charcoal-border" />
        or
        <span className="h-px flex-1 bg-charcoal-border" />
      </div>
      <GoogleSignInButton
        disabled={loading}
        onBusy={setLoading}
        onError={setError}
        onSuccess={props.onSuccess}
      />
    </form>
  );
}
