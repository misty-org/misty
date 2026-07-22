import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Sparkles,
  CreditCard,
  Lock,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/AuthContext";
import {
  DesktopSettingsFrame,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "@/components/settings/DesktopSettingsUI";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { PRICING_MODEL } from "@/lib/pricing";
import { useUserStore } from "@/store/userStore";
import {
  createBillingPortal,
  createSubscriptionCheckout,
  fetchBillingUsage,
  fetchMe,
  updateProfile,
  type BillingUsageResponse,
  type MeResponse,
} from "./api";

const TIER_LABEL: Record<string, string> = {
  basic: "Free",
  pro: "Pro",
};

function storageQuotaNotice(storage: BillingUsageResponse["storage"]): string {
  const noticeDate = storage.cleanup_notice_until
    ? new Date(storage.cleanup_notice_until)
    : null;
  const followUp =
    noticeDate && Number.isFinite(noticeDate.getTime())
      ? ` We’ll keep this notice visible through ${noticeDate.toLocaleDateString()}.`
      : "";
  return `New hosted uploads are paused because the pooled owner storage is over quota. Existing data remains intact, and nothing is automatically deleted.${followUp}`;
}

type AccountStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

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

const STATUS_CLASSES: Record<AccountStatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-[color-mix(in_srgb,var(--settings-info)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-info)_12%,transparent)] text-[var(--settings-info)]",
  success:
    "border-[color-mix(in_srgb,var(--settings-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-success)_12%,transparent)] text-[var(--settings-success)]",
  warning:
    "border-[color-mix(in_srgb,var(--settings-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-warning)_12%,transparent)] text-[var(--settings-warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--settings-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-danger)_12%,transparent)] text-[var(--settings-danger)]",
};

const customRowClass = "border-b border-border/60 px-5 py-4 last:border-b-0";

function AccountBadge({
  label,
  tone,
}: {
  label: string;
  tone: AccountStatusTone;
}) {
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 rounded-md px-2 py-0.5 font-medium shadow-none ${STATUS_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DesktopSettingsSection title={title}>{children}</DesktopSettingsSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DesktopSettingsRow label={label}>
      <span className="text-right text-sm text-foreground max-[760px]:text-left">
        {children}
      </span>
    </DesktopSettingsRow>
  );
}

function GhostRow({ label, value }: { label: string; value: string }) {
  return (
    <DesktopSettingsRow label={label}>
      <span className="text-sm italic text-muted-foreground">{value}</span>
    </DesktopSettingsRow>
  );
}

function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1_000) return `${safeBytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(safeBytes) / Math.log(1_000)) - 1,
  );
  const value = safeBytes / 1_000 ** (unitIndex + 1);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character: string) => character.toUpperCase());
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
      window.setTimeout(() => setOk(false), 2500);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, ok, save };
}

function SaveFeedback({ ok, error }: { ok: boolean; error: string }) {
  if (ok) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="mt-2 text-xs text-[var(--settings-success)]"
      >
        Saved.
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" className="mt-2 text-xs text-destructive">
        {error}
      </p>
    );
  }

  return null;
}

type Tab = "account" | "usage" | "billing" | "privacy";

const TABS: readonly { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "account", label: "Account", icon: UserCircle },
  { id: "usage", label: "Usage", icon: Sparkles },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "privacy", label: "Privacy", icon: Lock },
];

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  account: "Review your Misty account and profile details.",
  usage: "Review pooled storage and weekly hosted AI usage.",
  billing: "Review your plan and manage subscription billing.",
  privacy: "Understand how Misty handles your files and account data.",
};

type LoadState = "idle" | "loading" | "ready" | "error";

function AccountPanel({
  me,
  onUpdated,
}: {
  me: MeResponse;
  onUpdated: (name: string) => void;
}) {
  const [name, setName] = useState(me.name);
  const { saving, error, ok, save } = useSave(async () => {
    const nextName = name.trim();
    await updateProfile(nextName);
    onUpdated(nextName);
  });
  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const initials = (name.trim() || me.name || me.email)
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div>
      <Section title="Profile">
        <div className={`${customRowClass} flex flex-col gap-4 py-5`}>
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="text-base font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {me.name}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {me.email}
              </p>
            </div>
          </div>

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
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 max-[520px]:flex-col max-[520px]:items-stretch">
              <Button
                type="button"
                onClick={save}
                disabled={
                  saving || name.trim() === "" || name.trim() === me.name
                }
                aria-busy={saving}
              >
                {saving ? <Spinner aria-hidden="true" /> : null}
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <SaveFeedback ok={ok} error={error} />
            </div>
          </div>

          <div>
            <label
              htmlFor="account-email"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Email
            </label>
            <Input
              id="account-email"
              type="email"
              value={me.email}
              disabled
              aria-describedby="account-email-description"
            />
            <p
              id="account-email-description"
              className="mt-1 text-xs text-muted-foreground"
            >
              Email cannot be changed.
            </p>
          </div>
        </div>

        <Row label="Member since">{joined}</Row>
        <Row label="User id">
          <span className="font-mono text-xs text-muted-foreground">
            {me.id}
          </span>
        </Row>
      </Section>

      <Section title="Security">
        <div
          className={`${customRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
        >
          <div>
            <p className="text-sm text-foreground">Password</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reset via email link.
            </p>
          </div>
          <Button asChild variant="link" className="h-auto p-0">
            <a href="/signin">Reset</a>
          </Button>
        </div>
        <GhostRow label="Two-factor authentication" value="Coming soon" />
      </Section>
    </div>
  );
}

