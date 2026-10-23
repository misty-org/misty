import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui";
import type { SyncStatus } from "./syncStatus";
export function SyncStatusView({
  status,
  busy,
  onAction,
  hideAction = false,
  compact = false,
}: {
  status: SyncStatus;
  busy: boolean;
  onAction(): void;
  hideAction?: boolean;
  compact?: boolean;
}) {
  const Icon =
    status.tone === "attention" ? CircleAlert : status.tone === "healthy" ? CircleCheck : RefreshCw;
  if (compact)
    return (
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Icon aria-hidden className="size-4 shrink-0 text-cream-muted" />
        <div
          role="status"
          aria-live="polite"
          aria-description={status.detail}
          className="min-w-0 flex-1"
        >
          <p className="text-sm text-cream" title={status.detail}>
            {status.title}
          </p>
        </div>
        {status.action && !hideAction && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-2 text-xs"
            disabled={busy}
            onClick={onAction}
            aria-label={status.action.label}
          >
            {busy
              ? "Working…"
              : status.action.label === "Retry sync"
                ? "Retry"
                : status.action.label}
          </Button>
        )}
      </div>
    );
  return (
    <div className="space-y-2">
      <div role="status" aria-live="polite">
        <h2 className="flex items-center gap-2 text-sm font-medium text-cream">
          <Icon aria-hidden className="size-4 shrink-0" />
          {status.title}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-cream-muted">{status.detail}</p>
      </div>
      {status.action && !hideAction && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onAction}>
          {busy ? "Working…" : status.action.label}
        </Button>
      )}
    </div>
  );
}
