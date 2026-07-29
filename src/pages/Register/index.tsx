import { useState } from "react";
import { NavLink, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { marketingCopy } from "@/content/marketingCopy";
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await registerRequest(name, email, password);
      navigate("/signin");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not connect to server",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={marketingCopy.auth.registerTitle}
      description={marketingCopy.auth.registerDescription}
    >
      <AuthCard
        footer={
          <Button
            asChild
            variant="link"
            className="h-auto p-0 text-foreground"
          >
            <NavLink to="/signin">Already have an account? Sign in</NavLink>
          </Button>
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <AuthField
            id="register-name"
            label="Name"
            value={name}
            autoComplete="name"
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
