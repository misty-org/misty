import { HardDrive } from "lucide-react";
import { Progress, Separator } from "@/ui";
import type { SpaceStorageUsage } from "@/models/interfaces/features/spaces/types";

/**
 * Storage usage, pinned to the bottom of the Space panel.
 *
 * This used to render only inside the Library section, so every other tab left
 * the lower half of the panel empty and unanchored. Keeping it mounted for all
 * sections gives the flex column a stable bottom edge as well as showing quota
 * where people actually look for it.
 */
export function SpaceStorageFooter({
  usage,
  showsOwnerStorage,
}: {
  usage: SpaceStorageUsage | null;
  showsOwnerStorage: boolean;
}) {
  const usedBytes = usage?.used_bytes;
  const limitBytes = usage?.limit_bytes;
  const showsBar =
    showsOwnerStorage && usedBytes !== undefined && limitBytes !== undefined && limitBytes > 0;

  const percent =
    usedBytes !== undefined && limitBytes !== undefined && limitBytes > 0
      ? (usedBytes / limitBytes) * 100
      : 0;
  const barValue = usedBytes && usedBytes > 0 ? Math.max(1, Math.min(100, percent)) : 0;

  return (
    <div className="mt-auto shrink-0 pt-3">
      <Separator className="mb-3 bg-sidebar-border" />
      <section className="rounded-md bg-sidebar-accent/35 p-3" aria-label="Space storage quota">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
            <HardDrive size={14} />
          </span>
          <span className="min-w-0">
            <strong className="block text-sm font-medium text-sidebar-accent-foreground">
              Storage
            </strong>
            <span className="block text-xs text-muted-foreground">
              {storageSummary(usage, showsOwnerStorage)}
            </span>
          </span>
        </div>
        {showsBar && usedBytes !== undefined && limitBytes !== undefined ? (
          <>
            <Progress className="mt-3 h-1.5 transition-all duration-300" value={barValue} />
            <p className="mb-0 mt-2 text-[11px] text-muted-foreground">
              {formatStorageBytes(usedBytes)} of {formatStorageBytes(limitBytes)} used
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}

function storageSummary(usage: SpaceStorageUsage | null, showsOwnerStorage: boolean) {
  if (!usage) return "Checking...";
  if (usage.used_bytes !== undefined) {
    const spaceUsed = formatStorageBytes(usage.used_bytes);
    if (showsOwnerStorage && usage.remaining_bytes !== undefined) {
      return `${spaceUsed} in space · ${formatStorageBytes(usage.remaining_bytes)} pool left`;
    }
    return `${spaceUsed} used in this Space`;
  }
  if (showsOwnerStorage && usage.remaining_bytes !== undefined) {
    return `${formatStorageBytes(usage.remaining_bytes, usage.limit_bytes)} left across your Spaces`;
  }
  return usage.storage_available ? "Uploads available" : "New uploads paused";
}

export function formatStorageBytes(bytes: number, unitScaleBytes = bytes): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(1, unitScaleBytes)) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  if (index === 0) return `${Math.round(value)} B`;
  const formatted = value
    .toFixed(value < 10 ? 2 : 1)
    .replace(/\.00$/, "")
    .replace(/(\.[1-9])0$/, "$1");
  return `${formatted} ${units[index]}`;
}
