import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Coins, CreditCard, Lock, UserCircle, type LucideIcon } from "lucide-react";

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
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";
import { useUserStore } from "@/store/userStore";
import {
  createBillingPortal,
  fetchBillingUsage,
  fetchMe,
  updateProfile,
  type BillingUsageResponse,
  type MeResponse,
} from "./api";

const TIER_LABEL: Record<string, string> = {
  basic: "Free",
  personal: "Personal",
  pro: "Pro",
  max: "Max",
};

type AccountStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TIER_TONE: Record<string, AccountStatusTone> = {
  basic: "neutral",
  personal: "info",
  pro: "info",
  max: "info",
};

const STATUS_TONE: Record<string, AccountStatusTone> = {
  active: "success",
  trialing: "info",
  cancelled: "warning",
  expired: "danger",
};

const STATUS_CLASSES: Record<AccountStatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info:
    "border-[color-mix(in_srgb,var(--settings-info)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-info)_12%,transparent)] text-[var(--settings-info)]",
  success:
    "border-[color-mix(in_srgb,var(--settings-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-success)_12%,transparent)] text-[var(--settings-success)]",
  warning:
    "border-[color-mix(in_srgb,var(--settings-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-warning)_12%,transparent)] text-[var(--settings-warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--settings-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-danger)_12%,transparent)] text-[var(--settings-danger)]",
};

const customRowClass = "border-b border-border/60 px-5 py-4 last:border-b-0";

function AccountBadge({ label, tone }: { label: string; tone: AccountStatusTone }) {
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
  return <DesktopSettingsSection title={title}>{children}</DesktopSettingsSection>;
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
      <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--settings-success)]">
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

type Tab = "account" | "credits" | "billing" | "privacy";

const TABS: readonly { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "account", label: "Account", icon: UserCircle },
  { id: "credits", label: "Credits", icon: Coins },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "privacy", label: "Privacy", icon: Lock },
];

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  account: "Review your Misty account and profile details.",
  credits: "Check your balance and add credits for managed AI.",
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
  const {
    saving,
    error,
    ok,
    save,
  } = useSave(async () => {
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
              <AvatarFallback className="text-base font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{me.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{me.email}</p>
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
                disabled={saving || name.trim() === "" || name.trim() === me.name}
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
            <p id="account-email-description" className="mt-1 text-xs text-muted-foreground">
              Email cannot be changed.
            </p>
          </div>
        </div>

        <Row label="Member since">{joined}</Row>
        <Row label="User id">
          <span className="font-mono text-xs text-muted-foreground">{me.id}</span>
        </Row>
      </Section>

      <Section title="Security">
        <div
          className={`${customRowClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6`}
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
      </Section>
    </div>
  );
}

