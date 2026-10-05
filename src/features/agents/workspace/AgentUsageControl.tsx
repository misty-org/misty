import { useEffect, useState } from "react";
import { apiRequest, readApiSessionGeneration } from "@/api/client";
import {
  CommandEstimateDetails,
  formatUsagePercent,
  useCommandUsageEstimate,
} from "@/features/global-search/CommandUsageEstimate";
import {
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
};

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
  const used = meter ? Math.min(100, Math.max(0, meter.percentage_used)) : 0;
  const command = estimate.command;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          className="agent-usage-trigger"
          label={meter ? `AI usage: ${formatUsagePercent(used)}% of weekly limit` : "AI usage"}
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
        <section aria-label="Weekly AI usage">
          <p className="mb-1 text-sm font-medium">Weekly AI usage</p>
          {meter ? (
            <>
              <p className="mb-2 text-xs tabular-nums text-cream-muted">
                {meter.used.toLocaleString()} of {meter.limit.toLocaleString()} weighted tokens
              </p>
              <Progress
                aria-label="Weekly AI usage"
                value={used}
                className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
              />
              {meter.reserved > 0 && (
                <p className="mt-1 text-xs text-cream-muted">
                  {meter.reserved.toLocaleString()} temporarily reserved
                </p>
              )}
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
