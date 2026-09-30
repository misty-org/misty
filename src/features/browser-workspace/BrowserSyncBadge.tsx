import { useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { Button, cn, Popover, PopoverContent, PopoverTrigger, IconButton } from "@/shared/ui";
import { RestoreStatusList } from "./restore/RestoreStatusList";
import { SyncDeviceList } from "./SyncDeviceList";
import { SyncStatusView } from "./SyncStatusView";
import { SyncUnlockForm } from "./SyncAccountSettings";
import { useSyncController } from "./useSyncController";

export function BrowserSyncBadge({
  accountId,
  onOpenSettings,
}: {
  accountId: string;
  onOpenSettings(): void;
}) {
  const [open, setOpen] = useState(false);
  const controller = useSyncController(accountId);
  const { status, session } = controller;
  if (!accountId || !nativeWorkspaceRecoveryEnabled()) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          data-misty-window-drag-block="true"
          data-sync-status={status.tone}
          label={`Sync: ${status.title}`}
          className="misty-navigator-icon-target relative"
        >
          <RefreshCw aria-hidden className="size-4" />
          {status.tone === "attention" && (
            <span
              aria-hidden
              data-sync-issue-badge="true"
              className={cn(
                "absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-cream text-[9px] font-bold",
                "leading-none text-charcoal-bg ring-2 ring-charcoal-workspace",
              )}
            >
              !
            </span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Sync"
        className="layer-blocking-popup max-h-[calc(100dvh-64px)] w-96 max-w-[calc(100vw-24px)] overflow-y-auto"
        data-misty-window-drag-block="true"
      >
        <SyncStatusView
          status={status}
          busy={controller.busy}
          hideAction={controller.form}
          onAction={() => void controller.retry()}
        />
        {controller.form && (
          <div className="mt-4">
            <SyncUnlockForm controller={controller} compact />
          </div>
        )}
        <section
          aria-label="Devices in this workspace"
          className="mt-4 border-t border-charcoal-border pt-3"
        >
          <h2 className="text-xs font-medium text-cream-muted">Devices in this workspace</h2>
          {session ? (
            <SyncDeviceList key={session.session_id} session={session} compact />
          ) : (
            <p className="py-3 text-sm text-cream-muted">
              Connect sync to see your workspace’s devices.
            </p>
          )}
        </section>
        <RestoreStatusList />
        <div className="mt-2 border-t border-charcoal-border pt-3">
          <Button
            variant="ghost"
            className="w-full justify-between"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            Manage sync
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
