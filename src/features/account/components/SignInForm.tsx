import { isMistyCloud, mistyWebsite, useServerChoice } from "@/api/deployment/server_choice";
import { Button } from "@misty/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "../AuthContext";
import { accountSignIn } from "../sessions/use_account_store";
import AuthField from "./AuthField";
import AuthMessage from "./AuthMessage";
import AuthSubmitButton from "./AuthSubmitButton";
import GoogleSignInButton from "./GoogleSignInButton";

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
  const cloud = useServerChoice((state) => isMistyCloud(state.choice));

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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
        {cloud ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            className="self-start"
            onClick={() => void openUrl(`${mistyWebsite()}/sign-in`)}
          >
            Forgot your password?
          </Button>
        ) : null}
      </div>
      {props.error ? <AuthMessage tone="error" message={props.error} /> : null}
      <AuthSubmitButton idleLabel="Sign in" loading={loading} disabled={transitioning} />
      <GoogleSignInButton
        disabled={loading || transitioning}
        onBusy={setLoading}
        onError={props.onErrorChange}
        onSuccess={props.onSuccess}
      />
    </form>
  );
}
