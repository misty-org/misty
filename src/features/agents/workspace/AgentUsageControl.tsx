import { cachedRequest } from "@/api/cache/cachedRequest";
import { useEffect, useState } from "react";
import { readApiSessionGeneration } from "@/api/client";
import type { AiLimit } from "@/api/spaces/dto/agentUsageTypes";
import { formatUsagePercent } from "@/features/global-search/CommandUsageEstimate";
import { Settings } from "lucide-react";
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
  limits?: { window?: AiLimit; weekly?: AiLimit; monthly?: AiLimit };
};

const limitLabels = [
  ["window", "Session limit"],
  ["weekly", "Weekly"],
] as const;

/** How long until a limit refills, in the units that matter at that distance. */
function resetLabel(limit: AiLimit): string {
  if (!limit.resets_at) return "Starts with your next request";
  const minutes = Math.max(
    0,
    Math.round((new Date(limit.resets_at).getTime() - Date.now()) / 60_000),
  );
  if (minutes < 1) return "Resets in under a minute";
  if (minutes < 60) return `Resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Resets in ${hours} hr ${minutes % 60} min`;
  return `Resets in ${Math.floor(hours / 24)} d ${hours % 24} hr`;
}

function openUsageSettings() {
  window.dispatchEvent(
    new CustomEvent("misty:open-settings", { detail: { section: "agents-usage" } }),
  );
}

/**
 * The composer's usage ring: the account's session and weekly AI limits, with how long until
 * each refills. Numbers live in the popover so the composer stays quiet.
 */
export function AgentUsageControl({ working }: { working: boolean }) {
  const generation = readApiSessionGeneration();
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<{ generation: number; meter?: AiMeter; failed?: boolean }>();
  // Refresh when work settles and whenever the details open.
  useEffect(() => {
    if (working) return;
    const controller = new AbortController();
    const show = (value: { account?: { ai?: AiMeter } }) => {
      if (!controller.signal.aborted && generation === readApiSessionGeneration())
        setUsage({ generation, meter: value.account?.ai });
    };
    // The last reading paints at once; the fresh one follows.
    void cachedRequest<{ account?: { ai?: AiMeter } }>("/billing/usage", {
      onCached: show,
      init: { signal: controller.signal },
    })
      .then(show)
      .catch(() => {
        if (!controller.signal.aborted) setUsage({ generation, failed: true });
      });
    return () => controller.abort();
  }, [working, open, generation]);
  const current = usage?.generation === generation ? usage : undefined;
  const meter = current?.meter && current.meter.limit > 0 ? current.meter : undefined;
  const limits = meter?.limits;
  // The ring shows the tightest limit it lists: the one closest to stopping work.
  const used = meter
    ? Math.min(
        100,
        Math.max(
          0,
          limits?.weekly?.percentage_used ?? meter.percentage_used,
          limits?.window?.percentage_used ?? 0,
        ),
      )
    : 0;
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
        className="agent-usage-popover w-[360px] max-w-[calc(100vw-2rem)] p-3"
      >
        <section aria-label="Usage">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-base font-medium">Usage</p>
            <IconButton
              label="Usage settings"
              size="xs"
              onClick={() => {
                setOpen(false);
                openUsageSettings();
              }}
            >
              <Settings className="size-3.5" />
            </IconButton>
          </div>
          {meter && limits ? (
            <div className="grid gap-3">
              {limitLabels.map(([key, label]) => {
                const limit = limits[key];
                if (!limit) return null;
                const value = Math.min(100, Math.max(0, limit.percentage_used));
                return (
                  <div key={key}>
                    <p className="mb-1.5 flex items-baseline justify-between text-[15px]">
                      <span className="font-medium">{label}</span>
                      <span className="tabular-nums text-cream-muted">
                        {formatUsagePercent(value)}% used
                      </span>
                    </p>
                    <Progress
                      aria-label={`${label} usage`}
                      value={value}
                      className="h-2 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/80"
                    />
                    <p className="mt-1.5 text-[13px] text-cream-muted">{resetLabel(limit)}</p>
                  </div>
                );
              })}
            </div>
          ) : meter ? (
            <>
              <p className="mb-1.5 flex items-baseline justify-between text-[15px]">
                <span className="font-medium">Weekly</span>
                <span className="tabular-nums text-cream-muted">
                  {formatUsagePercent(used)}% used
                </span>
              </p>
              <Progress
                aria-label="Weekly usage"
                value={used}
                className="h-2 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/80"
              />
              {meter.reset_at && (
                <p className="mt-1.5 text-[13px] text-cream-muted">
                  {resetLabel({ resets_at: meter.reset_at } as AiLimit)}
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
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          )}
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
