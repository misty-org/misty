import { cachedRequest } from "@/api/cache/cached-request";
import { readApiSessionGeneration } from "@/api/client";
import { Progress, Skeleton } from "@/shared/ui";
import { useEffect, useState } from "react";
import { formatStorageBytes } from "./storageFormat";

type Meter = {
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
  percentage_used: number;
  reset_at?: string;
};
export type AccountUsage = {
  account?: {
    ai?: Meter;
    cloud_storage?: {
      used_bytes: number;
      reserved_bytes: number;
      limit_bytes: number;
      remaining_bytes: number;
      percentage_used: number;
    };
  };
};

/** How long a loaded reading stays current before opening the panel refreshes it. */
const usageTtlMs = 60_000;

type UsageCache = { generation: number; value?: AccountUsage; at: number; failed?: boolean };
let cache: UsageCache | undefined;
let inflight: { generation: number; promise: Promise<void> } | undefined;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((listener) => listener());

/**
 * Loads the allowances unless a recent reading exists. Every panel shares one reading, so
 * reopening a menu paints instantly and fetches only once the reading is old or a Space's
 * library changed. A refresh keeps the last values on screen until the new ones arrive.
 */
function loadUsage(force = false): void {
  const generation = readApiSessionGeneration();
  const fresh =
    cache?.generation === generation && !cache.failed && Date.now() - cache.at < usageTtlMs;
  if (!force && fresh) return;
  if (inflight?.generation === generation) return;
  const promise = cachedRequest<AccountUsage>("/billing/usage")
    .then((value) => {
      if (generation === readApiSessionGeneration()) cache = { generation, value, at: Date.now() };
    })
    .catch(() => {
      if (generation !== readApiSessionGeneration()) return;
      // A failed refresh keeps the last good reading rather than replacing it with an error.
      if (cache?.generation === generation && cache.value) cache = { ...cache, at: 0 };
      else cache = { generation, at: Date.now(), failed: true };
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = undefined;
      notify();
    });
  inflight = { generation, promise };
}

/** One account's AI and storage allowances across every Space; shared and cached. */
export function AccountUsagePanel() {
  const generation = readApiSessionGeneration();
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((count) => count + 1);
    subscribers.add(update);
    const refresh = () => loadUsage(true);
    loadUsage();
    window.addEventListener("misty:space-library-event", refresh);
    return () => {
      subscribers.delete(update);
      window.removeEventListener("misty:space-library-event", refresh);
    };
  }, [generation]);
  const current = cache?.generation === generation ? cache : undefined;
  if (current?.failed)
    return (
      <p role="status" className="text-sm text-cream-muted">
        Usage could not load. Close and reopen to retry.
      </p>
    );
  return <UsageMeters account={current?.value?.account} loaded={Boolean(current?.value)} />;
}

function percent(value: number): string {
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(Math.min(100, value))}%`;
}

/** AI and storage in the plan-limits style: label, detail and percent over one bar. */
function UsageMeters({ account, loaded }: { account: AccountUsage["account"]; loaded: boolean }) {
  const storage = account?.cloud_storage;
  const meters: Array<{ label: string; meter?: Meter; detail: (meter: Meter) => string }> = [
    {
      label: "AI",
      meter: account?.ai,
      detail: (meter) =>
        meter.reset_at
          ? `Resets ${new Date(meter.reset_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          : "",
    },
    {
      label: "Cloud storage",
      meter: storage && {
        used: storage.used_bytes,
        reserved: storage.reserved_bytes,
        limit: storage.limit_bytes,
        remaining: storage.remaining_bytes,
        percentage_used: storage.percentage_used,
      },
      detail: (meter) => `${formatStorageBytes(meter.used)} of ${formatStorageBytes(meter.limit)}`,
    },
  ];
  return (
    <div className="divide-y divide-cream/10">
      {meters.map(({ label, meter, detail }) => (
        <div key={label} className="py-3 first:pt-0 last:pb-0">
          <div className="mb-2 flex flex-nowrap items-baseline justify-between gap-4 whitespace-nowrap text-sm">
            <span className="shrink-0 font-medium">{label}</span>
            {meter && meter.limit > 0 ? (
              <span className="shrink-0 tabular-nums">
                <span className="mr-2 text-cream-muted">{detail(meter)}</span>
                {percent(meter.percentage_used)}
              </span>
            ) : loaded ? (
              <span className="text-cream-muted">Unavailable</span>
            ) : null}
          </div>
          {meter && meter.limit > 0 ? (
            <Progress
              aria-label={`${label} usage`}
              value={Math.min(100, meter.percentage_used)}
              className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
            />
          ) : (
            <Skeleton aria-label={label} className="h-1.5 w-full rounded-full" />
          )}
        </div>
      ))}
    </div>
  );
}
