import { FormEvent, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AuthCard from "../../../auth/components/AuthCard";
import AuthField from "../../../auth/components/AuthField";
import AuthMessage from "../../../auth/components/AuthMessage";
import AuthShell from "../../../auth/components/AuthShell";
import AuthSubmitButton from "../../../auth/components/AuthSubmitButton";
import { useAuth } from "../../../auth/AuthContext";
import {
  accountFetchMe,
  accountRegister,
  type AccountMeResponse,
} from "../../Account/shared/api";
import type { CurrentLicense } from "../../../models/setup";
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

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);
  const from = (location.state as { from?: string } | null)?.from || "/home";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await accountRegister(name, email, password);
      const me = await accountFetchMe().catch(() => null);
      await saveAuthenticatedUser(user, licenseFromMe(me));
      setUser({ ...user, accountCreatedAt: me?.created_at, currentPlan: me?.tier });
      navigate(from, { replace: true });
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : "Could not create account.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Create an account" description="Sign up to get started.">
      <AuthCard
        footer={
          <div className="text-center text-sm text-text-muted">
            <NavLink to="/signin" className="transition hover:text-text">
              Already have an account? Sign in
            </NavLink>
          </div>
        }
      >
        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <AuthField
            id="register-name"
            label="Name"
            value={name}
            autoComplete="name"
            placeholder="Your name"
            required
            disabled={loading}
            onChange={setName}
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
        </form>
      </AuthCard>
    </AuthShell>
  );
}
