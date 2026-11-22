// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { PanelLeft, PanelRight, X } from "lucide-react";
import { BottomBar, Button, IconButton, Progress, Text } from "@misty/ui";
import type { FreeSpace, Progress as FilesProgress } from "@/features/files";
import { countText, formatBytes } from "./format";

/**
 * The foot of the file list, as Kura's: how many items the folder holds (or how many are picked,
 * with their size) at its start; the operation running now with its progress and Cancel, and how
 * much room is left on the folder's disk, at its end.
 */
export function FilesListFooter({
  count,
  selected,
  selectedBytes,
  free,
  progress,
  onCancel,
  onClosePane,
}: {
  count: number | null;
  selected: number;
  selectedBytes: number;
  free: FreeSpace | null;
  progress: FilesProgress | null;
  onCancel(): void;
  /** Closes this pane, while its tab is split. */
  onClosePane?: () => void;
}) {
  const share = progress && progress.totalBytes > 0 ? Math.min(100, (progress.doneBytes / progress.totalBytes) * 100) : 0;
  const summary =
    count === null
      ? ""
      : selected > 0
        ? `${selected} selected${selectedBytes > 0 ? `, ${formatBytes(selectedBytes)}` : ""}`
        : countText(count);
  return (
    <footer aria-label="Folder" className="flex h-8 min-w-0 shrink-0 items-center justify-between gap-3 px-3">
      <Text size="meta" tone="muted">
        {summary}
      </Text>
      <div className="flex min-w-0 items-center gap-2">
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
        {free ? (
          <Text size="meta" tone="muted">
            {`${formatBytes(free.free)} available`}
          </Text>
        ) : null}
        {onClosePane ? (
          <IconButton label="Close pane" size="sm" onClick={onClosePane}>
            <X />
          </IconButton>
        ) : null}
      </div>
    </footer>
  );
}

/** Kura's bottom bar: the sidebar's toggle at its start, the inspector's at its end. */
export function FilesBottomBar({
  sidebar,
  onSidebar,
  inspector,
  onInspector,
}: {
  sidebar: boolean;
  onSidebar(on: boolean): void;
  /** The inspector's toggle; left out where there is no inspector (the picker). */
  inspector?: boolean;
  onInspector?: (on: boolean) => void;
}) {
  return (
    <BottomBar
      aria-label="Files"
      start={
        <IconButton label={sidebar ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebar} onClick={() => onSidebar(!sidebar)}>
          <PanelLeft />
        </IconButton>
      }
    >
      {onInspector ? (
        <IconButton
          label={inspector ? "Hide preview" : "Show preview"}
          aria-pressed={inspector}
          onClick={() => onInspector(!inspector)}
        >
          <PanelRight />
        </IconButton>
      ) : null}
    </BottomBar>
  );
}
