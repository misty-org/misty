import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AuthCard from "../Auth/AuthCard";
import AuthField from "../Auth/AuthField";
import AuthMessage from "../Auth/AuthMessage";
import AuthShell from "../Auth/AuthShell";
import AuthSubmitButton from "../Auth/AuthSubmitButton";
import { useAuth } from "../../AuthContext";
import { registerRequest, type AuthUser } from "../Auth/api";
import { fetchMe, type MeResponse } from "../../../Account/desktop/api";

interface RegisterContext {
  email: string;
  password: string;
  me: MeResponse | null;
}

interface RegisterProps {
  onRegistered?: (user: AuthUser, context: RegisterContext) => void | Promise<void>;
}

export default function Register({ onRegistered }: RegisterProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const from = (location.state as { from?: string })?.from || "/home";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await registerRequest(name, email, password);
      const me = onRegistered ? await fetchMe() : null;
      await onRegistered?.(user, { email, password, me });
      setUser(user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create an account"
      description="Sign up to get started."
    >
      <AuthCard
        title=""
        description=""
        footer={
          <div className="text-center text-sm text-text-muted">
            <NavLink to="/signin" className="transition hover:text-text">
              Already have an account? Sign in
            </NavLink>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <AuthField
            id="register-name"
            label="Name"
            value={name}
            placeholder="Your name"
            required
            onChange={setName}
          />

          <AuthField
            id="register-email"
            type="email"
            label="Email"
            value={email}
            autoComplete="email"
            placeholder="you@example.com"
            required
            onChange={setEmail}
          />

          <AuthField
            id="register-password"
            type="password"
            label="Password"
            value={password}
            autoComplete="new-password"
            placeholder="••••••••"
            required
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
