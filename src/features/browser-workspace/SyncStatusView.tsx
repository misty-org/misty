import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Button, cn } from "@/shared/ui";
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
  /** One line with a one-word action; the detail only when something needs a look. */
  compact?: boolean;
}) {
  const Icon =
    status.tone === "attention" ? CircleAlert : status.tone === "healthy" ? CircleCheck : RefreshCw;
  const action = status.action && !hideAction && (
    <Button
      variant="outline"
      size="sm"
      className={cn(compact && "shrink-0")}
      disabled={busy}
      aria-label={compact ? status.action.label : undefined}
      onClick={onAction}
    >
      {busy ? "Working…" : compact ? status.action.short : status.action.label}
    </Button>
  );
  if (compact)
    return (
      <div className="flex items-start justify-between gap-3">
        <div role="status" aria-live="polite" className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-medium text-cream">
            <Icon aria-hidden className="size-4 shrink-0" />
            {status.title}
          </h2>
          {status.tone !== "healthy" && (
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-cream-muted">{status.detail}</p>
          )}
        </div>
        {action}
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
      {action}
    </div>
  );
}