function CreditsPanel({
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
  const creditUsedPercent =
    usage && usage.monthly_allowance > 0
      ? Math.round((1 - usage.monthly_remaining / usage.monthly_allowance) * 100)
      : 0;
  const creditWarning =
    creditUsedPercent >= 100
      ? "Managed AI is paused until you add credits or the allowance resets."
      : creditUsedPercent >= 90
        ? "You have used at least 90% of this month’s credits."
        : creditUsedPercent >= 75
          ? "You have used at least 75% of this month’s credits."
          : "";

  return (
    <div>
      <Section title="Misty Credits">
        {state === "loading" || state === "idle" ? (
          <div className={`${customRowClass} flex min-h-16 items-center gap-2 text-muted-foreground`}>
            <Spinner aria-hidden="true" className="size-4" />
            <span className="text-sm">Loading credit balance</span>
          </div>
        ) : null}

        {state === "error" ? (
          <div className={customRowClass}>
            <Alert variant="destructive">
              <AlertTitle>Credit balance is unavailable</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        {state === "ready" && usage ? (
          <>
            <Row label="Available">{usage.available_credits.toLocaleString()} credits</Row>
            <Row label="Monthly allowance">
              {usage.monthly_remaining.toLocaleString()} of{" "}
              {usage.monthly_allowance.toLocaleString()} remaining
            </Row>
            <Row label="Purchased">{usage.purchased_remaining.toLocaleString()} credits</Row>
            <Row label="Resets">{new Date(usage.next_reset_at).toLocaleDateString()}</Row>
            <div className={customRowClass}>
              <Progress
                value={Math.min(100, creditUsedPercent)}
                aria-label={`${creditUsedPercent}% of monthly credits used`}
              />
              {creditWarning ? (
                <p className="mt-2 text-xs text-[var(--settings-warning)]">{creditWarning}</p>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>

      <Section title="Credit packs">
        <div className={`${customRowClass} grid gap-3`}>
          <p className="m-0 text-sm font-medium text-foreground">
            Credit checkout is not open during the invite-only beta.
          </p>
          <p className="m-0 text-sm leading-6 text-muted-foreground">
            Permanent top-up packs are planned at 1,500 credits for $4.99 and 3,500 credits for
            $9.99. Purchased credits will be used after the monthly allowance and will not expire.
          </p>
        </div>
      </Section>
    </div>
  );
}

function BillingPanel({
  me,
  loading,
  loadError,
  billingWorking,
  billingError,
  onBillingAction,
}: {
  me: MeResponse | null;
  loading: boolean;
  loadError: string;
  billingWorking: boolean;
  billingError: string;
  onBillingAction: (action: () => Promise<{ url: string }>) => void;
}) {
  const accountType = me
    ? me.billing?.kind === "lifetime"
      ? "Lifetime"
      : me.billing?.kind === "subscription"
        ? `${me.billing.interval === "year" ? "Annual" : "Monthly"} subscription`
        : me.status === "trialing"
          ? "Pro trial"
          : me.tier === "basic"
            ? "Free account"
            : "Lifetime"
    : "";

  return (
    <div>
      <Section title="Plan">
        {loading && !me ? (
          <div className={`${customRowClass} flex min-h-16 items-center gap-2 text-muted-foreground`}>
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
            <Row label="Type">{accountType}</Row>
            {me.billing?.current_period_end ? (
              <Row label={me.billing.cancel_at_period_end ? "Access until" : "Renews"}>
                {new Date(me.billing.current_period_end).toLocaleDateString()}
              </Row>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Billing">
        {me?.billing?.kind === "subscription" ? (
          <>
            <Row label="Current plan">
              {TIER_LABEL[me.tier]} · {me.billing.interval === "year" ? "yearly" : "monthly"}
            </Row>
            <div className={customRowClass}>
              <Button
                type="button"
                disabled={billingWorking || !me.billing.customer_portal_available}
                onClick={() => onBillingAction(createBillingPortal)}
              >
                Manage billing
              </Button>
            </div>
          </>
        ) : (
          <div className={`${customRowClass} grid gap-3`}>
            <p className="m-0 text-sm font-medium text-foreground">
              Paid checkout is not open during the invite-only beta.
            </p>
            <p className="m-0 text-sm leading-6 text-muted-foreground">
              Future pricing is Pro at $8.99 monthly or $89 yearly and Max at $19.99 monthly or
              $199 yearly. The planned beta invitation flow includes a code-gated 30-day Pro
              trial with 2,000 Mika credits.
            </p>
            <Button asChild className="w-fit">
              <a
                href={BETA_ACCESS_HREF}
                target={BETA_ACCESS_EXTERNAL ? "_blank" : undefined}
                rel={BETA_ACCESS_EXTERNAL ? "noopener noreferrer" : undefined}
              >
                Join the beta
              </a>
            </Button>
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
            Private Files operations stay local unless you connect a provider or explicitly add
            content to a Space. Shared Library content is stored for that Space, and Mika may use
            context you are permitted to access. Billing records do not contain prompts or file
            contents.
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
        setLoadError(requestError.message || "Could not load your Misty account.");
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
        setUsageError(error instanceof Error ? error.message : "Could not load credit usage.");
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
        setBillingError(error instanceof Error ? error.message : "Could not start billing.");
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
          Manage your Misty account, credits, billing, and privacy settings.
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

          {tab === "credits" ? (
            <CreditsPanel
              usage={usage}
              state={usageState}
              error={usageError}
              onRetry={() => setUsageRequest((request) => request + 1)}
            />
          ) : null}

          {tab === "billing" ? (
            <BillingPanel
              me={me}
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
