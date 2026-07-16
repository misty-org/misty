import { FormEvent, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AuthCard from "../../../auth/components/AuthCard";
import AuthField from "../../../auth/components/AuthField";
import AuthMessage from "../../../auth/components/AuthMessage";
import AuthShell from "../../../auth/components/AuthShell";
import AuthSubmitButton from "../../../auth/components/AuthSubmitButton";
import { useAuth } from "../../../auth/AuthContext";
import type { CurrentLicense } from "../../../models/setup";
import {
  accountFetchMe,
  accountSignIn,
  type AccountMeResponse,
} from "../../Account/shared/api";
import { useSetupStore } from "../../../stores/useSetupStore";

function licenseFromMe(me: AccountMeResponse | null): CurrentLicense | null {
  if (!me) return null;
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const from = routeState?.from || "/home";
  const addingAccount = Boolean(routeState?.addingAccount);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await accountSignIn(email, password);
      const me = await accountFetchMe().catch(() => null);
      await saveAuthenticatedUser(user, licenseFromMe(me));
      setUser({ ...user, accountCreatedAt: me?.created_at, currentPlan: me?.tier });
      navigate(from, { replace: true });
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not sign in.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={addingAccount ? "Add another account" : "Welcome back"} description={addingAccount ? "Your current account will remain signed in on this device." : "Sign in to your Misty account."} onBack={addingAccount ? () => navigate(from, { replace: true }) : undefined}>
      <AuthCard
        footer={
          <div className="text-center text-sm text-text-muted">
            <NavLink to="/register" state={{ from, addingAccount }} className="transition hover:text-text">
              Don&apos;t have an account? Sign up
            </NavLink>
          </div>
        }
      >
        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <AuthField
            id="signin-email"
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
            id="signin-password"
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="Password"
            required
            disabled={loading}
            onChange={setPassword}
          />
          {error ? <AuthMessage tone="error" message={error} /> : null}
          <AuthSubmitButton
            idleLabel="Sign In"
            loadingLabel="Signing in..."
            loading={loading}
          />
        </form>
      </AuthCard>
    </AuthShell>
  );
}
