import type { Space } from "@/api/spaces/dto/interfaces/types";
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
import { useState, type ReactElement } from "react";
import { formatStorageBytes } from "./spacePanel/storageFormat";
import { useSpaceLibraryUsage } from "./spacePanel/useSpaceLibraryUsage";

/** Storage quotas load only when the Space usage popover opens. */
export function SpaceUsagePopover({
  space,
  trigger,
  side,
}: {
  space: Space;
  trigger?: ReactElement;
  side?: "bottom" | "right";
}) {
  const [open, setOpen] = useState(false);
  const storage = useSpaceLibraryUsage({
    activeSpaceId: space.id,
    activeSpace: space,
    snapshotReady: true,
    enabled: open,
  });
  const usage = storage?.space;
  const used = usage?.used_bytes ?? 0;
  const limit = usage?.limit_bytes;
  // Older servers can return a placeholder instead of an actual storage cap.
  const hasLimit =
    limit !== undefined && Number.isFinite(limit) && limit >= 0 && limit < Number.MAX_SAFE_INTEGER;
  const percent = hasLimit
    ? limit > 0
      ? Math.min(100, (used / limit) * 100)
      : used > 0
        ? 100
        : 0
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <IconButton
            label="Usage"
            className={cn(open && "text-cream-bright")}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <Gauge size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}
      </PopoverTrigger>

      <PopoverContent side={side} sideOffset={8} className="w-80 p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">Storage</span>
          {usage && (
            <span className="tabular-nums text-cream-muted">
              {formatStorageBytes(used)}
              {hasLimit ? ` / ${formatStorageBytes(limit)}` : " / —"}
            </span>
          )}
        </div>
        {usage ? (
          <Progress
            aria-label="Storage usage"
            aria-valuetext={
              !hasLimit ? `${formatStorageBytes(used)} used, storage limit unavailable` : undefined
            }
            value={percent}
            className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
          />
        ) : (
          <Skeleton aria-label="Loading storage usage" className="h-1.5 w-full rounded-full" />
        )}
      </PopoverContent>
    </Popover>
  );
}
