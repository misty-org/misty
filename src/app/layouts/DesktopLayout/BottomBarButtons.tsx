import {
  CircleHelp,
  Keyboard,
  LayoutDashboard,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  SquarePen,
  Sun,
  ZoomIn,
} from "lucide-react";
import { useSidebarCollapsedStore } from "@/app/shell";
import { useLayoutEditor } from "@/features/app-windows";
import { useMistyPanelStore } from "@/features/agents";
import { openSettings, useAppThemeStore, useSettingsStore } from "@/features/settings";
import { appZoomDefault, setAppZoom, useAppZoomValue } from "@/shared/hooks/useAppZoom";
import { Button, IconButton, Tooltip } from "@misty/ui";
import { useBottomBarOpen as useOpen } from "./bottomBarOpenContext";
import { useHelpDialog } from "./HelpDialog";
import { useSearchDialog } from "./search/searchStore";
import { openNewChat, openNewTab } from "./spaceNavigation";

/*
 * The bottom bar's one-click buttons: zoom, shortcuts, new chat and tab, search, layout, the
 * Misty panel, the sidebar, theme and help.
 */

/** The app's zoom, only while it isn't 100%. Resets it. */
export function ZoomLevel() {
  const zoom = useAppZoomValue();
  if (zoom === appZoomDefault) return null;
  return (
    <Tooltip content="Reset to 100%">
      <Button variant="quiet" icon={ZoomIn} onClick={() => setAppZoom(appZoomDefault)}>
        {`${Math.round(zoom * 100)}%`}
      </Button>
    </Tooltip>
  );
}

export function ShortcutsButton() {
  return (
    <IconButton label="Shortcuts" onClick={() => openSettings("shortcuts")}>
      <Keyboard />
    </IconButton>
  );
}

export function NewChatButton() {
  const open = useOpen();
  return (
    <IconButton label="New chat" onClick={() => openNewChat(open)}>
      <SquarePen />
    </IconButton>
  );
}

export function NewTabButton() {
  const open = useOpen();
  return (
    <IconButton label="New tab" onClick={() => openNewTab(open)}>
      <Plus />
    </IconButton>
  );
}

export function SearchButton() {
  return (
    <IconButton label="Search" onClick={() => useSearchDialog.getState().setOpen(true)}>
      <Search />
    </IconButton>
  );
}

export function LayoutButton() {
  const active = useLayoutEditor((state) => state.active);
  return (
    <IconButton
      label="Layout"
      aria-pressed={active}
      onClick={() => useLayoutEditor.getState().toggle()}
    >
      <LayoutDashboard />
    </IconButton>
  );
}

export function MistyPanelButton() {
  const open = useMistyPanelStore((state) => state.chatOpen);
  return (
    <IconButton
      label={open ? "Hide the Misty panel" : "Show the Misty panel"}
      aria-pressed={open}
      onClick={() => useMistyPanelStore.getState().toggle()}
    >
      <PanelRight />
    </IconButton>
  );
}

export function SidebarButton() {
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  return (
    <IconButton
      label={collapsed ? "Show the sidebar" : "Hide the sidebar"}
      aria-pressed={!collapsed}
      onClick={() => useSidebarCollapsedStore.getState().toggle()}
    >
      <PanelLeft />
    </IconButton>
  );
}

export function ThemeButton() {
  const dark = useAppThemeStore((state) => state.resolvedTheme) === "dark";
  return (
    <IconButton
      label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      onClick={() =>
        useSettingsStore
          .getState()
          .updateSetting("appearance", "theme_mode", dark ? "light" : "dark")
      }
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

export function HelpButton() {
  return (
    <IconButton label="Help" onClick={() => useHelpDialog.getState().setOpen(true)}>
      <CircleHelp />
    </IconButton>
  );
}
