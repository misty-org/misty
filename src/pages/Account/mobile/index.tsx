import {
  BadgeCheck,
  Bell,
  Bug,
  ChevronRight,
  CircleHelp,
  Lock,
  LogIn,
  LogOut,
  Mail,
  MonitorSmartphone,
  Settings,
  Shield,
  Trash2,
  User,
  UserCircle,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  accountFetchMe,
  accountLogout,
  accountRegister,
  accountSignIn,
  type AccountMeResponse,
} from "../shared/api";
import { useSetupStore } from "../../../stores/useSetupStore";
import type { CurrentLicense, CurrentUser } from "../../../models/setup";
import { useAppStore } from "../../../stores/useAppStore";
import { mobileErrorClass, mobilePageClass, mobileSuccessClass } from "../../../shell/mobileStyles";
import {
  clearClientDebugEvents,
  clientDebugPanelEnabled,
  readClientDebugEvents,
  type ClientDebugEvent,
} from "../../../shared/debug/clientDebug";

type AccountMode = "overview" | "signin" | "register";

const mobileAccountPrimaryActionClass = "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[var(--misty-radius-sm)] border border-[var(--misty-primary)] bg-[var(--misty-primary)] px-3 text-sm font-bold text-[var(--misty-primary-contrast)] transition-colors hover:bg-[var(--misty-primary-hover)] disabled:opacity-55";
const mobileAccountSecondaryActionClass = "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[var(--misty-radius-sm)] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm font-bold text-[var(--misty-text)] transition-colors hover:bg-[var(--misty-surface-hover)] disabled:opacity-55";

