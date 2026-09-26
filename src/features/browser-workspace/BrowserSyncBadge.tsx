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
  const openSyncSettings = () => {
    setOpen(false);
    onOpenSettings();
  };
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
          aria-label={`Sync: ${status.title}`}
          title={`Sync: ${status.title}`}
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
          Sync
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Device control center"
        className="z-[2147483300] max-h-[calc(100dvh-64px)] w-96 max-w-[calc(100vw-24px)] overflow-y-auto"
        data-misty-window-drag-block="true"
      >
        {sync.session?.account_id === accountId && (
          <DeviceControlContent
            key={sync.session.session_id}
            session={sync.session}
            onOpenSyncSettings={openSyncSettings}
          />
        )}
        <div className="border-t border-charcoal-border pt-3">
          <div aria-live="polite" className="flex items-center gap-2 text-sm">
            {status.tone === "red" && (
              <CircleAlert aria-hidden className="size-4 shrink-0 text-avatar-red" />
            )}
            <h2 className="font-medium">{status.title}</h2>
          </div>
          {status.title === "Local saving needs attention" && (
            <p className="mt-1 text-sm text-cream-muted">Keep Misty open until saved.</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
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
          {sync.session?.account_id !== accountId && (
            <Button variant="ghost" size="sm" onClick={openSyncSettings} aria-label="Sync settings">
              Sync
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
