import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../auth/AuthContext";
import { createCheckout, createCreditCheckout, createPortalSession, fetchBillingUsage, fetchMe, updateDevice, updateProfile, type BillingUsageResponse, type MeResponse } from "./api";
import { useUserStore } from "../../../stores/useUserStore";
import { useSetupStore } from "../../../stores/useSetupStore";
import type { CurrentLicense } from "../../../models/setup";
import { useAppStore } from "../../../stores/useAppStore";
import {
  clearClientDebugEvents,
  clientDebugPanelEnabled,
  readClientDebugEvents,
  type ClientDebugEvent,
} from "../../../shared/debug/clientDebug";
import { openExternalLink } from "../../../shared/openExternalLink";
import {
  Bug,
  Lock,
  Rows3,
  UserCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DesktopSettingsRow,
  DesktopSettingsSection,
  desktopSettingsContentClass,
  desktopSettingsGridClass,
  desktopSettingsNavItemClass,
  desktopSettingsNavItemSelectedClass,
  desktopSettingsOverlayCloseClass,
  desktopSettingsOverlayContentClass,
  desktopSettingsOverlayContentShellClass,
  desktopSettingsOverlayGridClass,
  desktopSettingsOverlayHeaderClass,
  desktopSettingsOverlayScrollSurfaceClass,
  desktopSettingsScrollSurfaceClass,
  desktopSettingsSidebarClass,
} from "../../../components/settings/DesktopSettingsUI";
// ─── display helpers ─────────────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  max: "Max",
};
const TIER_COLOR: Record<string, string> = {
  basic: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  pro: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  max: "text-violet-400 bg-violet-400/10 border-violet-400/20",
};
const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  trialing: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  cancelled: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  expired: "text-red-400 bg-red-400/10 border-red-400/20",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

// ─── layout primitives ───────────────────────────────────────────────────────

const accountSettingsCustomRowClass =
  "border-b border-white/[0.08] bg-[var(--misty-app-surface-bg,#090b0d)] px-7 py-4 last:border-b-0";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <DesktopSettingsSection title={title}>{children}</DesktopSettingsSection>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DesktopSettingsRow label={label}>
      <span className="text-right text-[15px] text-[#f4f4f5]">{children}</span>
    </DesktopSettingsRow>
  );
}

function GhostRow({ label, value }: { label: string; value: string }) {
  return (
    <DesktopSettingsRow label={label} muted>
      <span className="italic text-[#a1a1aa]">{value}</span>
    </DesktopSettingsRow>
  );
}

// ─── save helper ─────────────────────────────────────────────────────────────

function useSave(fn: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    setOk(false);
    try {
      await fn();
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, ok, save };
}

function SaveFeedback({ ok, error }: { ok: boolean; error: string }) {
  if (ok) return <p className="text-xs text-emerald-400 mt-2">Saved.</p>;
  if (error) return <p className="text-xs text-red-400 mt-2">{error}</p>;
  return null;
}

// ─── tabs ────────────────────────────────────────────────────────────────────

type Tab = "general" | "account" | "privacy" | "diagnostics";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Rows3 },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "diagnostics", label: "Diagnostics", icon: Bug },
];

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralPanel() {
  return (
    <div>
      <Section title="Appearance">
        <Row label="Theme">System</Row>
        <Row label="Language">English</Row>
        <GhostRow label="Density" value="Coming soon" />
      </Section>

      <Section title="App">
        <Row label="Version">
          <span className="font-mono text-xs text-text-muted">v0.1.0-beta</span>
        </Row>
        <Row label="Release channel">Stable</Row>
        <GhostRow label="Check for updates" value="Coming soon" />
        <GhostRow label="Auto-update" value="Coming soon" />
      </Section>

      <Section title="Notifications">
        <GhostRow label="Product updates" value="Coming soon" />
        <GhostRow label="Release notes emails" value="Coming soon" />
        <Row label="Security emails">Always on</Row>
      </Section>
    </div>
  );
}

// ─── Account ─────────────────────────────────────────────────────────────────

