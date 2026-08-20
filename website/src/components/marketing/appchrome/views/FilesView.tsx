import { Cloud, Folder, HardDrive } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppChip } from "../AppWindow";

const locations = [
  { name: "This Mac", Icon: HardDrive },
  { name: "Google Drive", Icon: Cloud },
  { name: "Recent", Icon: Folder },
];

const files = [
  { name: "Launch brief.pdf", size: "2.4 MB", scope: "Private", shared: false },
  { name: "Research notes.md", size: "18 KB", scope: "Private", shared: false },
  { name: "Brand assets", size: "Folder", scope: "In Launch plan", shared: true },
  { name: "Interview clips", size: "Folder", scope: "Private", shared: false },
  { name: "Q3 timeline.xlsx", size: "412 KB", scope: "In Launch plan", shared: true },
  { name: "Tax return 2025.pdf", size: "1.1 MB", scope: "Private", shared: false },
];

/**
 * Browsing local and connected files.
 *
 * The point of this surface is the `scope` column: most rows read "Private",
 * a couple read "In Launch plan". The privacy claim is made by the data, not
 * by a caption underneath it.
 */
export function FilesView() {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3">
        <span className="flex-1 truncate rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2.5 py-1 text-[11px] text-[var(--app-ink-muted)]">
          Search files
        </span>
        <span className="rounded-md bg-[var(--app-hover)] px-2 py-1 text-[11px] text-[var(--app-ink-bright)]">
          Add to Space
        </span>
      </div>

      <div className="grid min-h-0 flex-1 @lg:grid-cols-[136px_minmax(0,1fr)]">
        <div className="hidden flex-col gap-0.5 border-r border-[var(--app-border)] bg-[var(--app-sidebar)] p-2 @lg:flex">
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-ink-muted)]">
            Locations
          </p>
          {locations.map(({ name, Icon }, index) => (
            <span
              key={name}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-[6px] text-[11px]",
                index === 0
                  ? "bg-[var(--app-hover)] font-medium text-[var(--app-ink-bright)]"
                  : "text-[var(--app-ink-muted)]",
              )}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.85} />
              <span className="truncate">{name}</span>
            </span>
          ))}
        </div>

        <div className="min-w-0 p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_92px] gap-3 px-2.5 pb-2 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-ink-muted)]">
            <span>Name</span>
            <span className="text-right">Size</span>
            <span className="text-right">Shared</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--app-border)]">
            {files.map((file, index) => (
              <div
                key={file.name}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_64px_92px] items-center gap-3 px-2.5 py-[9px]",
                  index > 0 && "border-t border-[var(--app-border)]",
                  index === 2 && "bg-[var(--app-hover)]",
                )}
              >
                <span className="truncate text-[12px] text-[var(--app-ink-bright)]">
                  {file.name}
                </span>
                <span className="text-right text-[11px] text-[var(--app-ink-muted)]">
                  {file.size}
                </span>
                <span className="flex justify-end">
                  <AppChip tone={file.shared ? "bright" : "muted"}>
                    {file.scope}
                  </AppChip>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
