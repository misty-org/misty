import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Download,
  History,
  MoreVertical,
  Plus,
  RotateCw,
  Settings2,
  Star,
} from "lucide-react";
import { useBrowserChromeSlot } from "@/features/browser/workspace";
import { browserToolbarStyles } from "@/features/browser/workspace/browserToolbarStyles";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { invokeShortcutCommand } from "@/features/shortcuts";
import {
  browserInternalUrl,
  useWorkspaceStore,
  type BrowserInternalPage,
} from "@/features/workspace";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  IconButton,
  MenuItem,
  MenuTrigger,
  toolbarIconProps,
} from "@/shared/ui";

function openInternalPage(page: BrowserInternalPage) {
  useWorkspaceStore.getState().openBrowserView({ url: browserInternalUrl(page) });
}

/** The browser menu's rows that need no page: tabs, windows, library pages, settings and sync. */
function MoreMenu() {
  const chrome = useBrowserChromeSlot();
  return (
    <DropdownMenu>
      <MenuTrigger
        iconOnly
        label="Browser menu"
        title="More"
        icon={<MoreVertical {...toolbarIconProps} />}
      />
      <DropdownMenuContent align="end" width="lg">
        <MenuItem
          icon={<Plus />}
          label="New tab"
          onSelect={() => useBrowserSearchStore.getState().show()}
        />
        <MenuItem
          icon={<AppWindow />}
          label="New window"
          onSelect={() => void invokeShortcutCommand("workspace.new_virtual_window")}
        />
        <DropdownMenuSeparator />
        <MenuItem icon={<History />} label="History" onSelect={() => openInternalPage("history")} />
        <MenuItem
          icon={<Download />}
          label="Downloads"
          onSelect={() => openInternalPage("downloads")}
        />
        <MenuItem
          icon={<Star />}
          label="Bookmarks"
          onSelect={() => openInternalPage("bookmarks")}
        />
        <DropdownMenuSeparator />
        <MenuItem
          icon={<Settings2 />}
          label="Settings"
          onSelect={() =>
            window.dispatchEvent(
              new CustomEvent("misty:open-settings", { detail: { section: "browser" } }),
            )
          }
        />
        {chrome?.accountItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The browser toolbar on a page that isn't a browser page: resting back, forward and reload,
 * an empty address field that opens search, and the same four buttons on the right as a
 * browser page has: Misty, the profile and the menu. With horizontal tabs the toolbar
 * is always there, so the rest of the app stays one click away.
 */
export function PaneToolbarFallback() {
  const chrome = useBrowserChromeSlot();
  return (
    <div
      className={cn(browserToolbarStyles.bar, "border-cream/[0.055]")}
      style={{ backgroundColor: "var(--workspace-tab-surface)" }}
      data-window-toolbar
      data-browser-toolbar
      data-misty-window-drag-block="true"
    >
      <div className={browserToolbarStyles.group}>
        <IconButton label="Back" tooltip={false} disabled>
          <ArrowLeft {...toolbarIconProps} />
        </IconButton>
        <IconButton label="Forward" tooltip={false} disabled>
          <ArrowRight {...toolbarIconProps} />
        </IconButton>
        <IconButton label="Reload" tooltip={false} disabled>
          <RotateCw {...browserToolbarStyles.roundIcon} />
        </IconButton>
      </div>
      <button
        type="button"
        className="h-9 min-w-0 flex-1 truncate rounded-lg border border-cream/[0.07] px-3 text-left text-[13px] text-cream-muted transition-colors hover:bg-cream/[0.025]"
        onClick={() => useBrowserSearchStore.getState().show()}
      >
        Search or enter address
      </button>
      <div className={browserToolbarStyles.group}>
        {chrome?.sync}
        {chrome?.profile}
        <MoreMenu />
      </div>
    </div>
  );
}
