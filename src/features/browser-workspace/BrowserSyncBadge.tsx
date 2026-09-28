import { useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { retryWorkspaceRecovery } from "@/features/workspace/useWorkspaceRecoveryRetry";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { Button, cn, Popover, PopoverContent, PopoverTrigger, IconButton } from "@/shared/ui";
import { browserSyncRetryEvent, useBrowserSyncStore } from "./store";
import { DeviceControlContent } from "./DeviceControlContent";
import { syncBadgeStatus } from "./syncBadgeStatus";
import { viewingName } from "./treeControl";
import { useUserStore } from "@/features/auth/core";
import { RestoreStatusList } from "./restore/RestoreStatusList";
import { currentDeviceId, websiteDataSummary } from "./websiteData";

/** Account-wide sync and device controls in the global navigator. */
export function BrowserSyncBadge({
  accountId,
  onOpenSettings,
}: {
  accountId: string;
  onOpenSettings: () => void;
}) {
  const recovery = useWorkspaceRecoveryState();
  const ownerName = useUserStore((state) => state.me?.name);
  const sync = useBrowserSyncStore();
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const openSyncSettings = () => {
    setOpen(false);
    onOpenSettings();
  };
  const status = syncBadgeStatus({ accountId, recovery, ...sync });
  // The device this session writes: its own sign-in data is what syncs now.
  const websiteData =
    sync.session?.account_id === accountId
      ? (sync.session.website_data?.find(
          (device) => device.device_id === currentDeviceId(sync.session!),
        )?.sites ?? [])
      : [];
  const partialData = websiteData.some((site) => site.skipped.length > 0)
    ? websiteDataSummary(websiteData)
    : null;
  // Preserve remote-device context in the accessible name and tooltip.
  const viewing =
    sync.session?.account_id === accountId && sync.session
      ? viewingName(sync.session, ownerName)
      : null;
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
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          data-misty-window-drag-block="true"
          data-sync-status={status.tone}
          label={viewing ? `Viewing ${viewing}. Sync: ${status.title}` : `Sync: ${status.title}`}
          className={cn(
            "misty-navigator-icon-target relative",
            open && "bg-charcoal-card text-cream-bright",
          )}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("size-4", status.spinning && "animate-spin motion-reduce:animate-none")}
          />
          {status.tone === "red" && (
            <span
              aria-hidden="true"
              data-sync-issue-badge="true"
              className="absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-notification-red text-[9px] font-bold leading-none text-white ring-2 ring-charcoal-workspace"
            >
              !
            </span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Device control center"
        className="layer-blocking-popup max-h-[calc(100dvh-64px)] w-96 max-w-[calc(100vw-24px)] overflow-y-auto"
        data-misty-window-drag-block="true"
      >
        {sync.session?.account_id === accountId && (
          <DeviceControlContent
            key={sync.session.session_id}
            session={sync.session}
            onOpenSyncSettings={openSyncSettings}
          />
        )}
        <RestoreStatusList />
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
          {status.tone === "red" && status.title !== "Local saving needs attention" && (
            <p className="mt-1 text-sm text-cream-muted">{status.detail}</p>
          )}
          {partialData && (
            <p className="mt-1 text-sm text-avatar-yellow">
              {partialData}.{" "}
              <Button variant="link" size="sm" onClick={openSyncSettings}>
                See what’s not synced
              </Button>
            </p>
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
