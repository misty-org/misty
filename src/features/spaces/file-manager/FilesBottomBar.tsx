// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { PanelLeft, PanelRight, Settings } from "lucide-react";
import { BottomBar, Button, IconButton, Progress, Text } from "@misty/ui";
import type { FreeSpace, Progress as FilesProgress } from "@/features/files";
import { openSettings } from "@/features/settings";
import { countText, formatBytes } from "./format";

export function FilesListFooter({
  count,
  selected,
  selectedBytes,
  free,
  progress,
  onCancel,
}: {
  count: number | null;
  selected: number;
  selectedBytes: number;
  free: FreeSpace | null;
  progress: FilesProgress | null;
  onCancel(): void;
}) {
  const share =
    progress && progress.totalBytes > 0
      ? Math.min(100, (progress.doneBytes / progress.totalBytes) * 100)
      : 0;
  const summary =
    count === null
      ? ""
      : selected > 0
        ? `${selected} selected${selectedBytes > 0 ? `, ${formatBytes(selectedBytes)}` : ""}`
        : countText(count);
  return (
    <footer
      aria-label="Folder"
      className="flex h-8 min-w-0 shrink-0 items-center justify-between gap-3 px-3"
    >
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
      </div>
    </footer>
  );
}

export function FilesBottomBar({
  sidebar,
  onSidebar,
  inspector,
  onInspector,
}: {
  sidebar: boolean;
  onSidebar(on: boolean): void;
  inspector?: boolean;
  onInspector?: (on: boolean) => void;
}) {
  return (
    <BottomBar
      aria-label="Files"
      start={
        <>
          <IconButton
            label={sidebar ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebar}
            onClick={() => onSidebar(!sidebar)}
          >
            <PanelLeft />
          </IconButton>
          <IconButton label="Files settings" onClick={() => openSettings("drive")}>
            <Settings />
          </IconButton>
        </>
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
