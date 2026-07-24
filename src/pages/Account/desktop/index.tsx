import type { AccountStatusTone, Tab } from "@/models/types/pages/Account/desktop/index";
export type { AccountStatusTone, Tab } from "@/models/types/pages/Account/desktop/index";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Progress } from "@/ui";
import { LoadingState } from "@/ui";
import { StatusBadge } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import {
  accountCreateCheckout as createCheckout,
  accountCreatePortalSession as createPortalSession,
  accountFetchBillingUsage as fetchBillingUsage,
  accountFetchMe as fetchMe,
  accountUpdateDevice as updateDevice,
  accountUpdateProfile as updateProfile,
} from "@/stores/account/useAccountStore";
import type {
  BillingUsageResponse,
  AccountMeResponse as MeResponse,
} from "@/models/interfaces/stores/account/useAccountStore";
import { useUserStore } from "@/stores/account/useUserStore";
import { readAccountSessionGeneration } from "@/stores/account/useAuthTokenStore";
import { useSetupStore } from "@/stores/app";
import type { CurrentLicense } from "@/models/types/features/installer/types";
import { useAppStore } from "@/stores/app";
import {
  clearClientDebugEvents,
  clientDebugPanelEnabled,
  readClientDebugEvents,
} from "@/platform/clientDebug";
import type { ClientDebugEvent } from "@/models/interfaces/platform/clientDebug";
import { openExternalLink } from "@/platform/openExternalLink";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { Bug, Lock, Rows3, UserCircle, type LucideIcon } from "lucide-react";
import { formatBytes } from "@/features/spaces/libraryFormat";
import {
  DesktopSettingsFrame,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "../../Settings/DesktopSettingsUI";
import { ProfileAvatarEditor } from "./ProfileAvatarEditor";
const TIER_LABEL: Record<string, string> = {
  basic: "Free",
  pro: "Pro",
};

const TIER_TONE: Record<string, AccountStatusTone> = {
  basic: "neutral",
  pro: "info",
};
const STATUS_TONE: Record<string, AccountStatusTone> = {
  active: "success",
  trialing: "info",
  cancelled: "warning",
  expired: "danger",
};

function AccountBadge({ label, tone }: { label: string; tone: AccountStatusTone }) {
  return (
    <StatusBadge status={tone} dot>
      {label}
    </StatusBadge>
  );
}

const accountSettingsCustomRowClass = "border-b border-border/60 px-5 py-4 last:border-b-0";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <DesktopSettingsSection title={title}>{children}</DesktopSettingsSection>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DesktopSettingsRow label={label}>
      <span className="text-right text-sm text-foreground max-[760px]:text-left">{children}</span>
    </DesktopSettingsRow>
  );
}

function GhostRow({ label, value }: { label: string; value: string }) {
  return (
    <DesktopSettingsRow label={label} muted>
      <span className="italic text-muted-foreground">{value}</span>
    </DesktopSettingsRow>
  );
}

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
  if (ok) return <p className="mt-2 text-xs text-[var(--misty-success)]">Saved.</p>;
  if (error) return <p className="mt-2 text-xs text-destructive">{error}</p>;
  return null;
}

