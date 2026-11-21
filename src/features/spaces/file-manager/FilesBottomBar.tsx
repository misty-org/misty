import { BottomBar, Button, Progress, Text } from "@misty/ui";
import type { FreeSpace, Progress as FilesProgress } from "@/features/files";
import { countText, formatBytes } from "./format";

/**
 * The bottom bar: how many items the folder holds (and how many are picked), how much room is left on
 * its disk, and the one operation running now, with its progress and Cancel.
 */
export function FilesBottomBar({
  count,
  selected,
  free,
  progress,
  onCancel,
}: {
  count: number | null;
  selected: number;
  free: FreeSpace | null;
  progress: FilesProgress | null;
  onCancel(): void;
}) {
  const share = progress && progress.totalBytes > 0 ? Math.min(100, (progress.doneBytes / progress.totalBytes) * 100) : 0;
  const summary = [
    count === null ? "" : selected > 0 ? `${selected} of ${countText(count)} picked` : countText(count),
    free ? `${formatBytes(free.free)} free` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <BottomBar
      aria-label="Folder"
      start={
        <Text size="meta" tone="muted">
          {summary}
        </Text>
      }
    >
      {progress ? (
        <>
          <Text size="meta" tone="muted">
            {progress.item ? `${progress.label} ${progress.item}` : progress.label}
          </Text>
          <Progress value={share} aria-label={progress.label} className="w-32" />
          <Button variant="quiet" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : null}
    </BottomBar>
  );
}
