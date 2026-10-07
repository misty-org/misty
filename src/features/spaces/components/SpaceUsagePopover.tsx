import type { Space } from "@/api/spaces/dto/interfaces/types";
import { apiRequest, readApiSessionGeneration } from "@/api/client";
import {
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Skeleton,
} from "@/shared/ui";
import { Gauge } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { formatStorageBytes } from "./spacePanel/storageFormat";

type Meter = {
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
  percentage_used: number;
  reset_at?: string;
};
type AccountUsage = {
  account?: {
    ai?: Meter & {
      recent_commands?: Array<{
        id: string;
        started_at: string;
        used: number;
        reserved: number;
        maximum: number;
      }>;
    };
    sync?: Meter;
    cloud_storage?: {
      used_bytes: number;
      reserved_bytes: number;
      limit_bytes: number;
      remaining_bytes: number;
      percentage_used: number;
    };
  };
};

/** The navigation entry shows one account's allowances across every Space. */
export function SpaceUsagePopover({
  trigger,
  side,
}: {
  space: Space;
  trigger?: ReactElement;
  side?: "bottom" | "right";
}) {
  const [open, setOpen] = useState(false);
  const generation = readApiSessionGeneration();
  const [result, setResult] = useState<{
    generation: number;
    value?: AccountUsage;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!open) return;
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
  }, [open, generation]);
  const current = result?.generation === generation ? result : undefined;
  const account = current?.value?.account;
  const storage = account?.cloud_storage;
  const meters: Array<{ label: string; meter?: Meter; format: (value: number) => string }> = [
    {
      label: "AI",
      meter: account?.ai,
      format: (value) => `${value.toLocaleString()} weighted tokens`,
    },
    {
      label: "Cloud storage",
      meter: storage
        ? {
            used: storage.used_bytes,
            reserved: storage.reserved_bytes,
            limit: storage.limit_bytes,
            remaining: storage.remaining_bytes,
            percentage_used: storage.percentage_used,
          }
        : undefined,
      format: formatStorageBytes,
    },
    { label: "Sync transfer", meter: account?.sync, format: formatStorageBytes },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <IconButton
            label="Account usage"
            className={cn(open && "text-cream-bright")}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <Gauge size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={8}
        collisionPadding={16}
        className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-4"
      >
        <p className="mb-4 text-sm font-medium">Account usage</p>
        <p className="mb-4 text-xs text-cream-muted">Shared across your Spaces and devices.</p>
        {current?.failed ? (
          <p role="status" className="text-sm text-cream-muted">
            Usage could not load. Close and reopen to retry.
          </p>
        ) : (
          <div className="space-y-5">
            {meters.map(({ label, meter, format }) => (
              <div key={label}>
                <p className="mb-1 text-sm font-medium">{label}</p>
                {meter && meter.limit > 0 ? (
                  <>
                    <p className="mb-2 text-xs tabular-nums text-cream-muted">
                      {format(meter.used)} of {format(meter.limit)}
                    </p>
                    <Progress
                      aria-label={`${label} usage`}
                      value={Math.min(100, meter.percentage_used)}
                      className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
                    />
                    {meter.reserved > 0 && (
                      <p className="mt-1 text-xs text-cream-muted">
                        {format(meter.reserved)} temporarily reserved
                      </p>
                    )}
                    {meter.reset_at && (
                      <p className="mt-1 text-xs text-cream-muted">
                        Resets {new Date(meter.reset_at).toLocaleDateString()}
                      </p>
                    )}
                  </>
                ) : current?.value ? (
                  <p className="text-xs text-cream-muted">Usage unavailable</p>
                ) : (
                  <Skeleton
                    aria-label={`Loading ${label.toLowerCase()} usage`}
                    className="h-1.5 w-full rounded-full"
                  />
                )}
              </div>
            ))}
            {!!account?.ai?.recent_commands?.length && (
              <details className="text-xs text-cream-muted">
                <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-cream-muted">
                  Recent AI commands
                </summary>
                <ul className="mt-3 space-y-3">
                  {account.ai.recent_commands.map((command) => (
                    <li key={command.id}>
                      <time dateTime={command.started_at}>
                        {new Date(command.started_at).toLocaleString()}
                      </time>
                      <p className="tabular-nums">
                        {command.used.toLocaleString()} weighted tokens used
                      </p>
                      {command.reserved > 0 && <p>{command.reserved.toLocaleString()} reserved</p>}
                      <p>Ceiling: {command.maximum.toLocaleString()} weighted tokens</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
