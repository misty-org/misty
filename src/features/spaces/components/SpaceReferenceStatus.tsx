import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/ui";

export function SpaceReferenceStatus(props: {
  lastSyncedAt: string | null;
  loading: boolean;
  onReconnect: () => void;
}) {
  return (
    <div
      className="ml-2 flex min-w-0 items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"
      role="status"
    >
      <WifiOff size={13} aria-hidden="true" />
      <span className="truncate">
        Saved copy
        {props.lastSyncedAt ? ` · updated ${formatSavedCopyTime(props.lastSyncedAt)}` : ""}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[11px]"
        disabled={props.loading}
        onClick={props.onReconnect}
      >
        <RefreshCw size={12} className={props.loading ? "animate-spin" : undefined} />
        Reconnect
      </Button>
    </div>
  );
}

function formatSavedCopyTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "earlier";
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}
