import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { cn, menuItemClass, menuListClass, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { downloadStatusText } from "../internal/DownloadsPage";
import {
  downloadProgressFraction,
  recentDownloadMs,
  useBrowserDownloadsStore,
} from "../library/downloadsStore";
import { browserLibrary } from "../library/native";
import { browserToolbarStyles } from "./browserToolbarStyles";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

/**
 * Appears while something is downloading or just finished, like Chrome's
 * downloads bubble. The full list lives at misty://downloads.
 */
export function BrowserDownloadsButton(props: {
  iconButtonClass: string;
  suspensionReason: string;
  onShowAll: () => void;
}) {
  const entries = useBrowserDownloadsStore((state) => state.entries);
  const lastFinishedAt = useBrowserDownloadsStore((state) => state.lastFinishedAt);
  const refresh = useBrowserDownloadsStore((state) => state.refresh);
  const overlay = useBrowserOverlayControl(props.suspensionReason);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const active = entries.filter((entry) => entry.state === "in_progress");
  const recent = entries.filter(
    (entry) => now - (entry.finishedAt ?? entry.startedAt) < recentDownloadMs,
  );
  if (!active.length && !recent.length && !overlay.open) return null;

  const fractions = active.map(downloadProgressFraction);
  const known = fractions.filter((value): value is number => value !== null);
  const progress = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
  const justFinished = Date.now() - lastFinishedAt < 2_000;

  return (
    <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(props.iconButtonClass, "relative", justFinished && "text-cream-bright")}
          aria-label={active.length ? `Downloads: ${active.length} in progress` : "Downloads"}
          title="Downloads"
        >
          <Download {...browserToolbarStyles.icon} />
          {active.length ? (
            <svg className="pointer-events-none absolute inset-0.5" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${(progress ?? 0.25) * 100.5} 100.5`}
                transform="rotate(-90 18 18)"
                className={progress === null ? "origin-center animate-spin" : undefined}
              />
            </svg>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className={cn("w-80", menuListClass)}>
        <ul className="grid">
          {entries.slice(0, 5).map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-cream-bright">{entry.fileName || "Download"}</p>
                <p className="truncate text-xs text-cream-muted">{downloadStatusText(entry)}</p>
              </div>
              {entry.state === "in_progress" ? (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-xs text-cream-muted hover:bg-charcoal-hover hover:text-cream-bright"
                  onClick={() => void browserLibrary.cancelDownload(entry.id).then(refresh)}
                >
                  Cancel
                </button>
              ) : entry.state === "finished" && entry.exists ? (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-xs text-cream-muted hover:bg-charcoal-hover hover:text-cream-bright"
                  onClick={() => void browserLibrary.openDownload(entry.id).catch(refresh)}
                >
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={menuItemClass}
          onClick={() => {
            overlay.onOpenChange(false);
            props.onShowAll();
          }}
        >
          Show all downloads
        </button>
      </PopoverContent>
    </Popover>
  );
}
