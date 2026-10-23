import { useInRouterContext, useNavigate } from "react-router-dom";
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Download,
  History,
  Info,
  MoreHorizontal,
  Plus,
  RotateCw,
  Settings,
  VenetianMask,
} from "lucide-react";
import {
  BrowserOmnibox,
  browserToolbarStyles,
  useBrowserToolbarSlot,
} from "@/features/browser/workspace";
import { invokeShortcutCommand, ShortcutText, useShortcutHandler } from "@/features/shortcuts";
import { useFocusedPaneHistory, useWorkspaceStore } from "@/features/workspace";
import { browserInternalUrl } from "@/features/workspace/browserInternalUrl";
import { blankBrowserUrl } from "@/features/workspace/model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  IconButton,
  MenuItem,
  MenuTrigger,
  toolbarIconProps,
} from "@/shared/ui";

/**
 * What the page's own field ends with, at rest: its site information button, off until a browser
 * page has a site, and a ⋯ menu with the browser's window-level rows, which need no page.
 */
function SidebarTrailingFallback() {
  const open = (page: "history" | "downloads") =>
    useWorkspaceStore.getState().openBrowserView({ url: browserInternalUrl(page) });
  const row = (icon: React.ReactNode, label: string, onSelect: () => void, shortcut?: string) => (
    <MenuItem
      icon={icon}
      label={label}
      shortcut={shortcut ? <ShortcutText commandId={shortcut} /> : undefined}
      onSelect={onSelect}
    />
  );
  return (
    <>
      <IconButton label="Site information and permissions" tooltip={false} disabled>
        <Info {...browserToolbarStyles.roundIcon} />
      </IconButton>
      <DropdownMenu>
        <MenuTrigger
          iconOnly
          label="Browser menu"
          title="More"
          icon={<MoreHorizontal {...toolbarIconProps} />}
        />
        <DropdownMenuContent align="end" width="lg">
          {row(
            <Plus />,
            "New tab",
            () => void invokeShortcutCommand("search.toggle"),
            "search.toggle",
          )}
          {row(
            <AppWindow />,
            "New window",
            () => void invokeShortcutCommand("workspace.open_space"),
          )}
          {row(
            <VenetianMask />,
            "New private window",
            () => void invokeShortcutCommand("workspace.new_incognito_window"),
          )}
          <DropdownMenuSeparator />
          {row(<History />, "History", () => open("history"))}
          {row(<Download />, "Downloads", () => open("downloads"))}
          {row(
            <Settings />,
            "Settings",
            () => window.dispatchEvent(new CustomEvent("misty:open-settings")),
            "app.open_settings",
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * The vertical sidebar's address field and nav buttons belong to the focused browser page.
 * On any other page they stay put as stand-ins, drawn by the same field as a page's own, with the
 * same buttons at its end, so the sidebar never changes shape: the field opens the same search a
 * new tab does, and the nav buttons are resting.
 */
export function SidebarAddressFallback() {
  return (
    <div
      className={`misty-sidebar-address-fallback ${browserToolbarStyles.sidebarTop}`}
      data-browser-toolbar
      data-sidebar
    >
      <div className="flex items-center gap-0.5" data-misty-window-drag-block="true">
        <BrowserOmnibox
          currentUrl={blankBrowserUrl}
          hostOnly
          onNavigate={(url) => useWorkspaceStore.getState().openBrowserView({ url })}
          trailing={<SidebarTrailingFallback />}
        />
      </div>
    </div>
  );
}

function NavButtons(props: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    // Sized like the page's own buttons that replace it: sidebar chrome, 6px apart.
    <div
      className="misty-sidebar-nav-fallback flex items-center gap-1.5"
      data-browser-toolbar
      data-sidebar
    >
      <IconButton tooltip={false} label="Back" disabled={!props.canBack} onClick={props.onBack}>
        <ArrowLeft {...toolbarIconProps} />
      </IconButton>
      <IconButton
        tooltip={false}
        label="Forward"
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        <ArrowRight {...toolbarIconProps} />
      </IconButton>
      <IconButton tooltip={false} label="Reload" disabled>
        <RotateCw {...toolbarIconProps} className="size-4" />
      </IconButton>
    </div>
  );
}

/** Back and forward through the focused pane's own pages, as the router's own `go` does. */
function PaneHistoryNav() {
  const navigate = useNavigate();
  const history = useFocusedPaneHistory();
  const { go } = history;
  const travel = (delta: -1 | 1) => {
    const view = go(delta);
    if (!view) return false;
    navigate(view.route, { replace: true });
    return true;
  };
  const usable = !history.browser;
  useShortcutHandler("navigation.back", () => usable && history.canBack && travel(-1), usable);
  useShortcutHandler("navigation.forward", () => usable && history.canForward && travel(1), usable);
  return (
    <NavButtons
      canBack={history.canBack}
      canForward={history.canForward}
      onBack={() => travel(-1)}
      onForward={() => travel(1)}
    />
  );
}

export function SidebarNavFallback() {
  // Hidden in code, not only by style, while a browser page's own buttons fill the slot.
  const claimed = useBrowserToolbarSlot((state) => state.navClaims > 0);
  const routed = useInRouterContext();
  if (claimed) return null;
  return routed ? (
    <PaneHistoryNav />
  ) : (
    <NavButtons canBack={false} canForward={false} onBack={() => {}} onForward={() => {}} />
  );
}
