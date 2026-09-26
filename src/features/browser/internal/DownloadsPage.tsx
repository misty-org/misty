import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/shared/ui";
import {
  downloadProgressFraction,
  formatBytes,
  useBrowserDownloadsStore,
} from "../library/downloadsStore";
import { browserLibrary, type BrowserDownloadEntry } from "../library/native";
import {
  InternalPageEmpty,
  InternalPageFrame,
  internalActionClass,
  internalRowClass,
} from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";

const revealLabel =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
    ? "Show in Finder"
    : "Show in folder";

export function downloadStatusText(entry: BrowserDownloadEntry): string {
  switch (entry.state) {
    case "in_progress":
      return entry.total > 0
        ? `${formatBytes(entry.received)} of ${formatBytes(entry.total)}`
        : `${formatBytes(entry.received)} downloaded`;
    case "finished":
      return entry.exists
        ? `${formatBytes(entry.received)} · ${hostOf(entry.url)}`
        : "File moved or deleted";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted when Misty quit";
    default:
      return entry.error || "Failed";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function DownloadsPage(props: BrowserInternalPageProps) {
  const { entries, loaded, error, refresh } = useBrowserDownloadsStore();
  const [text, setText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => void refresh(), [refresh]);

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.fileName.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle),
    );
  }, [entries, text]);

  const run = (action: () => Promise<void>) => {
    setActionError(null);
    void action()
      .then(refresh)
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : String(cause));
        void refresh();
      });
  };

  return (
    <InternalPageFrame
      title="Downloads"
      icon={Download}
      search={{ value: text, placeholder: "Search downloads", onChange: setText }}
      actions={
        <button
          type="button"
          className={internalActionClass}
          disabled={!entries.some((entry) => entry.state !== "in_progress")}
          onClick={() => run(() => browserLibrary.removeDownloads({}))}
        >
          Clear list
        </button>
      }
    >
      {error || actionError ? (
        <p className="mb-3 text-xs text-red-300">{actionError ?? error}</p>
      ) : null}
      {loaded && !visible.length ? (
        <InternalPageEmpty
          title={text ? "No matching downloads" : "No downloads yet"}
          detail={
            text
              ? undefined
              : "Files you download from websites are saved to your Downloads folder and listed here."
          }
        />
      ) : null}
      <ul className="grid gap-1">
        {visible.map((entry) => (
          <DownloadRow
            key={entry.id}
            entry={entry}
            run={run}
            retry={() => props.openInNewTab(entry.url)}
          />
        ))}
      </ul>
    </InternalPageFrame>
  );
}

function DownloadRow(props: {
  entry: BrowserDownloadEntry;
  run: (action: () => Promise<void>) => void;
  retry: () => void;
}) {
  const { entry, run } = props;
  const fraction = downloadProgressFraction(entry);
  const active = entry.state === "in_progress";
  const openable = entry.state === "finished" && entry.exists;
  return (
    <li className={cn(internalRowClass, "items-start py-2.5")}>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className={cn(
            "block max-w-full truncate text-left text-sm focus-visible:outline-none",
            openable ? "text-cream-bright hover:underline" : "text-cream-muted",
            !openable && entry.state === "finished" && "line-through",
          )}
          disabled={!openable}
          title={entry.path || entry.url}
          onClick={() => run(() => browserLibrary.openDownload(entry.id))}
        >
          {entry.fileName || hostOf(entry.url) || "Download"}
        </button>
        <p className="mt-0.5 truncate text-xs text-cream-muted">{downloadStatusText(entry)}</p>
        {active ? (
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-charcoal-card"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
          >
            <div
              className={cn(
                "h-full rounded-full bg-cream-muted",
                fraction === null && "w-1/3 animate-pulse",
              )}
              style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {active ? (
          <button
            type="button"
            className={internalActionClass}
            onClick={() => run(() => browserLibrary.cancelDownload(entry.id))}
          >
            Cancel
          </button>
        ) : null}
        {entry.state === "finished" && entry.exists ? (
          <button
            type="button"
            className={internalActionClass}
            onClick={() => run(() => browserLibrary.revealDownload(entry.id))}
          >
            {revealLabel}
          </button>
        ) : null}
        {!active && entry.state !== "finished" ? (
          <button type="button" className={internalActionClass} onClick={props.retry}>
            Retry
          </button>
        ) : null}
        {!active ? (
          <button
            type="button"
            className={internalActionClass}
            aria-label={`Remove ${entry.fileName || "download"} from the list`}
            title="Remove from list"
            onClick={() => run(() => browserLibrary.removeDownloads({ ids: [entry.id] }))}
          >
            Remove
          </button>
        ) : null}
      </div>
    </li>
  );
}