function AccountPanel({
  me,
  onUpdated,
  onLogout,
}: {
  me: MeResponse;
  onUpdated: (name: string) => void;
  onLogout: () => void;
}) {
  const patchMe = useUserStore((state) => state.patchMe);
  const [name, setName] = useState(me.name);
  const [device, setDevice] = useState(me.license_device);
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(null);
  const [billingWorking, setBillingWorking] = useState(false);
  const [billingError, setBillingError] = useState("");
  const {
    saving: savingProfile,
    error: profileError,
    ok: profileOk,
    save: saveProfile,
  } = useSave(async () => {
    await updateProfile(name);
    onUpdated(name);
  });

  useEffect(() => {
    void fetchBillingUsage().then(setBillingUsage).catch(() => setBillingUsage(null));
  }, [me.tier]);

  async function openBillingAction(action: () => Promise<{ url: string }>) {
    setBillingWorking(true);
    setBillingError("");
    try {
      const { url } = await action();
      await openExternalLink(url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not start billing.");
    } finally {
      setBillingWorking(false);
    }
  }
  const {
    saving: savingDevice,
    error: deviceError,
    ok: deviceOk,
    save: saveDevice,
  } = useSave(async () => {
    await updateDevice(device);
    patchMe({ license_device: device });
  });

  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const initialsSource = name.trim() || me.name || me.email;
  const initials = initialsSource
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const creditUsedPercent = billingUsage && billingUsage.monthly_allowance > 0
    ? Math.round((1 - billingUsage.monthly_remaining / billingUsage.monthly_allowance) * 100)
    : 0;
  const creditWarning = creditUsedPercent >= 100
    ? "Managed AI is paused until you add credits or the allowance resets."
    : creditUsedPercent >= 90
      ? "You have used at least 90% of this month’s credits."
      : creditUsedPercent >= 75
        ? "You have used at least 75% of this month’s credits."
        : "";

  return (
    <div>
      <Section title="License">
        <Row label="Plan">
          <Badge label={TIER_LABEL[me.tier] ?? me.tier} cls={TIER_COLOR[me.tier] ?? TIER_COLOR.basic} />
        </Row>
        <Row label="Status">
          <Badge
            label={me.status.charAt(0).toUpperCase() + me.status.slice(1)}
            cls={STATUS_COLOR[me.status] ?? STATUS_COLOR.active}
          />
        </Row>
        <Row label="Type">
          {me.billing?.kind === "lifetime"
            ? "Lifetime"
            : me.billing?.kind === "subscription"
              ? `${me.billing.interval === "year" ? "Annual" : "Monthly"} subscription`
              : me.status === "trialing" ? "Pro trial" : "Free account"}
        </Row>
        {me.expires_at ? (
          <Row label="Expires">
            {new Date(me.expires_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Row>
        ) : me.billing?.kind === "lifetime" ? (
          <Row label="Expires">Never</Row>
        ) : null}
        {me.billing?.current_period_end ? (
          <Row label={me.billing.cancel_at_period_end ? "Access until" : "Renews"}>
            {new Date(me.billing.current_period_end).toLocaleDateString()}
          </Row>
        ) : null}
      </Section>

      <Section title="Devices">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6`}>
          <div className="space-y-1">
            <p className="text-sm text-text">Licensed device</p>
            <p className="text-xs text-text-muted">
              Change the machine name registered to your license.
            </p>
          </div>
          <div className="w-full md:max-w-sm">
            <div className="flex gap-2">
              <input
                type="text"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                placeholder="e.g. MacBook Pro"
                className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
              />
              <button
                onClick={saveDevice}
                disabled={savingDevice}
                className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-bg text-sm font-medium rounded-lg transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                {savingDevice ? "Saving…" : "Save"}
              </button>
            </div>
            <SaveFeedback ok={deviceOk} error={deviceError} />
          </div>
        </div>

        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}>
          <div>
            <p className="text-sm font-medium text-text">{me.license_device || "Primary device"}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {TIER_LABEL[me.tier] ?? me.tier} · Activated
            </p>
          </div>
          <Badge label="Active" cls={STATUS_COLOR.active} />
        </div>

        {me.tier === "max" && (
          <div className={accountSettingsCustomRowClass}>
            <p className="text-xs text-text-muted">
              Additional seats appear here as you activate new devices.
            </p>
          </div>
        )}

        {me.tier === "basic" && (
          <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}>
            <p className="text-xs text-text-muted">
              Pro $9.99/month · Max $14.99/month
            </p>
            <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCheckout("pro", "month"))} className="shrink-0 text-xs text-text hover:text-white underline underline-offset-2 transition-colors disabled:opacity-50">
              Upgrade to Pro
            </button>
          </div>
        )}
      </Section>

      <Section title="Misty Credits">
        {billingUsage ? (
          <>
            <Row label="Available">{billingUsage.available_credits.toLocaleString()} credits</Row>
            <Row label="Monthly allowance">{billingUsage.monthly_remaining.toLocaleString()} of {billingUsage.monthly_allowance.toLocaleString()} remaining</Row>
            <Row label="Purchased">{billingUsage.purchased_remaining.toLocaleString()} credits</Row>
            <Row label="Resets">{new Date(billingUsage.next_reset_at).toLocaleDateString()}</Row>
            <div className={accountSettingsCustomRowClass}>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated"><div className="h-full bg-blue-400" style={{ width: `${Math.min(100, creditUsedPercent)}%` }} /></div>
              {creditWarning ? <p className="mt-2 text-xs text-amber-400">{creditWarning}</p> : null}
            </div>
            <div className={`${accountSettingsCustomRowClass} flex flex-wrap gap-2`}>
              <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCreditCheckout("credits_1500"))} className="rounded-lg border border-border px-3 py-2 text-xs text-text disabled:opacity-50">1,500,000 credits · $4.99</button>
              <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCreditCheckout("credits_3500"))} className="rounded-lg border border-border px-3 py-2 text-xs text-text disabled:opacity-50">3,500,000 credits · $9.99</button>
            </div>
          </>
        ) : <GhostRow label="Usage" value="Loading credit balance" />}
      </Section>

      <Section title="Billing">
        {me.billing?.kind === "subscription" ? (
          <>
            <Row label="Plan">{TIER_LABEL[me.tier]} · {me.billing.interval === "year" ? "yearly" : "monthly"}</Row>
            <div className={accountSettingsCustomRowClass}>
              <button disabled={billingWorking || !me.billing.customer_portal_available} onClick={() => void openBillingAction(createPortalSession)} className="text-sm text-text-muted hover:text-text disabled:opacity-40">Manage billing →</button>
            </div>
          </>
        ) : (
          <div className={`${accountSettingsCustomRowClass} grid gap-3`}>
            <p className="m-0 text-sm text-text-muted">Pro includes 2,000 monthly credits. Max includes 6,000.</p>
            <div className="flex flex-wrap gap-2">
              <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCheckout("pro", "month"))} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-bg disabled:opacity-50">Pro · $9.99/mo</button>
              <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCheckout("max", "month"))} className="rounded-lg border border-border px-3 py-2 text-xs text-text disabled:opacity-50">Max · $14.99/mo</button>
              <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCheckout("pro", "year"))} className="rounded-lg border border-border px-3 py-2 text-xs text-text disabled:opacity-50">Pro · $99/yr</button>
              <button disabled={billingWorking} onClick={() => void openBillingAction(() => createCheckout("max", "year"))} className="rounded-lg border border-border px-3 py-2 text-xs text-text disabled:opacity-50">Max · $149/yr</button>
            </div>
          </div>
        )}
        {billingError ? <p className={`${accountSettingsCustomRowClass} text-xs text-red-400`}>{billingError}</p> : null}
      </Section>

      <Section title="Info">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-4 py-5`}>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full border border-border bg-elevated flex items-center justify-center text-lg font-bold text-text shrink-0 select-none">
              {initials}
            </div>
            <div>
              <p className="text-sm font-medium text-text">{me.name}</p>
              <p className="text-xs text-text-muted mt-0.5">{me.email}</p>
              <p className="text-xs text-text-muted/50 mt-1">Photo upload — coming soon</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Display name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveProfile}
                disabled={savingProfile || name.trim() === "" || name === me.name}
                className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-bg text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {savingProfile ? "Saving…" : "Save changes"}
              </button>
              <SaveFeedback ok={profileOk} error={profileError} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Email</label>
            <input
              type="email"
              value={me.email}
              disabled
              className="w-full bg-surface/50 border border-border rounded-lg px-3 py-2 text-sm text-text-muted cursor-not-allowed"
            />
            <p className="text-xs text-text-muted/60 mt-1">Email cannot be changed.</p>
          </div>
        </div>

        <Row label="Member since">{joined}</Row>
        <Row label="User id">
          <span className="font-mono text-xs text-text-muted">{me.id}</span>
        </Row>
      </Section>

      <Section title="Security">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}>
          <div>
            <p className="text-sm text-text">Password</p>
            <p className="text-xs text-text-muted mt-0.5">Reset via email link.</p>
          </div>
          <a href="/signin" className="text-sm text-text-muted hover:text-text underline underline-offset-2 transition-colors">
            Reset
          </a>
        </div>
        <GhostRow label="Two-factor authentication" value="Coming soon" />
        <GhostRow label="Active sessions" value="Coming soon" />
      </Section>

      <Section title="Danger Zone">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}>
          <div>
            <p className="text-sm text-text">Sign out</p>
            <p className="text-xs text-text-muted mt-0.5">End your session on this device.</p>
          </div>
          <button onClick={onLogout} className="text-sm text-text-muted hover:text-red-400 transition-colors">
            Sign out
          </button>
        </div>
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6`}>
          <div>
            <p className="text-sm text-text">Delete account</p>
            <p className="text-xs text-text-muted mt-0.5">Permanently remove your account and all data.</p>
          </div>
          <button className="text-sm text-text-muted cursor-not-allowed">Delete</button>
        </div>
      </Section>
    </div>
  );
}

// ─── Privacy ─────────────────────────────────────────────────────────────────

function PrivacyPanel() {
  return (
    <div>
      <Section title="Privacy">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-2`}>
          <p className="text-sm text-text font-medium">Your data stays on your device.</p>
          <p className="text-sm text-text-muted leading-relaxed">
            Misty never transmits your files or cloud credentials to any external server. All provider
            communication runs through Misty's embedded local runtime. We only store your account info
            (name, email, hashed password) and subscription status.
          </p>
        </div>
      </Section>

      <Section title="Legal">
        <GhostRow label="Privacy Policy" value="Coming soon" />
        <GhostRow label="Terms of Service" value="Coming soon" />
        <GhostRow label="License Agreement" value="Coming soon" />
      </Section>

      <Section title="Data">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-3 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6`}>
          <div>
            <p className="text-sm text-text">Export your data</p>
            <p className="text-xs text-text-muted mt-0.5">Download a copy of your account data.</p>
          </div>
          <button className="text-sm text-text-muted cursor-not-allowed">Export</button>
        </div>
      </Section>
    </div>
  );
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function DiagnosticsPanel() {
  const app = useAppStore((state) => state.app);
  const [events, setEvents] = useState<ClientDebugEvent[]>(() => readClientDebugEvents());
  const serverBase = accountDebugBase(
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
    <div>
      <Section title="Runtime">
        <Row label="Misty server API">{serverBase || "Not set"}</Row>
        <Row label="Server env">{import.meta.env.VITE_MISTY_SERVER_URL || import.meta.env.VITE_API_BASE || "Not set"}</Row>
        <Row label="Debug logging">{clientDebugPanelEnabled() ? "Enabled" : "Disabled"}</Row>
      </Section>

      <Section title="Client Events">
        {events.length > 0 ? (
          <div className="divide-y divide-white/[0.08] px-7">
            {events.slice(0, 12).map((event) => (
              <article key={event.id} className="grid gap-1 py-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <strong className={`text-sm ${event.level === "error" ? "text-red-400" : event.level === "warn" ? "text-amber-400" : "text-text"}`}>
                    {event.scope}
                  </strong>
                  <time className="shrink-0 text-xs text-text-muted">{new Date(event.createdAt).toLocaleTimeString()}</time>
                </div>
                <p className="m-0 text-sm text-text-muted">{event.message}</p>
                {event.detail ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-[11px] leading-relaxed text-text-muted [overflow-wrap:anywhere]">
                    {event.detail}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={accountSettingsCustomRowClass}>
            <p className="m-0 text-sm text-text-muted">No client events recorded yet.</p>
          </div>
        )}
        <div className={`${accountSettingsCustomRowClass} flex justify-end`}>
          <button
            type="button"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:text-text"
            onClick={() => {
              clearClientDebugEvents();
              setEvents([]);
            }}
          >
            Clear debug events
          </button>
        </div>
      </Section>
    </div>
  );
}

// ─── Account shell ───────────────────────────────────────────────────────────

export default function DesktopAccountPage(props: {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}) {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
  const currentLicense = useSetupStore((state) => state.status?.current_license ?? null);
  const { me, loading, setMe, setLoading, patchMe } = useUserStore(
    useShallow((state) => ({
      me: state.me,
      loading: state.loading,
      setMe: state.setMe,
      setLoading: state.setLoading,
      patchMe: state.patchMe,
    })),
  );
  const [tab, setTab] = useState<Tab>("general");
  const activeUser = user ?? currentUser;
  const localMe = useMemo(
    () => activeUser ? meFromLocalAccount(activeUser, currentLicense) : null,
    [activeUser, currentLicense],
  );
  const displayMe = me ?? localMe;
  const overlay = props.presentation === "overlay";

  useEffect(() => {
    if (!activeUser) {
      if (overlay) props.onClose?.();
      navigate("/signin", { replace: true, state: { from: "/account" } });
      return;
    }
    if (!user && currentUser) {
      setUser(currentUser);
    }
    if (me) return;
    setLoading(true);
    fetchMe()
      .then(setMe)
      .catch((err) => {
        if (err.status === 401) {
          if (currentUser) {
            setUser(currentUser);
            return;
          }
          setUser(null);
          navigate("/signin", { replace: true, state: { from: "/account" } });
        }
      })
      .finally(() => setLoading(false));
  }, [activeUser, currentUser, user, navigate, me, overlay, props.onClose, setMe, setLoading, setUser]);

  if (!activeUser || (loading && !displayMe)) {
    return (
      <div className={`${overlay ? "h-full" : "min-h-screen"} flex items-center justify-center`}>
        <div className="w-5 h-5 rounded-full border-2 border-border border-t-text-muted animate-spin" />
      </div>
    );
  }

  const activeTab = TABS.find((currentTab) => currentTab.id === tab) ?? TABS[0];
  const ActiveIcon = activeTab.icon;
  const activePanel = (
    <>
      {tab === "general" && <GeneralPanel />}

      {displayMe && tab === "account" && (
        <AccountPanel
          me={displayMe}
          onUpdated={(name) => {
            patchMe({ name });
            setUser({ ...activeUser, name });
          }}
          onLogout={logout}
        />
      )}

      {tab === "privacy" && <PrivacyPanel />}

      {tab === "diagnostics" && <DiagnosticsPanel />}
    </>
  );

  return (
    <section
      className={overlay ? desktopSettingsOverlayGridClass : desktopSettingsGridClass}
      aria-label="Account settings"
    >
      <aside className={desktopSettingsSidebarClass} aria-label="Account settings sections">
        <div className="grid gap-[5px]">
          <span className="px-2 pb-3 pt-2 text-[10px] font-bold uppercase tracking-normal text-[#767676]">
            {overlay ? "Account settings" : "Misty Account Settings"}
          </span>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`${desktopSettingsNavItemClass} ${tab === id ? desktopSettingsNavItemSelectedClass : ""}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {label}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="w-px bg-white/10" />

      {overlay ? (
        <main className={desktopSettingsOverlayContentShellClass}>
          <header className={desktopSettingsOverlayHeaderClass}>
            <div className="flex min-w-0 items-center gap-3">
              <ActiveIcon
                size={17}
                strokeWidth={1.8}
                className="shrink-0 text-[#8d8d8d]"
              />
              <h1 className="m-0 min-w-0 truncate text-[15px] font-[740] leading-tight tracking-normal text-[#f4f4f5]">
                {activeTab.label}
              </h1>
            </div>
            <button
              type="button"
              className={desktopSettingsOverlayCloseClass}
              aria-label="Close account settings"
              title="Close account settings"
              onClick={props.onClose}
            >
              <X size={17} strokeWidth={1.8} />
            </button>
          </header>
          <div className={desktopSettingsOverlayContentClass}>
            <div className={desktopSettingsOverlayScrollSurfaceClass}>
              {activePanel}
            </div>
          </div>
        </main>
      ) : (
        <main className={desktopSettingsContentClass}>
          <div className={desktopSettingsScrollSurfaceClass}>
            <h1 className="mb-[18px] mt-1 text-[28px] font-[760] leading-[1.15] tracking-normal text-[#f4f4f5]">
              {activeTab.label}
            </h1>
            {activePanel}
          </div>
        </main>
      )}
    </section>
  );
}

function accountDebugBase(base: string | null | undefined) {
  const trimmed = typeof base === "string" ? base.trim().replace(/\/+$/, "") : "";
  if (!trimmed) return "";
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
}

function meFromLocalAccount(
  user: { id: string; name: string; username?: string; email: string },
  license: CurrentLicense | null,
): MeResponse {
  return {
    id: user.id,
    name: user.name,
    username: user.username ?? "",
    email: user.email,
    created_at: new Date().toISOString(),
    tier: license?.tier ?? "basic",
    status: license?.status ?? "active",
    allows_use: license?.allows_use ?? true,
    expires_at: license?.expires_at ?? null,
    trial_started_at: license?.trial_started_at ?? null,
    license_device: license?.license_device ?? "",
  };
}