export function MobileAccountPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    busy,
    status,
    systemError,
    loadSystem,
    saveAuthenticatedUser,
    signOut,
  } = useSetupStore(useShallow((state) => ({
    busy: state.busy,
    status: state.status,
    systemError: state.systemError,
    loadSystem: state.loadSystem,
    saveAuthenticatedUser: state.saveAuthenticatedUser,
    signOut: state.signOut,
  })));
  const [mode, setMode] = useState<AccountMode>(() => modeFromPath(location.pathname));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(modeFromPath(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    void loadSystem();
  }, [loadSystem]);

  const user = status?.current_user ?? null;
  const license = status?.current_license ?? null;
  const disabled = busy || working;
  const title = useMemo(() => {
    if (mode === "register") return "Create account";
    if (mode === "signin") return "Sign in";
    return user?.name || user?.email || "Account";
  }, [mode, user?.email, user?.name]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setWorking(true);
    try {
      const authUser = await accountSignIn(email, password);
      const license = await fetchLicenseAfterAuth();
      await saveAuthenticatedUser(authUser, license);
      setMessage(license ? "Signed in to Misty." : "Signed in to Misty. License status will refresh later.");
      navigate("/account", { replace: true });
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in.");
    } finally {
      setWorking(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setWorking(true);
    try {
      await accountRegister(name, email, password);
      const authUser = await accountSignIn(email, password);
      const license = await fetchLicenseAfterAuth();
      await saveAuthenticatedUser(authUser, license);
      setMessage(license ? "Your Misty account is ready." : "Your Misty account is ready. License status will refresh later.");
      navigate("/account", { replace: true });
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Could not create account.");
    } finally {
      setWorking(false);
    }
  }

  async function handleSignOut() {
    setError("");
    setMessage("");
    setWorking(true);
    try {
      await accountLogout();
    } catch {
      // Native sign-out should still clear Misty's local account state.
    }
    try {
      await signOut();
      setMessage("Signed out of Misty.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className={mobilePageClass}>
      {mode !== "overview" || !user ? (
        <section className="mb-3.5 grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
          <div className="grid h-[52px] w-[52px] place-items-center rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-primary)]">
            <UserCircle size={36} strokeWidth={1.65} />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-[760] uppercase tracking-normal text-[var(--misty-text-subtle)]">Misty account</span>
            <h2 className="m-0 mb-1 overflow-hidden text-2xl font-black leading-[1.1] text-[var(--misty-text)] text-ellipsis whitespace-nowrap">
              {title}
            </h2>
            <p className="m-0 text-[13px] leading-[1.35] text-[#a3adba]">{accountSubtitle(mode, user?.email)}</p>
          </div>
        </section>
      ) : null}

      {systemError ? <div className={mobileErrorClass}>{systemError}</div> : null}
      {error ? <div className={mobileErrorClass}>{error}</div> : null}
      {message ? <div className={mobileSuccessClass}>{message}</div> : null}

      {mode === "signin" ? (
        <form className="grid gap-3" onSubmit={handleSignIn}>
          <MobileInput
            label="Email"
            type="email"
            value={email}
            autoComplete="email"
            disabled={disabled}
            onChange={setEmail}
          />
          <MobileInput
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={disabled}
            onChange={setPassword}
          />
          <button type="submit" className={mobileAccountPrimaryActionClass} disabled={disabled}>
            <LogIn size={17} /> {working ? "Signing in..." : "Sign in"}
          </button>
          <button type="button" className="min-h-[42px] border-0 bg-transparent font-bold text-[var(--misty-text)]" onClick={() => navigate("/account/register")}>
            Create a Misty account
          </button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form className="grid gap-3" onSubmit={handleRegister}>
          <MobileInput
            label="Name"
            value={name}
            autoComplete="name"
            disabled={disabled}
            onChange={setName}
          />
          <MobileInput
            label="Email"
            type="email"
            value={email}
            autoComplete="email"
            disabled={disabled}
            onChange={setEmail}
          />
          <MobileInput
            label="Password"
            type="password"
            value={password}
            autoComplete="new-password"
            disabled={disabled}
            onChange={setPassword}
          />
          <button type="submit" className={mobileAccountPrimaryActionClass} disabled={disabled}>
            <UserPlus size={17} /> {working ? "Creating..." : "Create account"}
          </button>
          <button type="button" className="min-h-[42px] border-0 bg-transparent font-bold text-[var(--misty-text)]" onClick={() => navigate("/account/signin")}>
            Already have an account
          </button>
        </form>
      ) : null}

      {mode === "overview" ? (
        <>
          {user ? (
            <MobileAccountOverview
              user={user}
              license={license}
              disabled={disabled}
              onSettings={() => navigate("/account/settings")}
              onSignOut={() => void handleSignOut()}
            />
          ) : (
            <>
              <section className="mb-[18px] min-w-0">
                <header className="mb-2.5 flex items-center justify-start gap-3">
                  <LogIn size={20} strokeWidth={1.8} />
                  <h3 className="m-0 text-[22px] font-black leading-tight text-[var(--misty-text)]">Sign in to Misty</h3>
                </header>
                <p className="m-0 text-sm leading-relaxed text-[var(--misty-text-muted)]">
                  Use your Misty account to unlock license status and account-backed features on this device.
                </p>
                <div className="mt-2.5 grid gap-2">
                  <button type="button" className={mobileAccountPrimaryActionClass} onClick={() => navigate("/account/signin")}>
                    <LogIn size={17} /> Sign in
                  </button>
                  <button type="button" className={mobileAccountSecondaryActionClass} onClick={() => navigate("/account/register")}>
                    <UserPlus size={17} /> Create account
                  </button>
                </div>
              </section>
              <AccountSection title="Preferences">
                <AccountRow icon={Settings} label="Settings" onClick={() => navigate("/account/settings")} />
              </AccountSection>
            </>
          )}
        </>
      ) : null}

      {clientDebugPanelEnabled() ? <MobileClientDebugPanel /> : null}
    </section>
  );
}

function MobileAccountOverview(props: {
  user: CurrentUser;
  license: CurrentLicense | null;
  disabled: boolean;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const displayName = props.user.name || "Misty user";
  return (
    <div className="grid min-w-0 gap-5 pb-[18px]">
      <section className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-3.5 p-0">
        <div className="grid h-[72px] w-[72px] place-items-center rounded-full border border-white/20 bg-[#0b0d0f] text-white/80">
          <UserCircle size={72} strokeWidth={1.25} />
        </div>
        <div className="min-w-0">
          <h3 className="m-0 overflow-hidden text-2xl font-[760] leading-[1.08] text-white text-ellipsis whitespace-nowrap">{displayName}</h3>
          <p className="m-0 mt-1 overflow-hidden text-[15px] leading-tight text-[#8f8f95] text-ellipsis whitespace-nowrap">{props.user.email}</p>
        </div>
      </section>

      <AccountSection title="Personal">
        <AccountRow icon={User} label="Profile" />
        <AccountRow icon={Mail} label="Email" />
        <AccountRow icon={Shield} label="Security" />
      </AccountSection>

      <AccountSection title="Membership">
        <AccountRow icon={BadgeCheck} label="License" detail={licenseRowDetail(props.license)} />
        <AccountRow icon={MonitorSmartphone} label="Devices" />
      </AccountSection>

      <AccountSection title="Preferences">
        <AccountRow icon={Settings} label="Settings" onClick={props.onSettings} />
        <AccountRow icon={Bell} label="Notifications" />
        <AccountRow icon={Lock} label="Privacy" />
      </AccountSection>

      <AccountSection title="Support">
        <AccountRow icon={CircleHelp} label="Help" />
      </AccountSection>

      <button
        type="button"
        className="inline-flex min-h-[52px] w-full items-center justify-center gap-[13px] rounded-[10px] border border-white/10 bg-transparent text-lg font-[760] text-[#ff8b91] disabled:opacity-55"
        disabled={props.disabled}
        onClick={props.onSignOut}
      >
        <LogOut size={20} />
        Sign out
      </button>
    </div>
  );
}

function AccountSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="m-0 text-[13px] font-[760] uppercase tracking-normal text-[#8f8f95]">{props.title}</h3>
      <div className="min-w-0 overflow-hidden">{props.children}</div>
    </section>
  );
}

function AccountRow(props: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  onClick?: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className="grid min-h-[58px] w-full min-w-0 grid-cols-[38px_minmax(0,1fr)_18px] items-center gap-2.5 border-0 border-b border-[var(--misty-border-soft)] bg-transparent px-0 py-2 text-left text-white last:border-b-0"
      onClick={props.onClick}
    >
      <span className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-transparent text-white/90">
        <Icon size={22} strokeWidth={1.85} />
      </span>
      <span className="grid min-w-0 gap-[3px]">
        <strong className="overflow-hidden text-[17px] font-medium leading-[1.15] text-white text-ellipsis whitespace-nowrap">{props.label}</strong>
        {props.detail ? <small className="overflow-hidden text-[13px] leading-tight text-[#8f8f95] text-ellipsis whitespace-nowrap">{props.detail}</small> : null}
      </span>
      <ChevronRight className="text-white/40" size={22} strokeWidth={1.8} />
    </button>
  );
}

function MobileClientDebugPanel() {
  const app = useAppStore((state) => state.app);
  const [events, setEvents] = useState<ClientDebugEvent[]>(() => readClientDebugEvents());
  const serverAccountBase = accountDebugBase(
    import.meta.env.VITE_MISTY_SERVER_URL
      || import.meta.env.VITE_API_BASE
      || app?.environment.serverUrl
      || null,
  );
  useEffect(() => {
    function refresh() {
      setEvents(readClientDebugEvents());
    }
    window.addEventListener("misty-client-debug", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("misty-client-debug", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <section className="mb-[18px] grid min-w-0 gap-2">
      <header className="mb-2.5 flex items-center justify-start gap-3">
        <Bug size={20} strokeWidth={1.8} />
        <h3 className="m-0 text-[22px] font-black leading-tight text-[var(--misty-text)]">Debug</h3>
      </header>
      <dl className="m-0 mb-4 grid gap-1">
        <MobileDebugDetail label="Misty server API" value={serverAccountBase || "Not set"} />
        <MobileDebugDetail label="Server env" value={import.meta.env.VITE_MISTY_SERVER_URL || import.meta.env.VITE_API_BASE || "Not set"} />
        <MobileDebugDetail label="Build target" value={import.meta.env.VITE_MISTY_TARGET || "unknown"} />
        <MobileDebugDetail label="Remote runtime" value={app?.proxyRuntime.mode ?? "unknown"} />
        <MobileDebugDetail label="Remote transport" value="Embedded invoke" />
        {app?.proxyRuntime.error ? (
          <MobileDebugDetail label="Runtime error" value={app.proxyRuntime.error} danger />
        ) : null}
      </dl>
      {events.length > 0 ? (
        <div className="grid gap-2">
          {events.slice(0, 6).map((event) => (
            <article
              key={event.id}
              className={`grid gap-1 border-0 bg-transparent py-2 ${event.level === "error" ? "text-[#fca5a5]" : event.level === "warn" ? "text-[#fde68a]" : "text-[var(--misty-text)]"}`}
            >
              <strong className="text-sm font-black text-inherit">{event.scope}</strong>
              <p className="m-0 text-xs leading-relaxed text-[var(--misty-text-muted)]">{event.message}</p>
              {event.detail ? (
                <code className="block whitespace-pre-wrap rounded-lg bg-white/[0.04] p-2 text-[10px] leading-[1.4] text-[#d7e1ec] [overflow-wrap:anywhere]">
                  {event.detail}
                </code>
              ) : null}
              <time className="text-xs text-[var(--misty-text-muted)]">{new Date(event.createdAt).toLocaleTimeString()}</time>
            </article>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm leading-relaxed text-[var(--misty-text-muted)]">No client errors recorded yet.</p>
      )}
      <button
        type="button"
        className={mobileAccountSecondaryActionClass}
        onClick={() => {
          clearClientDebugEvents();
          setEvents([]);
        }}
      >
        <Trash2 size={17} /> Clear debug events
      </button>
    </section>
  );
}

function MobileDebugDetail(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] gap-2 border-b border-[var(--misty-border-soft)] py-2">
      <dt className="text-[11px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]">{props.label}</dt>
      <dd className={`m-0 min-w-0 text-right text-xs font-bold [overflow-wrap:anywhere] ${props.danger ? "text-[#ffb8bf]" : "text-[var(--misty-text)]"}`}>
        {props.value}
      </dd>
    </div>
  );
}

function accountDebugBase(base: string | null | undefined) {
  const normalized = base?.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
}

function MobileInput(props: {
  label: string;
  value: string;
  type?: "email" | "password" | "text";
  autoComplete?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `mobile-account-${props.label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label className="grid min-w-0 gap-1.5" htmlFor={id}>
      <span className="text-xs font-bold text-[var(--misty-text-muted)]">{props.label}</span>
      <input
        className="h-[46px] w-full min-w-0 rounded-[14px] border border-white/10 bg-[#0b1118] px-[13px] text-base text-[#f4f0e8] outline-none focus:border-[var(--misty-border-strong)] focus:shadow-[0_0_0_3px_var(--misty-focus-ring)] disabled:opacity-55"
        id={id}
        type={props.type ?? "text"}
        value={props.value}
        autoComplete={props.autoComplete}
        required
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function modeFromPath(pathname: string): AccountMode {
  if (pathname.endsWith("/register")) return "register";
  if (pathname.endsWith("/signin")) return "signin";
  return "overview";
}

function accountSubtitle(mode: AccountMode, email?: string): string {
  if (mode === "register") return "Create your Misty login on this device.";
  if (mode === "signin") return "Connect this device to your Misty account.";
  return email || "Manage sign in, license, and local account state.";
}

function licenseSummary(license: CurrentLicense | null): string {
  if (!license) return "No license is saved on this device yet.";
  if (license.allows_use) return `${license.tier} plan is ${license.status}.`;
  return `Your ${license.tier} plan needs attention.`;
}

function licenseRowDetail(license: CurrentLicense | null): string {
  if (!license) return "No plan active";
  const plan = `${license.tier.charAt(0).toUpperCase()}${license.tier.slice(1)} plan`;
  return license.allows_use ? `${plan} active` : `${plan} ${license.status}`;
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

export default MobileAccountPage;
