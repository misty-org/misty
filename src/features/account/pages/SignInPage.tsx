import { routes } from "@/app/shell";
import { Avatar, AvatarFallback, Button, IconButton, Pressable } from "@/shared/ui";
import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Navigate, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { SavedAccountSessionUnavailableError } from "../sessions/sessionErrors";
import AuthCard from "../components/AuthCard";
import AuthMessage from "../components/AuthMessage";
import AuthShell from "../components/AuthShell";
import SignInForm from "../components/SignInForm";
import { ServerStep, useNeedsServer } from "../setup/ServerStep";
import { useFinishSignIn } from "../sign-in-sheet/useFinishSignIn";
import type { SavedAccountSession } from "../sessions/accountVault";

export default function SignIn() {
  const location = useLocation();
  const { accounts, user, transitioning, resumeAccount, removeAccount } = useAuth();
  const routeState = location.state as {
    from?: string;
    addingAccount?: boolean;
    reauthenticateEmail?: string;
  } | null;
  const rawFrom = routeState?.from;
  const from =
    rawFrom && !rawFrom.startsWith("/signin") && !rawFrom.startsWith("/register")
      ? rawFrom
      : routes.agents;
  const addingAccount = Boolean(routeState?.addingAccount);
  const finishSignIn = useFinishSignIn(from, !user);
  const needsServer = useNeedsServer();
  const reauthenticateEmail = routeState?.reauthenticateEmail ?? "";
  // Saved accounts come first, even when adding one; with none, straight to the login form.
  const [mode, setMode] = useState<"chooser" | "login">(
    accounts.length > 0 && !reauthenticateEmail ? "chooser" : "login",
  );
  const [email, setEmail] = useState(reauthenticateEmail);
  const [error, setError] = useState(
    reauthenticateEmail
      ? `Your saved sign-in for ${reauthenticateEmail} has expired. Sign in again to switch to it.`
      : "",
  );
  const [busyAccountId, setBusyAccountId] = useState("");

  async function handleSelect(account: SavedAccountSession) {
    if (busyAccountId) return;
    setError("");
    setBusyAccountId(account.id);
    try {
      await resumeAccount(account.id);
      finishSignIn();
    } catch (resumeError) {
      if (resumeError instanceof SavedAccountSessionUnavailableError) {
        setEmail(account.email);
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

  if (needsServer) {
    return (
      <AuthShell title="Choose a server">
        <AuthCard>
          <ServerStep />
        </AuthCard>
      </AuthShell>
    );
  }

  if (mode === "chooser") {
    return (
      <AuthShell title="Choose an account">
        <AuthCard>
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className={
                  "group flex items-center gap-1 rounded-lg border border-charcoal-border p-1 " +
                  "transition-colors hover:bg-control-hover focus-within:bg-control-hover"
                }
              >
                <Pressable
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5"
                  onClick={() => void handleSelect(account)}
                  disabled={Boolean(busyAccountId) || transitioning}
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="text-xs font-semibold">
                      {accountInitials(account.username || account.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-cream">
                      {account.username || account.email}
                    </span>
                    <span className="block truncate text-xs text-cream-muted">{account.email}</span>
                  </span>
                  {busyAccountId === account.id ? (
                    <span className="shrink-0 pr-1 text-xs text-cream-muted">Signing in…</span>
                  ) : null}
                </Pressable>
                <IconButton
                  label={`Remove ${account.email}`}
                  title="Remove from this computer"
                  className="mr-1 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => void handleRemove(account)}
                  disabled={Boolean(busyAccountId) || transitioning}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
            {transitioning && !busyAccountId ? (
              <p role="status" className="text-sm text-cream-muted">
                Updating session…
              </p>
            ) : null}
            {error ? <AuthMessage tone="error" message={error} /> : null}
            <Button
              variant="outline"
              className="mt-1 h-11 justify-start px-3 text-cream-muted"
              disabled={Boolean(busyAccountId) || transitioning}
              onClick={() => {
                setError("");
                setEmail("");
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
        reauthenticateEmail
          ? "Sign in again"
          : addingAccount && user
            ? "Add another account"
            : "Welcome back"
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
        <SignInForm
          email={email}
          onEmailChange={setEmail}
          error={error}
          onErrorChange={setError}
          onSuccess={finishSignIn}
        />
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
