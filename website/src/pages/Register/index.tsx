import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import AuthCard from "../Auth/AuthCard";
import AuthField from "../Auth/AuthField";
import AuthMessage from "../Auth/AuthMessage";
import AuthShell from "../Auth/AuthShell";
import AuthSubmitButton from "../Auth/AuthSubmitButton";
import { registerRequest } from "../Auth/api";

export default function Register() {
  const navigate = useNavigate();
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
      await registerRequest(name, email, password);
      navigate("/signin");
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
