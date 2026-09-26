import { Avatar, AvatarFallback, Button } from "@/shared/ui";
import { Trash2, UserPlus } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { Navigate, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { SavedAccountSessionUnavailableError } from "./sessionErrors";
import AuthCard from "./components/AuthCard";
import AuthField from "./components/AuthField";
import AuthMessage from "./components/AuthMessage";
import AuthShell from "./components/AuthShell";
import AuthSubmitButton from "./components/AuthSubmitButton";
import ForgotPasswordForm from "./components/ForgotPasswordForm";
import type { SavedAccountSession } from "./model/stores/account/interfaces/useAuthTokenStore";
import { accountSignIn } from "./store/useAccountStore";

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accounts, user, transitioning, authenticateAccount, resumeAccount, removeAccount } =
    useAuth();
  const routeState = location.state as {
    from?: string;
    addingAccount?: boolean;
    reauthenticateEmail?: string;
  } | null;
  const rawFrom = routeState?.from;
  const from =
    rawFrom && !rawFrom.startsWith("/signin") && !rawFrom.startsWith("/register")
      ? rawFrom
      : "/browser";
  const addingAccount = Boolean(routeState?.addingAccount);
  const reauthenticateEmail = routeState?.reauthenticateEmail ?? "";
  const [mode, setMode] = useState<"chooser" | "login" | "forgot">(
    accounts.length > 0 && !addingAccount ? "chooser" : "login",
  );
  const [email, setEmail] = useState(reauthenticateEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    reauthenticateEmail
      ? `Your saved sign-in for ${reauthenticateEmail} has expired. Sign in again to switch to it.`
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authenticateAccount(() => accountSignIn(email, password));
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
      navigate(from, { replace: true });
    } catch (resumeError) {
      if (resumeError instanceof SavedAccountSessionUnavailableError) {
        setEmail(account.email);
        setPassword("");
        setMode("login");
        setError(
          `Your saved sign-in for ${account.email} is no longer available. Please sign in again.`,
        );
      } else {
        const detail =
          resumeError instanceof Error
            ? resumeError.message
            : String(resumeError || "Please try again.");
        setError(`Could not resume this account. ${detail}`);
      }
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

  // A route guard may reach sign-in before the saved identity finishes loading.
  // Only an explicit Add account action should keep a signed-in user here.
  if (user && !addingAccount && !transitioning) return <Navigate to={from} replace />;

  if (mode === "chooser") {
    return (
      <AuthShell
        title="Choose an account"
        onBack={user ? () => navigate(from, { replace: true }) : undefined}
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
                  disabled={Boolean(busyAccountId) || transitioning}
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
                  disabled={Boolean(busyAccountId) || transitioning}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            {transitioning && !busyAccountId ? (
              <p role="status" className="text-sm text-cream-muted">
                Updating session…
              </p>
            ) : null}
            {error ? <AuthMessage tone="error" message={error} /> : null}
            <Button
              type="button"
              variant="outline"
              className="mt-1 h-11 justify-start border-dashed px-3 text-cream-muted"
              disabled={Boolean(busyAccountId) || transitioning}
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

  if (mode === "forgot") {
    return (
      <AuthShell title="Forgot your password?">
        <AuthCard>
          <ForgotPasswordForm
            initialEmail={email}
            onBack={() => {
              setError("");
              setMode("login");
            }}
          />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={
        reauthenticateEmail
          ? "Sign in again"
          : addingAccount
            ? "Add another account"
            : "Welcome back"
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
          <NavLink
            to="/register"
            state={{ from, addingAccount }}
            className="text-sm font-medium text-cream underline-offset-4 hover:underline"
          >
            Don&apos;t have an account? Create one
          </NavLink>
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
            disabled={loading || transitioning}
            onChange={setEmail}
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
              className="h-auto self-start p-0 text-cream"
              onClick={() => {
                setError("");
                setMode("forgot");
              }}
            >
              Forgot your password?
            </Button>
          </div>
          {error ? <AuthMessage tone="error" message={error} /> : null}
          <AuthSubmitButton
            idleLabel="Sign In"
            loadingLabel="Signing in..."
            loading={loading}
            disabled={transitioning}
          />
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
