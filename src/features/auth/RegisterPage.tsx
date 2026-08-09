import type { FormEvent } from "react";
import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import AuthCard from "./components/AuthCard";
import AuthField from "./components/AuthField";
import AuthMessage from "./components/AuthMessage";
import AuthShell from "./components/AuthShell";
import AuthSubmitButton from "./components/AuthSubmitButton";
import { accountRegister } from "./store/useAccountStore";

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authenticateAccount } = useAuth();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const from = routeState?.from || "/files";
  const addingAccount = Boolean(routeState?.addingAccount);
  const [name, setName] = useState("");
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
      await authenticateAccount(() => accountRegister(name, normalizedUsername, email, password));
      navigate(from, { replace: true });
    } catch (registerError) {
      setError(
        registerError instanceof Error ? registerError.message : "Could not create account.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={addingAccount ? "Create another account" : "Create an account"}
      description={
        addingAccount
          ? "Your current account will remain signed in on this device."
          : "Sign up to get started."
      }
      onBack={addingAccount ? () => navigate(from, { replace: true }) : undefined}
    >
      <AuthCard
        footer={
          <div className="text-center text-sm text-cream-muted">
            <NavLink
              to="/signin"
              state={{ from, addingAccount }}
              className="transition hover:text-cream"
            >
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
        </form>
      </AuthCard>
    </AuthShell>
  );
}
