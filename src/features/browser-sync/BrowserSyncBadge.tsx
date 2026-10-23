import { useEffect, useRef, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { MenuItem } from "@/shared/ui";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import {
  Button,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  IconButton,
} from "@/shared/ui";
import { RestoreStatusList } from "./restore/RestoreStatusList";
import { LocalSaveStatusList } from "./restore/LocalSaveStatusList";
import { SyncedTabsStatusList } from "./restore/SyncedTabsStatusList";
import { SyncDeviceList } from "./SyncDeviceList";
import { SyncStatusView } from "./SyncStatusView";
import { SyncUnlockForm } from "./SyncAccountSettings";
import { useSyncController } from "./useSyncController";

const openEvent = "misty:open-sync-panel";
/** Opens the sync panel (devices and status) from elsewhere, such as the browser menu. */
function openSyncPanel() {
  // Let the menu that asked finish closing, so it cannot dismiss the panel as it opens.
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(openEvent, { detail: {} })), 60);
}

/** The More menu's Sync row: status in words, opening the sync panel the badge hosts. */
export function SyncMenuItem({ accountId }: { accountId: string }) {
  const { status } = useSyncController(accountId);
  if (!accountId || !nativeWorkspaceRecoveryEnabled()) return null;
  return (
    <MenuItem
      icon={<RefreshCw />}
      label={status.tone === "attention" ? `Sync: ${status.title}` : "Sync"}
      onSelect={openSyncPanel}
    />
  );
}

/** With `menuOnly` the badge draws no button: the More menu opens its panel, below the toolbar. */
export function BrowserSyncBadge({
  accountId,
  onOpenSettings,
  menuOnly,
}: {
  accountId: string;
  onOpenSettings(): void;
  menuOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
      // Every pane has a badge; the first one on screen answers.
      if (detail.handled || !(trigger.current ?? anchor.current)?.offsetParent) return;
      detail.handled = true;
      setOpen(true);
    };
    window.addEventListener(openEvent, onOpen);
    return () => window.removeEventListener(openEvent, onOpen);
  }, []);
  const controller = useSyncController(accountId);
  const { status, session } = controller;
  if (!accountId || !nativeWorkspaceRecoveryEnabled()) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {menuOnly ? (
        <PopoverAnchor asChild>
          <span ref={anchor} aria-hidden className="block size-0" />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <IconButton
            ref={trigger}
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
                  "absolute right-px top-px grid size-2.5 place-items-center rounded-full bg-cream text-[7px] font-bold",
                  "leading-none text-charcoal-bg ring-1 ring-charcoal-workspace",
                )}
              >
                !
              </span>
            )}
          </IconButton>
        </PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Sync"
        className="layer-blocking-popup max-h-[calc(100dvh-64px)] w-88 max-w-[calc(100vw-24px)] overflow-y-auto p-1.5"
        data-misty-window-drag-block="true"
      >
        {/* The unlock form carries its own title, so it replaces the status row. */}
        {!controller.form &&
          (status.action || status.tone === "attention" || status.title === "Set up sync") && (
            <SyncStatusView
              compact
              status={status}
              busy={controller.busy}
              onAction={() => void controller.retry()}
            />
          )}
        {controller.form && (
          <div className="px-3 py-2">
            <SyncUnlockForm controller={controller} />
          </div>
        )}
        {session && (
          <section aria-label="Devices in this workspace">
            <SyncDeviceList key={session.session_id} session={session} compact />
          </section>
        )}
        <div className="px-3">
          <RestoreStatusList />
          <LocalSaveStatusList />
          {session && <SyncedTabsStatusList session={session} />}
        </div>
        <div className="mt-1 border-t border-charcoal-border pt-1">
          <Button
            variant="ghost"
            aria-label="Sync settings"
            className="h-9 w-full justify-between px-3 text-sm font-normal text-cream-muted"
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
