import { HardDrive } from "lucide-react";
import { Progress, Skeleton } from "@/ui";
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
  const isLoading = !usage;
  const showsBar =
    showsOwnerStorage &&
    (isLoading ||
      (usedBytes !== undefined && usedBytes > 0 && limitBytes !== undefined && limitBytes > 0));

  const percent =
    usedBytes !== undefined && limitBytes !== undefined && limitBytes > 0
      ? (usedBytes / limitBytes) * 100
      : 0;
  const barValue = usedBytes && usedBytes > 0 ? Math.max(1, Math.min(100, percent)) : 0;

  return (
    <div className="mt-auto shrink-0">
      <section
        className="border-t border-sidebar-border/55 px-1 py-3"
        aria-label="Space storage quota"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
            <HardDrive size={13} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-[11px] font-semibold text-sidebar-accent-foreground">
              Storage
            </strong>
            <span className="block truncate text-[9.5px] text-muted-foreground">
              {storageSummary(usage, showsOwnerStorage)}
            </span>
          </span>
        </div>
        {showsBar ? (
          isLoading ? (
            <>
              <Skeleton className="mt-2 h-1 w-full rounded-full" />
              <Skeleton className="mt-1 h-2.5 w-20 rounded-md" />
            </>
          ) : usedBytes !== undefined && limitBytes !== undefined ? (
            <>
              <Progress className="mt-2 h-1 transition-all duration-300" value={barValue} />
              <p className="mb-0 mt-1 text-[9.5px] text-muted-foreground">
                {formatStorageBytes(usedBytes)} of {formatStorageBytes(limitBytes)} used
              </p>
            </>
          ) : null
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
