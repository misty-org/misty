import { mistyWebsite } from "@/api/deployment/serverChoice";
import { Button } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "../AuthContext";
import { accountSignIn } from "../store/useAccountStore";
import AuthField from "./AuthField";
import AuthMessage from "./AuthMessage";
import AuthSubmitButton from "./AuthSubmitButton";
import GoogleSignInButton from "./GoogleSignInButton";

/** Email and password, and Google: the sign-in page and the sign-in sheet share it. The email
 * and the error belong to the host, which keeps them across its other screens. A forgotten
 * password is reset with a sign-in link, which the website's page sends or says how to get. */
export default function SignInForm(props: {
  email: string;
  onEmailChange: (email: string) => void;
  error: string;
  onErrorChange: (error: string) => void;
  onSuccess: () => void;
}) {
  const { transitioning, authenticateAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onErrorChange("");
    setLoading(true);
    try {
      await authenticateAccount(() => accountSignIn(props.email, password));
      props.onSuccess();
    } catch (signInError) {
      props.onErrorChange(
        signInError instanceof Error ? signInError.message : "Could not sign in.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <AuthField
        id="signin-email"
        label="Email"
        type="email"
        value={props.email}
        autoComplete="email"
        placeholder="you@example.com"
        required
        disabled={loading || transitioning}
        onChange={props.onEmailChange}
      />
      <div className="flex flex-col gap-2">
        <AuthField
          id="signin-password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="••••••••"
          required
          disabled={loading || transitioning}
          onChange={setPassword}
        />
        <Button
          type="button"
          variant="link"
          className="h-auto self-start p-0 text-sm text-cream"
          onClick={() => void openUrl(`${mistyWebsite()}/sign-in`)}
        >
          Forgot your password?
        </Button>
      </div>
      {props.error ? <AuthMessage tone="error" message={props.error} /> : null}
      <AuthSubmitButton
        idleLabel="Sign in"
        loadingLabel="Signing in…"
        loading={loading}
        disabled={transitioning}
      />
      <GoogleSignInButton
        disabled={loading || transitioning}
        onBusy={setLoading}
        onError={props.onErrorChange}
        onSuccess={props.onSuccess}
      />
    </form>
  );
}