function storageCleanupNotice(storage: BillingUsageResponse["storage"]): string {
  const deadline = storage.cleanup_notice_until ? new Date(storage.cleanup_notice_until) : null;
  if (deadline && deadline.getTime() <= Date.now()) {
    return "The 30-day cleanup period has ended. Your storage remains intact, and new hosted files stay paused until usage falls below the limit or Pro resumes.";
  }
  const due = deadline ? ` by ${deadline.toLocaleDateString()}` : "";
  return `New hosted files are paused while this account is over its storage limit. Clean up or resume Pro${due}. Existing files remain available and are never deleted automatically.`;
}

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Rows3 },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "diagnostics", label: "Diagnostics", icon: Bug },
];

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  general: "App information and account-level notification defaults.",
  account: "Manage your profile, storage, hosted AI usage, and billing.",
  privacy: "Understand how Misty handles your files and account data.",
  diagnostics: "Inspect runtime configuration and recent client events.",
};

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
          <span className="font-mono text-xs text-muted-foreground">v0.1.0-beta</span>
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
  onAvatarUpdated,
  onLogout,
  transitioning,
}: {
  me: MeResponse;
  onUpdated: (name: string) => void;
  onAvatarUpdated: (avatarVersion: number) => void;
  onLogout: () => Promise<void>;
  transitioning: boolean;
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
    const generation = readAccountSessionGeneration();
    await updateProfile(name);
    if (readAccountSessionGeneration() !== generation) return;
    onUpdated(name);
  });

  useEffect(() => {
    const generation = readAccountSessionGeneration();
    let canceled = false;
    setBillingUsage(null);
    void fetchBillingUsage()
      .then((usage) => {
        if (!canceled && readAccountSessionGeneration() === generation) setBillingUsage(usage);
      })
      .catch(() => {
        if (!canceled && readAccountSessionGeneration() === generation) setBillingUsage(null);
      });
    return () => {
      canceled = true;
    };
  }, [me.id, me.tier]);

  async function openBillingAction(action: () => Promise<{ url: string }>) {
    const generation = readAccountSessionGeneration();
    setBillingWorking(true);
    setBillingError("");
    try {
      const { url } = await action();
      if (readAccountSessionGeneration() !== generation) return;
      await openExternalLink(url);
    } catch (error) {
      if (readAccountSessionGeneration() !== generation) return;
      setBillingError(error instanceof Error ? error.message : "Could not start billing.");
    } finally {
      if (readAccountSessionGeneration() === generation) setBillingWorking(false);
    }
  }
  const {
    saving: savingDevice,
    error: deviceError,
    ok: deviceOk,
    save: saveDevice,
  } = useSave(async () => {
    const generation = readAccountSessionGeneration();
    await updateDevice(device);
    if (readAccountSessionGeneration() !== generation) return;
    patchMe({ license_device: device });
  });

  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const hostedAIUsedPercent = billingUsage
    ? Math.round(Math.min(1, Math.max(0, billingUsage.hosted_ai.used_ratio)) * 100)
    : 0;
  const hostedAIWarning =
    hostedAIUsedPercent >= 100
      ? "Hosted AI is paused until the weekly reset or a Pro upgrade."
      : hostedAIUsedPercent >= 90
        ? "You have used at least 90% of this week’s hosted AI usage."
        : hostedAIUsedPercent >= 75
          ? "You have used at least 75% of this week’s hosted AI usage."
          : "";

  return (
    <div>
      <Section title="License">
        <Row label="Plan">
          <AccountBadge
            label={TIER_LABEL[me.tier] ?? me.tier}
            tone={TIER_TONE[me.tier] ?? "neutral"}
          />
        </Row>
        <Row label="Status">
          <AccountBadge
            label={me.status.charAt(0).toUpperCase() + me.status.slice(1)}
            tone={STATUS_TONE[me.status] ?? "neutral"}
          />
        </Row>
        <Row label="Type">
          {me.billing?.kind === "lifetime"
            ? "Lifetime"
            : me.billing?.kind === "subscription"
              ? `${me.billing.interval === "year" ? "Annual" : "Monthly"} subscription`
              : me.status === "trialing"
                ? "Pro trial"
                : "Free account"}
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
        <div
          className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6`}
        >
          <div className="space-y-1">
            <label htmlFor="account-device-name" className="text-sm font-medium text-foreground">
              Licensed device
            </label>
            <p className="text-xs text-muted-foreground">
              Change the machine name registered to your license.
            </p>
          </div>
          <div className="w-full md:max-w-sm">
            <div className="flex gap-2">
              <Input
                id="account-device-name"
                type="text"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                placeholder="e.g. MacBook Pro"
                disabled={transitioning}
                className="min-w-0 flex-1"
              />
              <Button
                onClick={saveDevice}
                disabled={transitioning || savingDevice}
                className="shrink-0"
              >
                {savingDevice ? "Saving…" : "Save"}
              </Button>
            </div>
            <SaveFeedback ok={deviceOk} error={deviceError} />
          </div>
        </div>

        <div
          className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm font-medium text-foreground">
              {me.license_device || "Primary device"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {TIER_LABEL[me.tier] ?? me.tier} · Activated
            </p>
          </div>
          <AccountBadge label="Active" tone="success" />
        </div>

        {me.tier === "basic" && (
          <div
            className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
          >
            <p className="text-xs text-muted-foreground">
              Pro is $9/month or $89/year, with a 14-day trial.
            </p>
            <Button
              variant="link"
              disabled={transitioning || billingWorking}
              onClick={() => void openBillingAction(() => createCheckout("pro", "month"))}
              className="h-auto shrink-0 p-0 text-xs"
            >
              Upgrade to Pro
            </Button>
          </div>
        )}
      </Section>

      <Section title="Storage">
        {billingUsage ? (
          <>
            <Row label="Owner pool">
              {formatBytes(billingUsage.storage.used_bytes)} of{" "}
              {formatBytes(billingUsage.storage.limit_bytes)} used
            </Row>
            <Row label="Available">{formatBytes(billingUsage.storage.remaining_bytes)}</Row>
            <div className={accountSettingsCustomRowClass}>
              <Progress
                value={Math.min(
                  100,
                  Math.round(
                    (billingUsage.storage.used_bytes / billingUsage.storage.limit_bytes) * 100,
                  ),
                )}
              />
              {billingUsage.storage.over_quota_since ? (
                <p className="mt-2 text-xs text-[var(--misty-warning)]">
                  {storageCleanupNotice(billingUsage.storage)}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <GhostRow label="Usage" value="Loading storage usage" />
        )}
      </Section>

      <Section title="Hosted AI usage">
        {billingUsage ? (
          <>
            <Row label="This week">{hostedAIUsedPercent}% used</Row>
            <Row label="Resets">{new Date(billingUsage.hosted_ai.reset_at).toLocaleString()}</Row>
            <div className={accountSettingsCustomRowClass}>
              <Progress value={hostedAIUsedPercent} />
              {hostedAIWarning ? (
                <p className="mt-2 text-xs text-[var(--misty-warning)]">{hostedAIWarning}</p>
              ) : null}
            </div>
          </>
        ) : (
          <GhostRow label="Usage" value="Loading hosted AI usage" />
        )}
      </Section>

      <Section title="Billing">
        {me.billing?.kind === "subscription" ? (
          <>
            <Row label="Plan">
              {TIER_LABEL[me.tier]} · {me.billing.interval === "year" ? "yearly" : "monthly"}
            </Row>
            <div className={accountSettingsCustomRowClass}>
              <Button
                variant="link"
                disabled={transitioning || billingWorking || !me.billing.customer_portal_available}
                onClick={() => void openBillingAction(createPortalSession)}
                className="h-auto p-0"
              >
                Manage billing →
              </Button>
            </div>
          </>
        ) : (
          <div className={`${accountSettingsCustomRowClass} grid gap-3`}>
            <p className="m-0 text-sm text-muted-foreground">
              Pro includes 50 GB of owner storage and over 6× the weekly hosted AI capacity.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={transitioning || billingWorking}
                onClick={() => void openBillingAction(() => createCheckout("pro", "month"))}
              >
                Start Pro trial · $9/mo
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={transitioning || billingWorking}
                onClick={() => void openBillingAction(() => createCheckout("pro", "year"))}
              >
                Start annual trial · $89/yr
              </Button>
            </div>
          </div>
        )}
        {billingError ? (
          <div className={accountSettingsCustomRowClass}>
            <Alert variant="destructive">
              <AlertTitle>Billing is temporarily unavailable</AlertTitle>
              <AlertDescription>{billingError}</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </Section>

      <Section title="Info">
        <div className={`${accountSettingsCustomRowClass} flex flex-col gap-4 py-5`}>
          <ProfileAvatarEditor
            name={me.name}
            email={me.email}
            initialVersion={me.avatar_version ?? 0}
            disabled={transitioning}
            onUpdated={onAvatarUpdated}
          />

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label
                htmlFor="account-display-name"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Display name
              </label>
              <Input
                id="account-display-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={transitioning}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={saveProfile}
                disabled={transitioning || savingProfile || name.trim() === "" || name === me.name}
              >
                {savingProfile ? "Saving…" : "Save changes"}
              </Button>
              <SaveFeedback ok={profileOk} error={profileError} />
            </div>
          </div>

          <div>
            <label
              htmlFor="account-email"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Email
            </label>
            <Input id="account-email" type="email" value={me.email} disabled />
            <p className="mt-1 text-xs text-muted-foreground/60">Email cannot be changed.</p>
          </div>
        </div>

        <Row label="Member since">{joined}</Row>
        <Row label="User id">
          <span className="font-mono text-xs text-muted-foreground">{me.id}</span>
        </Row>
      </Section>

      <Section title="Security">
        <div
          className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm text-foreground">Password</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Reset via email link.</p>
          </div>
          <Button asChild variant="link" className="h-auto p-0">
            <a href="/signin">Reset</a>
          </Button>
        </div>
        <GhostRow label="Two-factor authentication" value="Coming soon" />
        <GhostRow label="Active sessions" value="Coming soon" />
      </Section>

      <Section title="Danger Zone">
        <div
          className={`${accountSettingsCustomRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm text-foreground">Sign out</p>
            <p className="mt-0.5 text-xs text-muted-foreground">End your session on this device.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={transitioning}
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Sign out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out of Misty?</AlertDialogTitle>
                <AlertDialogDescription>
                  This ends the account session on this device. Your local files and preferences
                  will remain in place.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={transitioning}
                  onClick={() => void onLogout()}
                >
                  Sign out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div
          className={`${accountSettingsCustomRowClass} flex flex-col gap-3 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm text-foreground">Delete account</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Permanently remove your account and all data.
            </p>
          </div>
          <Button variant="outline" disabled>
            Delete
          </Button>
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
          <p className="text-sm font-medium text-foreground">
            Private by default, explicit when shared.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Files and local provider access stay private until you choose an action that uploads or
            shares content. Space Library copies, Chat attachments, account data, agent prompts and
            selected context, and supported integration credentials may be sent to the configured
            Misty service or provider to perform that action. Misty shows the destination before a
            private file becomes shared Space content.
          </p>
        </div>
      </Section>

      <Section title="Legal">
        <GhostRow label="Privacy Policy" value="Coming soon" />
        <GhostRow label="Terms of Service" value="Coming soon" />
        <GhostRow label="License Agreement" value="Coming soon" />
      </Section>

      <Section title="Data">
        <div
          className={`${accountSettingsCustomRowClass} flex flex-col gap-3 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm text-foreground">Export your data</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Download a copy of your account data.
            </p>
          </div>
          <Button variant="outline" disabled>
            Export
          </Button>
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
    import.meta.env.VITE_MISTY_PUBLIC_API_URL ||
      import.meta.env.VITE_MISTY_SERVER_URL ||
      import.meta.env.VITE_API_BASE ||
      app?.environment.serverUrl ||
      null,
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
        <Row label="Server env">
          {import.meta.env.VITE_MISTY_PUBLIC_API_URL ||
            import.meta.env.VITE_MISTY_SERVER_URL ||
            import.meta.env.VITE_API_BASE ||
            "Not set"}
        </Row>
        <Row label="Debug logging">{clientDebugPanelEnabled() ? "Enabled" : "Disabled"}</Row>
      </Section>

      <Section title="Client Events">
        {events.length > 0 ? (
          <div className="divide-y divide-border/60 px-7">
            {events.slice(0, 12).map((event) => (
              <article key={event.id} className="grid gap-1 py-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <strong
                    className={`text-sm ${event.level === "error" ? "text-destructive" : event.level === "warn" ? "text-[var(--misty-warning)]" : "text-foreground"}`}
                  >
                    {event.scope}
                  </strong>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </time>
                </div>
                <p className="m-0 text-sm text-muted-foreground">{event.message}</p>
                {event.detail ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {event.detail}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={accountSettingsCustomRowClass}>
            <p className="m-0 text-sm text-muted-foreground">No client events recorded yet.</p>
          </div>
        )}
        <div className={`${accountSettingsCustomRowClass} flex justify-end`}>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearClientDebugEvents();
              setEvents([]);
            }}
          >
            Clear debug events
          </Button>
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
  const { user, logout, setUser, transitioning } = useAuth();
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
    () => (activeUser ? meFromLocalAccount(activeUser, currentLicense) : null),
    [activeUser, currentLicense],
  );
  const accountMe = me?.id === activeUser?.id ? me : null;
  const displayMe = accountMe ?? localMe;
  const overlay = props.presentation === "overlay";

  useEffect(() => {
    let canceled = false;
    if (!activeUser) {
      if (overlay) props.onClose?.();
      navigate("/signin", { replace: true, state: { from: "/account" } });
      return;
    }
    if (transitioning) {
      setLoading(true);
      return;
    }
    if (!user && currentUser) {
      setUser(currentUser);
    }
    if (accountMe) {
      setLoading(false);
      return;
    }
    const expectedAccountId = activeUser.id;
    const generation = readAccountSessionGeneration();
    setLoading(true);
    void fetchMe()
      .then((profile) => {
        if (
          canceled ||
          readAccountSessionGeneration() !== generation ||
          profile.id !== expectedAccountId
        )
          return;
        setMe(profile);
      })
      .catch((err) => {
        if (canceled || readAccountSessionGeneration() !== generation) return;
        if (err?.status === 401) {
          void logout();
        }
      })
      .finally(() => {
        if (!canceled && readAccountSessionGeneration() === generation) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    accountMe,
    activeUser,
    currentUser,
    user,
    navigate,
    logout,
    overlay,
    props.onClose,
    setMe,
    setLoading,
    setUser,
    transitioning,
  ]);

  if (!activeUser || transitioning || (loading && !displayMe)) {
    return (
      <div
        className={`${overlay ? "h-full" : "min-h-screen"} flex items-center justify-center bg-background`}
      >
        <LoadingState
          compact
          title="Loading account"
          description="Checking your Misty profile and license."
        />
      </div>
    );
  }

  const activeTab = TABS.find((currentTab) => currentTab.id === tab) ?? TABS[0];
  const activePanel = (
    <>
      {tab === "general" && <GeneralPanel />}

      {displayMe && tab === "account" && (
        <AccountPanel
          key={displayMe.id}
          me={displayMe}
          onUpdated={(name) => {
            patchMe({ name });
            setUser({ ...activeUser, name });
          }}
          onAvatarUpdated={(avatarVersion) => {
            patchMe({ avatar_version: avatarVersion });
            setUser({ ...activeUser, avatarVersion });
          }}
          onLogout={logout}
          transitioning={transitioning}
        />
      )}

      {tab === "privacy" && <PrivacyPanel />}

      {tab === "diagnostics" && <DiagnosticsPanel />}
    </>
  );

  return (
    <DesktopSettingsFrame
      activeId={tab}
      ariaLabel="Account settings"
      description={TAB_DESCRIPTIONS[tab]}
      items={TABS}
      navigationLabel="Account settings sections"
      navigationTitle="Misty account"
      onClose={props.onClose}
      onSelect={setTab}
      presentation={props.presentation}
      title={activeTab.label}
    >
      {activePanel}
    </DesktopSettingsFrame>
  );
}

function accountDebugBase(base: string | null | undefined) {
  return withDefaultApiPath(normalizeApiBaseUrl(base));
}

function meFromLocalAccount(
  user: { id: string; name: string; username?: string; email: string; avatarVersion?: number },
  license: CurrentLicense | null,
): MeResponse {
  return {
    id: user.id,
    name: user.name,
    username: user.username ?? "",
    email: user.email,
    avatar_version: user.avatarVersion ?? 0,
    created_at: new Date().toISOString(),
    tier: license?.tier === "pro" || license?.tier === "max" ? "pro" : "basic",
    status: license?.status ?? "active",
    allows_use: license?.allows_use ?? true,
    expires_at: license?.expires_at ?? null,
    trial_started_at: license?.trial_started_at ?? null,
    license_device: license?.license_device ?? "",
  };
}
