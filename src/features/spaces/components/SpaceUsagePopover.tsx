import { useAuth } from "@/features/auth";
import {
  personalAgentUsage,
  quotaPercentUsed,
  type AgentUsage,
  type AiQuotaUsage,
} from "@/api/spaces/dto/interfaces/agentUsageTypes";
import type { Space, StorageQuotaDimension } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Skeleton,
  cn,
} from "@/shared/ui";
import { Gauge } from "lucide-react";
import { useState, type ReactElement } from "react";
import { formatStorageBytes } from "./spacePanel/storageFormat";
import { useBillingUsage } from "./spacePanel/useAgentUsage";
import { useSpaceLibraryUsage } from "./spacePanel/useSpaceLibraryUsage";

/**
 * Both quotas, behind one gauge in the Space header.
 *
 * They used to sit permanently at the bottom of the panel, where two progress
 * bars competed with the navigation for attention every second of the day.
 * Quotas are something you check, not something you watch, so they load only
 * once this opens.
 */
export function SpaceUsagePopover({ space, trigger }: { space: Space; trigger?: ReactElement }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const storage = useSpaceLibraryUsage({
    activeSpaceId: space.id,
    activeSpace: space,
    snapshotReady: true,
    enabled: open,
  });
  const billing = useBillingUsage(open);
  const personalAi = personalAgentUsage(billing);
  const spaceAi = billing?.spaces?.find((item) => item.space_id === space.id)?.ai;
  const ownsSpace = space.owner_user_id === user?.id;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            className={cn(
              "relative grid size-8 place-items-center rounded-md p-0 text-cream-muted shadow-none",
              "hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-charcoal-active",
              open && "text-cream-bright",
            )}
            variant="ghost"
            size="icon"
            type="button"
            title="Usage"
            aria-label="Usage"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <Gauge size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent sideOffset={8} className="w-80 overflow-hidden border-charcoal-border/70 p-0">
        <div className="border-b border-charcoal-border/60 px-2 py-2.5">
          <p className="m-0 truncate text-sm font-semibold">Usage</p>
          <p className="mb-0 mt-0.5 text-[11px] text-cream-muted">
            Both limits must have room for new contributions
          </p>
        </div>

        <div className="grid gap-4 px-2 py-3">
          <UsageGroup
            title="Your personal allowance"
            description="Shared across every Space you use"
          >
            <AiUsageBlock label="Personal AI" usage={personalAi} />
            <StorageBlock label="Personal storage" usage={storage?.personal} />
          </UsageGroup>
          <UsageGroup
            title="This Space’s capacity"
            description={
              ownsSpace
                ? "Provided by your plan as this Space’s owner"
                : "Provided by the Space owner’s plan"
            }
          >
            <AiUsageBlock label="Space AI" usage={spaceAi} />
            <StorageBlock label="Space storage" usage={storage?.space} />
          </UsageGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UsageGroup(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5" aria-label={props.title}>
      <div>
        <strong className="text-[12px] font-semibold">{props.title}</strong>
        <p className="m-0 text-[10px] text-cream-muted">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

function AiUsageBlock({
  label,
  usage,
}: {
  label: string;
  usage: AgentUsage | AiQuotaUsage | null | undefined;
}) {
  const percentUsed = Math.round(quotaPercentUsed(usage ?? undefined));

  return (
    <div aria-label={`${label} usage`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium">{label}</span>
        {usage ? (
          <span className="text-[11px] tabular-nums text-cream-muted">{percentUsed}%</span>
        ) : null}
      </div>
      {usage ? (
        <>
          <Progress className="mt-1.5 h-1" value={percentUsed > 0 ? Math.max(1, percentUsed) : 0} />
          <p className="mb-0 mt-1 text-[10px] text-cream-muted">{aiSummary(usage)}</p>
        </>
      ) : (
        <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
      )}
    </div>
  );
}

function StorageBlock({
  label,
  usage,
}: {
  label: string;
  usage: StorageQuotaDimension | undefined;
}) {
  const usedBytes = usage?.used_bytes;
  const limitBytes = usage?.limit_bytes;
  const percent =
    usedBytes !== undefined && limitBytes !== undefined && limitBytes > 0
      ? (usedBytes / limitBytes) * 100
      : 0;

  return (
    <div aria-label={`${label} usage`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium">{label}</span>
        {usage?.used_bytes !== undefined ? (
          <span className="text-[11px] tabular-nums text-cream-muted">
            {formatStorageBytes(usage.used_bytes)}
          </span>
        ) : null}
      </div>
      {!usage ? (
        <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
      ) : limitBytes !== undefined ? (
        <>
          <Progress
            className="mt-1.5 h-1"
            value={percent > 0 ? Math.max(1, Math.min(100, percent)) : 0}
          />
          <p className="mb-0 mt-1 text-[10px] text-cream-muted">
            {formatStorageBytes(usedBytes ?? 0)} of {formatStorageBytes(limitBytes)} used
          </p>
        </>
      ) : (
        <p className="mb-0 mt-1 text-[10px] text-cream-muted">Usage unavailable</p>
      )}
    </div>
  );
}

function aiSummary(usage: AgentUsage | AiQuotaUsage) {
  const reset = formatResetAt(usage.reset_at);
  if (usage.paused)
    return reset ? `Weekly limit reached · renews ${reset}` : "Weekly limit reached";
  return reset ? `Renews ${reset}` : "Used this week";
}

/** Renders the reset instant as a weekday, or "today" when it lands today. */
function formatResetAt(resetAt: string | undefined) {
  if (!resetAt) return "";
  const reset = new Date(resetAt);
  if (Number.isNaN(reset.getTime())) return "";
  if (reset.toDateString() === new Date().toDateString()) return "today";
  return reset.toLocaleDateString(undefined, { weekday: "long" });
}
