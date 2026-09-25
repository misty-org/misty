import { useState } from "react";
import { CircleAlert, SlidersHorizontal } from "lucide-react";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { retryWorkspaceRecovery } from "@/features/workspace/useWorkspaceRecoveryRetry";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { cn } from "@/shared/ui/utils";
import { browserSyncRetryEvent, useBrowserSyncStore } from "./store";
import { DeviceControlContent } from "./DeviceControlContent";
import { syncBadgeStatus } from "./syncBadgeStatus";

/** Account-wide status stays in the titlebar even when the navigator is hidden. */
export function BrowserSyncBadge({
  accountId,
  onOpenSettings,
}: {
  accountId: string;
  onOpenSettings: () => void;
}) {
  const recovery = useWorkspaceRecoveryState();
  const sync = useBrowserSyncStore();
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const status = syncBadgeStatus({ accountId, recovery, ...sync });
  if (!accountId || !nativeWorkspaceRecoveryEnabled()) return null;
  const retry = async () => {
    if (retrying || isApiSessionTransitioning()) return;
    setRetrying(true);
    const generation = readApiSessionGeneration();
    const valid = () => !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    try {
      if (recovery.accountId === accountId && (recovery.issue || !recovery.ready))
        await retryWorkspaceRecovery(accountId, valid);
      if (valid())
        window.dispatchEvent(new CustomEvent(browserSyncRetryEvent, { detail: accountId }));
    } finally {
      setRetrying(false);
    }
  };
  const Icon = status.tone === "red" ? CircleAlert : SlidersHorizontal;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="none"
          data-misty-window-drag-block="true"
          data-sync-status={status.tone}
          aria-label={`Control: ${status.title}`}
          title={`Control: ${status.title}`}
          className={cn(
            "h-6 shrink-0 gap-1.5 rounded-full border px-2 text-xs font-medium focus-visible:ring-2 focus-visible:ring-cream-muted",
            status.tone === "green" &&
              "border-status-green/25 bg-status-green/15 text-status-green hover:bg-status-green/25 hover:text-status-green aria-expanded:text-status-green",
            status.tone === "red" &&
              "border-avatar-red/30 bg-notification-red/20 text-avatar-red hover:bg-notification-red/30 hover:text-avatar-red aria-expanded:text-avatar-red",
            status.tone === "neutral" &&
              "border-charcoal-border bg-charcoal-card text-cream-muted hover:text-cream",
          )}
        >
          <Icon aria-hidden="true" className="size-3" />
          Control
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Device control center"
        className="z-[2147483300] max-h-[calc(100dvh-64px)] w-96 max-w-[calc(100vw-24px)] space-y-3 overflow-y-auto"
        data-misty-window-drag-block="true"
      >
        {sync.session?.account_id === accountId && (
          <DeviceControlContent key={sync.session.session_id} session={sync.session} />
        )}
        <div aria-live="polite" className="border-t border-charcoal-border pt-3">
          <h2 className="text-sm font-semibold">{status.title}</h2>
          <p className="mt-1 break-words text-sm text-cream-muted">{status.detail}</p>
        </div>
        <dl className="space-y-2 border-t border-charcoal-border pt-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-cream-muted">Local saving</dt>
            <dd className="text-right">{status.local}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-cream-muted">Website data</dt>
            <dd className="text-right">{status.websiteData}</dd>
          </div>
        </dl>
        <div className="flex gap-2">
          {status.tone !== "green" && (
            <Button
              variant="outline"
              size="sm"
              disabled={retrying || sync.connecting}
              onClick={() => void retry()}
            >
              {retrying || sync.connecting ? "Retrying…" : "Retry now"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            Settings
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
