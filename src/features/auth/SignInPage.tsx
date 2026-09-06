import { Avatar, AvatarFallback, Button } from "@/shared/ui";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { Trash2, UserPlus } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import AuthCard from "./components/AuthCard";
import AuthField from "./components/AuthField";
import AuthMessage from "./components/AuthMessage";
import AuthShell from "./components/AuthShell";
import AuthSubmitButton from "./components/AuthSubmitButton";
import type { SavedAccountSession } from "./model/stores/account/interfaces/useAuthTokenStore";
import { clearAccountCreating } from "@/features/onboarding";
import { accountSignIn } from "./store/useAccountStore";

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accounts, authenticateAccount, resumeAccount, removeAccount } = useAuth();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const from = routeState?.from || (isNativeMobileBuild ? "/home" : "/files");
  const addingAccount = Boolean(routeState?.addingAccount);
  const [mode, setMode] = useState<"chooser" | "login">(
    accounts.length > 0 && !addingAccount ? "chooser" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await authenticateAccount(() => accountSignIn(email, password));
      if (user?.id) clearAccountCreating(user.id);
      navigate(from, { replace: true });
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(account: SavedAccountSession) {
    if (busyAccountId) return;
    setError("");
    setBusyAccountId(account.id);
    try {
      await resumeAccount(account.id);
      clearAccountCreating(account.id);
      navigate(from, { replace: true });
    } catch {
      // The saved token is no longer valid: fall to the login form for this account.
      setEmail(account.email);
      setPassword("");
      setMode("login");
      setError(`Your session for ${account.email} has expired. Please sign in again.`);
    } finally {
      setBusyAccountId("");
    }
  }

  async function handleRemove(account: SavedAccountSession) {
    if (busyAccountId) return;
    setBusyAccountId(account.id);
    try {
      await removeAccount(account.id);
      if (accounts.length <= 1) setMode("login");
    } finally {
      setBusyAccountId("");
    }
  }

  if (mode === "chooser") {
    return (
      <AuthShell
        title="Choose an account"
        description="Pick a signed-in Misty account to continue, or add another."
      >
        <AuthCard>
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="group flex items-center gap-2 rounded-lg border border-charcoal-border p-1 transition hover:border-charcoal-active"
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 justify-start gap-3 p-1.5 text-left font-normal"
                  onClick={() => void handleSelect(account)}
                  disabled={Boolean(busyAccountId)}
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="text-xs font-semibold">
                      {accountInitials(account.name || account.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-cream">
                      {account.name || account.email}
                    </span>
                    <span className="block truncate text-xs text-cream-muted">{account.email}</span>
                  </span>
                  {busyAccountId === account.id ? (
                    <span className="shrink-0 pr-1 text-xs text-cream-muted">Signing in…</span>
                  ) : null}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${account.email}`}
                  title="Remove from this device"
                  className="mr-1 text-cream-muted opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => void handleRemove(account)}
                  disabled={Boolean(busyAccountId)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            {error ? <AuthMessage tone="error" message={error} /> : null}
            <Button
              type="button"
              variant="outline"
              className="mt-1 h-11 justify-start border-dashed px-3 text-cream-muted"
              onClick={() => {
                setError("");
                setEmail("");
                setPassword("");
                setMode("login");
              }}
            >
              <UserPlus size={16} className="shrink-0" />
              Use another account
            </Button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={
        addingAccount ? "Add another account" : accounts.length > 0 ? "Sign in" : "Welcome to Misty"
      }
      description={
        addingAccount
          ? "Your current account will remain signed in on this device."
          : "Sign in to begin."
      }
      onBack={
        addingAccount
          ? () => navigate(from, { replace: true })
          : accounts.length > 0
            ? () => {
                setError("");
                setMode("chooser");
              }
            : undefined
      }
    >
      <AuthCard
        footer={
          <div className="text-center text-sm text-cream-muted">
            <NavLink
              to="/register"
              state={{ from, addingAccount }}
              className="transition hover:text-cream"
            >
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
          <AuthSubmitButton idleLabel="Sign in" loadingLabel="Signing in..." loading={loading} />
        </form>
      </AuthCard>
    </AuthShell>
  );
}

function accountInitials(text: string): string {
  const parts = text
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
  return (letters || text.slice(0, 2)).toUpperCase();
}
