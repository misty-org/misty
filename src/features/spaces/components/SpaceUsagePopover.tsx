import { useAuth } from "@/features/auth";
import type { AgentUsage } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import type { Space, SpaceStorageUsage } from "@/api/spaces/dto/interfaces/types";
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
import { useState } from "react";
import { formatStorageBytes } from "./spacePanel/storageFormat";
import { useAgentUsage } from "./spacePanel/useAgentUsage";
import { useSpaceLibraryUsage } from "./spacePanel/useSpaceLibraryUsage";

/**
 * Both quotas, behind one gauge in the Space header.
 *
 * They used to sit permanently at the bottom of the panel, where two progress
 * bars competed with the navigation for attention every second of the day.
 * Quotas are something you check, not something you watch, so they load only
 * once this opens.
 */
export function SpaceUsagePopover({ space }: { space: Space }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const storage = useSpaceLibraryUsage({
    activeSpaceId: space.id,
    activeSpace: space,
    snapshotReady: true,
    enabled: open,
  });
  const agent = useAgentUsage(open);
  const showsPool = space.owner_user_id === user?.id;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>

      <PopoverContent sideOffset={8} className="w-72 overflow-hidden border-charcoal-border/70 p-0">
        <div className="border-b border-charcoal-border/60 px-2 py-2.5">
          <p className="m-0 truncate text-sm font-semibold">Usage</p>
          <p className="mb-0 mt-0.5 text-[11px] text-cream-muted">
            Your weekly AI allowance and storage pool
          </p>
        </div>

        <div className="grid gap-3.5 px-2 py-3">
          <AiUsageBlock usage={agent} />
          <StorageBlock usage={storage} showsPool={showsPool} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AiUsageBlock({ usage }: { usage: AgentUsage | null }) {
  const percentUsed = usage ? Math.max(0, Math.min(100, Math.round(usage.percentage_used))) : 0;

  return (
    <section aria-label="Weekly AI usage">
      <div className="flex items-baseline justify-between gap-2">
        <strong className="text-[12px] font-semibold">AI usage</strong>
        {usage ? (
          <span className="text-[11px] tabular-nums text-cream-muted">{percentUsed}%</span>
        ) : null}
      </div>
      {usage ? (
        <>
          <Progress className="mt-1.5 h-1" value={percentUsed > 0 ? Math.max(1, percentUsed) : 0} />
          <p className="mb-0 mt-1 text-[11px] text-cream-muted">{aiSummary(usage)}</p>
        </>
      ) : (
        <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
      )}
    </section>
  );
}

function StorageBlock({
  usage,
  showsPool,
}: {
  usage: SpaceStorageUsage | null;
  showsPool: boolean;
}) {
  const usedBytes = usage?.used_bytes;
  const limitBytes = usage?.limit_bytes;
  const percent =
    usedBytes !== undefined && limitBytes !== undefined && limitBytes > 0
      ? (usedBytes / limitBytes) * 100
      : 0;

  return (
    <section aria-label="Space storage quota">
      <div className="flex items-baseline justify-between gap-2">
        <strong className="text-[12px] font-semibold">Storage</strong>
        {usage?.used_bytes !== undefined ? (
          <span className="text-[11px] tabular-nums text-cream-muted">
            {formatStorageBytes(usage.used_bytes)} in this Space
          </span>
        ) : null}
      </div>
      {!usage ? (
        <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
      ) : showsPool && limitBytes !== undefined ? (
        <>
          <Progress
            className="mt-1.5 h-1"
            value={percent > 0 ? Math.max(1, Math.min(100, percent)) : 0}
          />
          <p className="mb-0 mt-1 text-[11px] text-cream-muted">
            {formatStorageBytes(usedBytes ?? 0)} of {formatStorageBytes(limitBytes)} pool used
          </p>
        </>
      ) : (
        <p className="mb-0 mt-1 text-[11px] text-cream-muted">
          {usage.storage_available ? "Uploads available" : "New uploads paused"}
        </p>
      )}
    </section>
  );
}

function aiSummary(usage: AgentUsage) {
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
