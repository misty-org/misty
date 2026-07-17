import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui";
import type { SyncStatus } from "./syncStatus";
export function SyncStatusView({
  status,
  busy,
  onAction,
  hideAction = false,
}: {
  status: SyncStatus;
  busy: boolean;
  onAction(): void;
  hideAction?: boolean;
}) {
  const Icon =
    status.tone === "attention" ? CircleAlert : status.tone === "healthy" ? CircleCheck : RefreshCw;
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