function UsagePanel({
  usage,
  state,
  error,
  onRetry,
}: {
  usage: BillingUsageResponse | null;
  state: LoadState;
  error: string;
  onRetry: () => void;
}) {
  const hostedAIUsedPercent = usage
    ? Math.round(Math.min(1, Math.max(0, usage.hosted_ai.used_ratio)) * 100)
    : 0;
  const storageUsedPercent = usage
    ? usage.storage.limit_bytes > 0
      ? Math.min(
          100,
          Math.round(
            (usage.storage.used_bytes / usage.storage.limit_bytes) * 100,
          ),
        )
      : 0
    : 0;
  const hostedAIWarning =
    hostedAIUsedPercent >= 100
      ? "Hosted AI is paused until the weekly reset or a Pro upgrade. Files and collaboration still work, with no automatic overage."
      : hostedAIUsedPercent >= 90
        ? "You have used at least 90% of this week’s Hosted AI usage."
        : hostedAIUsedPercent >= 75
          ? "You have used at least 75% of this week’s Hosted AI usage."
          : "";

  return (
    <div>
      <Section title="Storage">
        {state === "loading" || state === "idle" ? (
          <div
            className={`${customRowClass} flex min-h-16 items-center gap-2 text-muted-foreground`}
          >
            <Spinner aria-hidden="true" className="size-4" />
            <span className="text-sm">Loading usage</span>
          </div>
        ) : null}

        {state === "error" ? (
          <div className={customRowClass}>
            <Alert variant="destructive">
              <AlertTitle>Usage is unavailable</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        {state === "ready" && usage ? (
          <>
            <Row label="Owner pool">
              {formatBytes(usage.storage.used_bytes)} of{" "}
              {formatBytes(usage.storage.limit_bytes)} used
            </Row>
            <Row label="Available">
              {formatBytes(usage.storage.remaining_bytes)}
            </Row>
            <div className={customRowClass}>
              <Progress
                value={storageUsedPercent}
                aria-label={`${storageUsedPercent}% of owner storage used`}
              />
              {usage.storage.over_quota ? (
                <p className="mt-2 text-xs text-[var(--settings-warning)]">
                  {storageQuotaNotice(usage.storage)}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>

      <Section title="Hosted AI usage">
        {state === "ready" && usage ? (
          <>
            <Row label="This week">{hostedAIUsedPercent}% used</Row>
            <Row label="Weekly reset">
              {new Date(usage.hosted_ai.reset_at).toLocaleDateString()}
            </Row>
            <div className={customRowClass}>
              <Progress
                value={hostedAIUsedPercent}
                aria-label={`${hostedAIUsedPercent}% of weekly hosted AI used`}
              />
              {hostedAIWarning ? (
                <p className="mt-2 text-xs text-[var(--settings-warning)]">
                  {hostedAIWarning}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>
    </div>
  );
}

function BillingPanel({
  me,
  usage,
  loading,
  loadError,
  billingWorking,
  billingError,
  onBillingAction,
}: {
  me: MeResponse | null;
  usage: BillingUsageResponse | null;
  loading: boolean;
  loadError: string;
  billingWorking: boolean;
  billingError: string;
  onBillingAction: (action: () => Promise<{ url: string }>) => void;
}) {
  const plan = usage?.plan ?? me?.tier;
  const trial = usage?.trial;
  const subscription = usage?.subscription;
  const canManageBilling =
    Boolean(me?.billing?.customer_portal_available) &&
    (me?.billing?.kind === "subscription" || me?.billing?.kind === "trial");

  return (
    <div>
      <Section title="Plan">
        {loading && !me ? (
          <div
            className={`${customRowClass} flex min-h-16 items-center gap-2 text-muted-foreground`}
          >
            <Spinner aria-hidden="true" className="size-4" />
            <span className="text-sm">Loading plan details</span>
          </div>
        ) : null}

        {loadError && !me ? (
          <div className={customRowClass}>
            <Alert variant="destructive">
              <AlertTitle>Plan details are unavailable</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {me ? (
          <>
            <Row label="Plan">
              <AccountBadge
                label={TIER_LABEL[plan ?? me.tier] ?? plan ?? me.tier}
                tone={TIER_TONE[plan ?? me.tier] ?? "neutral"}
              />
            </Row>
            {trial ? (
              <>
                <Row label="Trial status">{formatStatus(trial.status)}</Row>
                <Row label="Trial ends">
                  {new Date(trial.ends_at).toLocaleDateString()}
                </Row>
              </>
            ) : subscription ? (
              <>
                <Row label="Subscription status">
                  {subscription.cancel_at_period_end
                    ? "Cancellation scheduled"
                    : formatStatus(subscription.status)}
                </Row>
                <Row label="Billing interval">
                  {subscription.billing_interval === "year"
                    ? "Yearly"
                    : "Monthly"}
                </Row>
                <Row
                  label={
                    subscription.cancel_at_period_end
                      ? "Access until"
                      : "Renews"
                  }
                >
                  {new Date(
                    subscription.current_period_end,
                  ).toLocaleDateString()}
                </Row>
              </>
            ) : (
              <Row label="Status">
                <AccountBadge
                  label={formatStatus(me.status)}
                  tone={STATUS_TONE[me.status] ?? "neutral"}
                />
              </Row>
            )}
          </>
        ) : null}
      </Section>

      <Section title="Billing">
        {canManageBilling ? (
          <>
            <Row label="Current plan">
              {trial
                ? "Pro trial"
                : `${TIER_LABEL[plan ?? "pro"]} · ${subscription?.billing_interval === "year" || me?.billing?.interval === "year" ? "yearly" : "monthly"}`}
            </Row>
            <div className={customRowClass}>
              <Button
                type="button"
                disabled={billingWorking}
                onClick={() => onBillingAction(createBillingPortal)}
              >
                Manage billing
              </Button>
            </div>
          </>
        ) : (
          <div className={`${customRowClass} grid gap-3`}>
            <p className="m-0 text-sm font-medium text-foreground">
              Upgrade to Pro for {PRICING_MODEL.pro.storage} of pooled owner
              storage and {PRICING_MODEL.pro.hostedAI}.
            </p>
            <p className="m-0 text-sm leading-6 text-muted-foreground">
              Start with a one-time {PRICING_MODEL.pro.trialDays}-day trial. A
              card is required, and your plan automatically renews unless
              canceled. There are no automatic overages or surprise charges.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={billingWorking}
                onClick={() =>
                  onBillingAction(() =>
                    createSubscriptionCheckout("pro", "month"),
                  )
                }
              >
                Start Pro trial · {PRICING_MODEL.pro.monthlyPrice}/mo
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={billingWorking}
                onClick={() =>
                  onBillingAction(() =>
                    createSubscriptionCheckout("pro", "year"),
                  )
                }
              >
                Start annual trial · {PRICING_MODEL.pro.yearlyPrice}/yr
              </Button>
            </div>
          </div>
        )}

        {billingError ? (
          <div className={customRowClass}>
            <Alert variant="destructive">
              <AlertTitle>Billing is temporarily unavailable</AlertTitle>
              <AlertDescription>{billingError}</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function PrivacyPanel() {
  return (
    <div>
      <Section title="Privacy">
        <div className={`${customRowClass} flex flex-col gap-2`}>
          <p className="text-sm font-medium text-foreground">
            Private Files and shared Space content are handled differently.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Private Files operations stay local unless you connect a provider or
            explicitly add content to a Space. Shared Library content is stored
            for that Space, and agents may use context you are permitted to
            access. Billing records do not contain prompts or file contents.
          </p>
        </div>
      </Section>

      <Section title="Legal">
        <GhostRow label="Privacy Policy" value="Coming soon" />
        <GhostRow label="Terms of Service" value="Coming soon" />
        <GhostRow label="License Agreement" value="Coming soon" />
      </Section>
    </div>
  );
}

export function AccountSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const { me, loading, setMe, setLoading, patchMe } = useUserStore();
  const [tab, setTab] = useState<Tab>("account");
  const [loadError, setLoadError] = useState("");
  const [usage, setUsage] = useState<BillingUsageResponse | null>(null);
  const [usageState, setUsageState] = useState<LoadState>("idle");
  const [usageError, setUsageError] = useState("");
  const [usageRequest, setUsageRequest] = useState(0);
  const [billingWorking, setBillingWorking] = useState(false);
  const [billingError, setBillingError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (user) return;

    void Promise.resolve().then(() => {
      onOpenChange(false);
      navigate("/signin");
    });
  }, [open, user, navigate, onOpenChange]);

  useEffect(() => {
    if (!open || !user || me) return;

    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadError("");
      setLoading(true);
      try {
        const account = await fetchMe();
        if (active) setMe(account);
      } catch (error) {
        if (!active) return;
        const requestError = error as Error & { status?: number };
        if (requestError.status === 401) {
          onOpenChange(false);
          logout();
          navigate("/signin", { replace: true });
          return;
        }
        setLoadError(
          requestError.message || "Could not load your Misty account.",
        );
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [open, user, me, logout, navigate, onOpenChange, setLoading, setMe]);

  useEffect(() => {
    if (!open || !user) return;

    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setUsageState("loading");
      setUsageError("");
      try {
        const nextUsage = await fetchBillingUsage();
        if (!active) return;
        setUsage(nextUsage);
        setUsageState("ready");
      } catch (error) {
        if (!active) return;
        setUsageError(
          error instanceof Error ? error.message : "Could not load usage.",
        );
        setUsageState("error");
      }
    });

    return () => {
      active = false;
    };
  }, [open, user, usageRequest]);

  function openBillingAction(action: () => Promise<{ url: string }>) {
    setBillingWorking(true);
    setBillingError("");
    void action()
      .then(({ url }) => {
        setBillingWorking(false);
        window.location.assign(url);
      })
      .catch((error) => {
        setBillingError(
          error instanceof Error ? error.message : "Could not start billing.",
        );
        setBillingWorking(false);
      });
  }

  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(760px,calc(100dvh-64px))] w-[min(980px,calc(100vw-64px))] max-w-none gap-0 overflow-hidden rounded-[18px] border border-border bg-card p-0 shadow-[0_28px_90px_rgba(0,0,0,0.62)] ring-0 max-[640px]:h-[calc(100dvh-24px)] max-[640px]:w-[calc(100vw-24px)] sm:max-w-none"
      >
        <DialogTitle className="sr-only">Account settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your Misty account, usage, billing, and privacy settings.
        </DialogDescription>

        <DesktopSettingsFrame
          activeId={tab}
          ariaLabel="Account settings"
          description={TAB_DESCRIPTIONS[tab]}
          items={TABS}
          navigationLabel="Account settings sections"
          navigationTitle="Misty account"
          onClose={() => onOpenChange(false)}
          onSelect={setTab}
          presentation="overlay"
          title={activeTab.label}
        >
          {tab === "account" ? (
            me ? (
              <AccountPanel
                me={me}
                onUpdated={(name) => {
                  patchMe({ name });
                  if (user) setUser({ ...user, name });
                }}
              />
            ) : loading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
                <Spinner aria-hidden="true" className="size-4" />
                <span className="text-sm">Loading account details</span>
              </div>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Account details are unavailable</AlertTitle>
                <AlertDescription>
                  {loadError || "Close settings and try again in a moment."}
                </AlertDescription>
              </Alert>
            )
          ) : null}

          {tab === "usage" ? (
            <UsagePanel
              usage={usage}
              state={usageState}
              error={usageError}
              onRetry={() => setUsageRequest((request) => request + 1)}
            />
          ) : null}

          {tab === "billing" ? (
            <BillingPanel
              me={me}
              usage={usage}
              loading={loading}
              loadError={loadError}
              billingWorking={billingWorking}
              billingError={billingError}
              onBillingAction={openBillingAction}
            />
          ) : null}

          {tab === "privacy" ? <PrivacyPanel /> : null}
        </DesktopSettingsFrame>
      </DialogContent>
    </Dialog>
  );
}

// The legacy route is intentionally empty. App converts /settings into the
// same modal over the home page so old bookmarks still work without a page.
export default function SettingsRoute() {
  return null;
}
