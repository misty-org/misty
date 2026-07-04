import { FormEvent, useState } from "react";
import {
  accountFetchMe,
  accountRegister,
  accountSignIn,
  type AccountMeResponse,
} from "../pages/Account/shared/api";
import AuthCard from "../pages/Website/pages/Auth/AuthCard";
import AuthField from "../pages/Website/pages/Auth/AuthField";
import AuthMessage from "../pages/Website/pages/Auth/AuthMessage";
import AuthSubmitButton from "../pages/Website/pages/Auth/AuthSubmitButton";
import type { CurrentLicense } from "../models/setup";
import { hasTauriInternals } from "../shared/tauri";
import "../App.css";

type WelcomeMode = "welcome" | "signin" | "register";

interface WelcomeOnboardingProps {
  formFactor: "desktop" | "mobile";
  checkingAccount: boolean;
  onSignedIn: (
    user: { id: string; name: string; email: string },
    license: CurrentLicense | null,
  ) => Promise<void>;
}

const welcomeShellClass =
  "app-pages-root relative min-h-dvh overflow-hidden bg-[#07090b] px-4 py-10 text-white sm:px-5 sm:py-14";

const welcomePrimaryClass =
  "w-full rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50";

const welcomeSecondaryClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/16 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50";

const welcomeTextButtonClass =
  "border-0 bg-transparent p-0 text-sm text-[#d4d4d8] transition hover:text-white";

export function WelcomeOnboarding(props: WelcomeOnboardingProps) {
  const [mode, setMode] = useState<WelcomeMode>("welcome");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      if (!hasTauriInternals()) {
        await props.onSignedIn(browserPreviewUser(email), null);
        return;
      }
      const user = await accountSignIn(email, password);
      const license = await fetchLicenseAfterAuth();
      await props.onSignedIn(user, license);
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not sign in.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      if (!hasTauriInternals()) {
        await props.onSignedIn(browserPreviewUser(email, name), null);
        return;
      }
      await accountRegister(name, email, password);
      const user = await accountSignIn(email, password);
      const license = await fetchLicenseAfterAuth();
      await props.onSignedIn(user, license);
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : "Could not create account.",
      );
    } finally {
      setWorking(false);
    }
  }

  const title = mode === "register" ? "Create an account" : "Welcome back";
  const description =
    mode === "register"
      ? "Sign up to get started."
      : mode === "signin"
        ? "Sign in to your Misty account."
        : "Sign in or create an account to continue into Misty.";

  return (
    <main
      className={welcomeShellClass}
      data-form-factor={props.formFactor}
      data-mode={mode}
    >
      <div className="relative mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md flex-col items-center justify-center py-6 sm:min-h-[calc(100dvh-7rem)] sm:py-10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {mode === "welcome" ? "Misty" : title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#d4d4d8] sm:text-base">
            {description}
          </p>
        </div>

        <div className="w-full">
          {mode === "welcome" ? (
            <AuthCard>
              <div className="flex flex-col gap-3">
                {props.checkingAccount ? (
                  <AuthMessage tone="muted" message="Checking saved account..." />
                ) : null}
                <button
                  type="button"
                  className={welcomePrimaryClass}
                  onClick={() => setMode("signin")}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={welcomeSecondaryClass}
                  onClick={() => setMode("register")}
                >
                  Create account
                </button>
              </div>
            </AuthCard>
          ) : null}

          {mode === "signin" ? (
            <AuthCard>
              <form className="flex flex-col gap-5" onSubmit={handleSignIn}>
                <AuthField
                  id="welcome-signin-email"
                  label="Email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  disabled={working}
                  onChange={setEmail}
                />
                <AuthField
                  id="welcome-signin-password"
                  label="Password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  disabled={working}
                  onChange={setPassword}
                />
                {error ? <AuthMessage tone="error" message={error} /> : null}
                <AuthSubmitButton
                  idleLabel="Sign In"
                  loadingLabel="Signing in..."
                  loading={working}
                />
              </form>
              <div className="mt-5 flex flex-col items-center gap-3 text-center">
                <button
                  type="button"
                  className={welcomeTextButtonClass}
                  onClick={() => setMode("register")}
                >
                  Don&apos;t have an account? Sign up
                </button>
                <button
                  type="button"
                  className={welcomeTextButtonClass}
                  onClick={() => {
                    setError("");
                    setMode("welcome");
                  }}
                >
                  Back
                </button>
              </div>
            </AuthCard>
          ) : null}

          {mode === "register" ? (
            <AuthCard>
              <form className="flex flex-col gap-5" onSubmit={handleRegister}>
                <AuthField
                  id="welcome-register-name"
                  label="Name"
                  value={name}
                  autoComplete="name"
                  placeholder="Your name"
                  required
                  disabled={working}
                  onChange={setName}
                />
                <AuthField
                  id="welcome-register-email"
                  label="Email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  disabled={working}
                  onChange={setEmail}
                />
                <AuthField
                  id="welcome-register-password"
                  label="Password"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  required
                  disabled={working}
                  onChange={setPassword}
                />
                {error ? <AuthMessage tone="error" message={error} /> : null}
                <AuthSubmitButton
                  idleLabel="Create account"
                  loadingLabel="Creating account..."
                  loading={working}
                />
              </form>
              <div className="mt-5 flex flex-col items-center gap-3 text-center">
                <button
                  type="button"
                  className={welcomeTextButtonClass}
                  onClick={() => setMode("signin")}
                >
                  Already have an account? Sign in
                </button>
                <button
                  type="button"
                  className={welcomeTextButtonClass}
                  onClick={() => {
                    setError("");
                    setMode("welcome");
                  }}
                >
                  Back
                </button>
              </div>
            </AuthCard>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function browserPreviewUser(email: string, name = "") {
  const normalizedEmail = email.trim() || "preview@misty.local";
  const displayName = name.trim()
    || normalizedEmail.split("@")[0]?.replace(/[._-]+/g, " ")
    || "Browser Preview";
  return {
    id: "browser-preview",
    name: displayName,
    email: normalizedEmail,
  };
}

function licenseFromMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

async function fetchLicenseAfterAuth(): Promise<CurrentLicense | null> {
  try {
    const me = await accountFetchMe();
    return licenseFromMe(me);
  } catch {
    return null;
  }
}
