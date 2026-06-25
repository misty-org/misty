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
import { useSetupStore } from "../../hub/store/useSetupStore";
import type { CurrentLicense, CurrentUser } from "../../hub/types/setup";
import { useAppStore } from "../../../app/useAppStore";
import {
  clearClientDebugEvents,
  clientDebugPanelEnabled,
  readClientDebugEvents,
  type ClientDebugEvent,
} from "../../../shared/debug/clientDebug";

type AccountMode = "overview" | "signin" | "register";

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
    <section className="mobile-page mobile-account-page">
      {mode !== "overview" || !user ? (
        <section className="mobile-account-hero">
          <div className="mobile-hub-avatar">
            <UserCircle size={36} strokeWidth={1.65} />
          </div>
          <div>
            <span>Misty account</span>
            <h2>{title}</h2>
            <p>{accountSubtitle(mode, user?.email)}</p>
          </div>
        </section>
      ) : null}

      {systemError ? <div className="mobile-error">{systemError}</div> : null}
      {error ? <div className="mobile-error">{error}</div> : null}
      {message ? <div className="mobile-success">{message}</div> : null}

      {mode === "signin" ? (
        <form className="mobile-auth-form" onSubmit={handleSignIn}>
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
          <button type="submit" className="mobile-primary-action" disabled={disabled}>
            <LogIn size={17} /> {working ? "Signing in..." : "Sign in"}
          </button>
          <button type="button" className="mobile-text-action" onClick={() => navigate("/account/register")}>
            Create a Misty account
          </button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form className="mobile-auth-form" onSubmit={handleRegister}>
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
          <button type="submit" className="mobile-primary-action" disabled={disabled}>
            <UserPlus size={17} /> {working ? "Creating..." : "Create account"}
          </button>
          <button type="button" className="mobile-text-action" onClick={() => navigate("/account/signin")}>
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
              <section className="mobile-panel">
                <header>
                  <LogIn size={20} strokeWidth={1.8} />
                  <h3>Sign in to Misty</h3>
                </header>
                <p>Use your Misty account to unlock license status and account-backed features on this device.</p>
                <div className="mobile-action-stack">
                  <button type="button" className="mobile-primary-action" onClick={() => navigate("/account/signin")}>
                    <LogIn size={17} /> Sign in
                  </button>
                  <button type="button" className="mobile-secondary-action" onClick={() => navigate("/account/register")}>
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
    <div className="mobile-account-settings">
      <section className="mobile-account-identity">
        <div className="mobile-account-avatar">
          <UserCircle size={72} strokeWidth={1.25} />
        </div>
        <div>
          <h3>{displayName}</h3>
          <p>{props.user.email}</p>
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

      <button type="button" className="mobile-account-signout" disabled={props.disabled} onClick={props.onSignOut}>
        <LogOut size={20} />
        Sign out
      </button>
    </div>
  );
}

function AccountSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="mobile-account-section">
      <h3>{props.title}</h3>
      <div className="mobile-account-group">{props.children}</div>
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
    <button type="button" className="mobile-account-row" onClick={props.onClick}>
      <span className="mobile-account-row-icon">
        <Icon size={22} strokeWidth={1.85} />
      </span>
      <span className="mobile-account-row-copy">
        <strong>{props.label}</strong>
        {props.detail ? <small>{props.detail}</small> : null}
      </span>
      <ChevronRight size={22} strokeWidth={1.8} />
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
    <section className="mobile-panel mobile-debug-panel">
      <header>
        <Bug size={20} strokeWidth={1.8} />
        <h3>Debug</h3>
      </header>
      <dl className="mobile-detail-list compact">
        <div>
          <dt>Misty server API</dt>
          <dd>{serverAccountBase || "Not set"}</dd>
        </div>
        <div>
          <dt>Server env</dt>
          <dd>{import.meta.env.VITE_MISTY_SERVER_URL || import.meta.env.VITE_API_BASE || "Not set"}</dd>
        </div>
        <div>
          <dt>Build target</dt>
          <dd>{import.meta.env.VITE_MISTY_TARGET || "unknown"}</dd>
        </div>
        <div>
          <dt>Proxy runtime</dt>
          <dd>{app?.proxyRuntime.mode ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Proxy URL</dt>
          <dd>{app?.proxyRuntime.proxyUrl || "Not ready"}</dd>
        </div>
        {app?.proxyRuntime.error ? (
          <div>
            <dt>Proxy error</dt>
            <dd>{app.proxyRuntime.error}</dd>
          </div>
        ) : null}
      </dl>
      {events.length > 0 ? (
        <div className="mobile-debug-event-list">
          {events.slice(0, 6).map((event) => (
            <article key={event.id} className={`mobile-debug-event ${event.level}`}>
              <strong>{event.scope}</strong>
              <p>{event.message}</p>
              {event.detail ? <code>{event.detail}</code> : null}
              <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
            </article>
          ))}
        </div>
      ) : (
        <p>No client errors recorded yet.</p>
      )}
      <button
        type="button"
        className="mobile-secondary-action"
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
    <label className="mobile-input-group" htmlFor={id}>
      <span>{props.label}</span>
      <input
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
