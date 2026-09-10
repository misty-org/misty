import { apiRequest, readApiSessionGeneration } from "@/api/client";
import { Progress, Skeleton } from "@/shared/ui";
import { useEffect, useState } from "react";
import { formatStorageBytes } from "./spacePanel/storageFormat";

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

/** One account's AI and storage allowances across every Space; loads when it mounts. */
export function AccountUsagePanel() {
  const generation = readApiSessionGeneration();
  const [result, setResult] = useState<{
    generation: number;
    value?: AccountUsage;
    failed?: boolean;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      void apiRequest<AccountUsage>("/billing/usage", {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((value) => {
          if (!controller.signal.aborted && generation === readApiSessionGeneration())
            setResult({ generation, value });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ generation, failed: true });
        });
    refresh();
    window.addEventListener("misty:space-library-event", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("misty:space-library-event", refresh);
    };
  }, [generation]);
  const current = result?.generation === generation ? result : undefined;
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
export function UsageMeters({
  account,
  loaded,
}: {
  account: AccountUsage["account"];
  loaded: boolean;
}) {
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
          <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium">{label}</span>
            {meter && meter.limit > 0 ? (
              <span className="tabular-nums">
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
