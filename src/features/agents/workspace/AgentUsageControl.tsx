import { useEffect, useState } from "react";
import { apiRequest, readApiSessionGeneration } from "@/api/client";
import type { AiLimit } from "@/api/spaces/dto/agentUsageTypes";
import {
  CommandEstimateDetails,
  formatUsagePercent,
  useCommandUsageEstimate,
} from "@/features/global-search/CommandUsageEstimate";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Skeleton,
} from "@/shared/ui";

type AiMeter = {
  used: number;
  reserved: number;
  limit: number;
  percentage_used: number;
  reset_at?: string;
  limits?: { window?: AiLimit; weekly?: AiLimit; monthly?: AiLimit };
};

const limitLabels = [
  ["window", "This session"],
  ["weekly", "This week"],
  ["monthly", "This month"],
] as const;

function resetLabel(limit: AiLimit): string {
  if (!limit.resets_at) return "Starts with your next request";
  const reset = new Date(limit.resets_at);
  const time = reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return reset.toDateString() === new Date().toDateString()
    ? `Refills at ${time}`
    : `Refills ${reset.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;
}

function openUsageSettings() {
  window.dispatchEvent(
    new CustomEvent("misty:open-settings", { detail: { section: "agents-usage" } }),
  );
}

/**
 * The composer's usage ring: the account's weekly AI meter, plus billing's estimate for
 * the current draft. Numbers live in the popover so the composer stays quiet.
 */
export function AgentUsageControl({
  draft,
  model,
  working,
}: {
  draft: string;
  model?: string;
  working: boolean;
}) {
  const generation = readApiSessionGeneration();
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<{ generation: number; meter?: AiMeter; failed?: boolean }>();
  const estimate = useCommandUsageEstimate(working ? "" : draft, model);
  // Refresh when work settles and whenever the details open.
  useEffect(() => {
    if (working) return;
    const controller = new AbortController();
    void apiRequest<{ account?: { ai?: AiMeter } }>("/billing/usage", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((value) => {
        if (!controller.signal.aborted && generation === readApiSessionGeneration())
          setUsage({ generation, meter: value.account?.ai });
      })
      .catch(() => {
        if (!controller.signal.aborted) setUsage({ generation, failed: true });
      });
    return () => controller.abort();
  }, [working, open, generation]);
  const current = usage?.generation === generation ? usage : undefined;
  const meter = current?.meter && current.meter.limit > 0 ? current.meter : undefined;
  const limits = meter?.limits;
  // The ring shows the tightest limit: the one closest to stopping work.
  const used = meter
    ? Math.min(
        100,
        Math.max(
          0,
          meter.percentage_used,
          limits?.window?.percentage_used ?? 0,
          limits?.monthly?.percentage_used ?? 0,
        ),
      )
    : 0;
  const command = estimate.command;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          className="agent-usage-trigger"
          label={
            meter ? `AI usage: ${formatUsagePercent(used)}% of your tightest limit` : "AI usage"
          }
        >
          <UsageRing value={used} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="agent-usage-popover w-80 max-w-[calc(100vw-2rem)] p-4"
      >
        <section aria-label="AI usage">
          <p className="mb-2 text-sm font-medium">AI usage</p>
          {meter && limits ? (
            <div className="grid gap-3">
              {limitLabels.map(([key, label]) => {
                const limit = limits[key];
                if (!limit) return null;
                const value = Math.min(100, Math.max(0, limit.percentage_used));
                return (
                  <div key={key}>
                    <p className="mb-1 flex justify-between text-xs">
                      <span>{label}</span>
                      <span className="tabular-nums text-cream-muted">
                        {formatUsagePercent(value)}%
                      </span>
                    </p>
                    <Progress
                      aria-label={`${label} AI usage`}
                      value={value}
                      className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
                    />
                    <p className="mt-1 text-xs text-cream-muted">{resetLabel(limit)}</p>
                  </div>
                );
              })}
              {used >= 80 && (
                <Button
                  variant="link"
                  size="sm"
                  className="justify-self-start px-0"
                  onClick={() => {
                    setOpen(false);
                    openUsageSettings();
                  }}
                >
                  Invite friends to raise your limits
                </Button>
              )}
            </div>
          ) : meter ? (
            <>
              <p className="mb-2 text-xs tabular-nums text-cream-muted">
                {meter.used.toLocaleString()} of {meter.limit.toLocaleString()} weighted tokens this
                week
              </p>
              <Progress
                aria-label="Weekly AI usage"
                value={used}
                className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
              />
              {meter.reset_at && (
                <p className="mt-1 text-xs text-cream-muted">
                  Resets {new Date(meter.reset_at).toLocaleDateString()}
                </p>
              )}
            </>
          ) : current ? (
            <p role="status" className="text-xs text-cream-muted">
              Usage unavailable.
            </p>
          ) : (
            <div role="status" aria-label="Usage" aria-busy="true" className="grid gap-2">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          )}
        </section>
        <section aria-label="This message" className="mt-4 border-t border-charcoal-border pt-4">
          <p className="mb-1 text-sm font-medium">This message</p>
          <div className="text-xs text-cream-muted">
            {working ? (
              <p>Estimates return when the current task finishes.</p>
            ) : !estimate.drafting ? (
              <p>Type a message to estimate its usage.</p>
            ) : command ? (
              <>
                <p className="mb-2 tabular-nums text-cream">
                  ≈{formatUsagePercent(command.estimated_percentage)}% of weekly AI · ceiling{" "}
                  {formatUsagePercent(command.maximum_percentage)}%
                </p>
                <CommandEstimateDetails command={command} allowed={estimate.allowed} />
              </>
            ) : (
              <p role="status">
                {estimate.settled
                  ? "Estimate unavailable. Billing checks your budget before running."
                  : "Estimating…"}
              </p>
            )}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}

/** An 18px ring: the track in the border tone, the used share in text color. */
function UsageRing({ value }: { value: number }) {
  const radius = 7;
  const length = 2 * Math.PI * radius;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="agent-usage-ring">
      <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="2.25" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * length} ${length}`}
        transform="rotate(-90 9 9)"
        opacity={value > 0 ? 1 : 0}
      />
    </svg>
  );
}
