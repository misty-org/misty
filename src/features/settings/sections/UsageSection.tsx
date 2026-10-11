import { useCallback, useEffect, useState } from "react";
import { apiRequest, readApiSessionGeneration } from "@/api/client";
import { ApiRequestError } from "@/api/client/errors";
import type { AccountMeResponse } from "@/api/account/types";
import type { AiLimit, BillingUsage } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import { openAccountSettingsInBrowser } from "@/features/account/openAccountSettings";
import { Button, Progress, Skeleton } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { CopyableValueText, SettingsNote } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const planNames: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  max: "Max",
  ultra: "Ultra",
  ultra_plus: "Ultra+",
};

interface Referral {
  code: string;
  link: string;
  referrals?: { active: number; pending: number; bonus_units: number };
}

interface UsageState {
  generation: number;
  usage?: BillingUsage;
  me?: AccountMeResponse;
  referral?: Referral;
  failed?: boolean;
}

/** "Refills at 4:10 PM" / "Refills Monday at 12:00 AM" for a limit's reset. */
function refillText(limit: AiLimit, idle: string): string {
  if (!limit.resets_at) return idle;
  const reset = new Date(limit.resets_at);
  const sameDay = reset.toDateString() === new Date().toDateString();
  const time = reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = reset.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return sameDay ? `Refills at ${time}.` : `Refills ${day} at ${time}.`;
}

function LimitRow(props: { label: string; limit?: AiLimit; idle: string; description: string }) {
  const used = props.limit ? Math.min(100, Math.max(0, props.limit.percentage_used)) : 0;
  return (
    <SettingsRow
      label={props.label}
      description={
        props.limit
          ? `${props.description} ${refillText(props.limit, props.idle)}`
          : props.description
      }
    >
      {props.limit ? (
        <span className="flex w-[240px] items-center gap-3">
          <Progress
            aria-label={`${props.label} used`}
            value={used}
            className="h-1.5 flex-1 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
          />
          <span className="w-10 text-right text-[15px] tabular-nums text-cream">
            {Math.round(used)}%
          </span>
        </span>
      ) : (
        <Skeleton className="h-1.5 w-[240px] rounded-full" />
      )}
    </SettingsRow>
  );
}

/**
 * The account's plan, its three AI limits, email confirmation and invites. Every
 * value comes from the same requests admission uses, so it matches what the
 * next AI request will meet.
 */
export function UsageSection(_props: SettingsContentProps) {
  const generation = readApiSessionGeneration();
  const [state, setState] = useState<UsageState>();
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    const controller = new AbortController();
    const request = <T,>(path: string) =>
      apiRequest<T>(path, { signal: controller.signal, cache: "no-store" });
    void Promise.all([
      request<BillingUsage>("/billing/usage"),
      request<AccountMeResponse>("/me"),
      request<Referral>("/me/referral").catch(() => undefined),
    ])
      .then(([usage, me, referral]) => {
        if (!controller.signal.aborted && generation === readApiSessionGeneration())
          setState({ generation, usage, me, referral });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState((current) => ({ ...current, generation, failed: true }));
      });
    return () => controller.abort();
  }, [generation]);
  useEffect(load, [load]);
  const current = state?.generation === generation ? state : undefined;
  const ai = current?.usage?.account?.ai ?? current?.usage?.personal?.ai;
  const limits = ai?.limits;
  const plan = current?.me?.tier ?? current?.usage?.plan;
  const unverified = current?.me?.email_verified === false;
  const sendVerification = async () => {
    setNotice("");
    try {
      const result = await apiRequest<{ verified?: boolean; sent?: boolean }>("/me/email/verify", {
        method: "POST",
      });
      setNotice(
        result.verified
          ? "Your email is already confirmed."
          : "Sent. Open the link in your inbox to start using AI.",
      );
    } catch (error) {
      setNotice(
        error instanceof ApiRequestError
          ? error.message
          : "The link could not be sent. Try again shortly.",
      );
    }
  };
  const referrals = current?.referral?.referrals;
  return (
    <>
      <SettingsSectionBlock title="Plan">
        <SettingsRow
          label="Current plan"
          description="Every plan has every feature. Higher plans add more AI, smarter models and more storage."
        >
          <span className="flex items-center gap-3">
            {plan ? (
              <span className="text-[15px] text-cream">{planNames[plan] ?? plan}</span>
            ) : (
              <Skeleton className="h-4 w-12" />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openAccountSettingsInBrowser("/settings/billing")}
            >
              Manage plan
            </Button>
          </span>
        </SettingsRow>
        {unverified && (
          <SettingsRow
            label="Confirm your email"
            description="AI starts once your email is confirmed. This keeps the free plan generous for real people."
          >
            <Button variant="outline" size="sm" onClick={() => void sendVerification()}>
              Send link again
            </Button>
          </SettingsRow>
        )}
        {notice && <SettingsNote>{notice}</SettingsNote>}
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="AI usage"
        description="Work is measured by what it costs to run, so faster models stretch further. A task already running may finish a little past a limit."
      >
        {current?.failed && !ai ? (
          <SettingsNote>
            Usage is unavailable right now. AI requests still check your limits before they run.
          </SettingsNote>
        ) : (
          <>
            <LimitRow
              label="This session"
              limit={limits?.window}
              idle="A session starts with your next AI request."
              description="A 5-hour window that starts with your first request."
            />
            <LimitRow
              label="This week"
              limit={limits?.weekly}
              idle=""
              description="Refills every Monday."
            />
            <LimitRow
              label="This month"
              limit={limits?.monthly}
              idle=""
              description="A ceiling over any 31 days; steady weekly use never reaches it."
            />
          </>
        )}
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="Invite friends"
        description="Each friend who subscribes adds AI to your plan every month, for as long as they stay. They get the same bonus for their first two months."
      >
        <SettingsRow
          label="Your invite link"
          description="Share it anywhere. It works for new accounts only."
        >
          {current?.referral ? (
            <CopyableValueText value={current.referral.link} />
          ) : (
            <Skeleton className="h-4 w-[240px]" />
          )}
        </SettingsRow>
        <SettingsRow
          label="Friends who subscribed"
          description="A friend counts two weeks after their first payment, while they stay subscribed."
        >
          {referrals ? (
            <span className="text-[15px] tabular-nums text-cream">
              {`${referrals.active} active${referrals.pending ? ` · ${referrals.pending} pending` : ""}`}
            </span>
          ) : (
            <Skeleton className="h-4 w-16" />
          )}
        </SettingsRow>
        {referrals && referrals.bonus_units > 0 && limits?.monthly && (
          <SettingsRow
            label="Your bonus"
            description="Extra AI each month from friends who subscribed."
          >
            <span className="text-[15px] tabular-nums text-cream">
              +
              {Math.round(
                (referrals.bonus_units /
                  Math.max(1, limits.monthly.limit - referrals.bonus_units)) *
                  100,
              )}
              % AI
            </span>
          </SettingsRow>
        )}
      </SettingsSectionBlock>
    </>
  );
}
