import {
  BrowserAgentsButton,
  useBrowserToolbarSlot,
  sidebarTools,
  useSidebarTools,
  type SidebarToolDefinition,
  type SidebarToolId,
} from "@/features/browser";
import { LayoutPanelLeft } from "lucide-react";
import { useLayoutEditor, useWorkspaceStore } from "@/features/app-windows";
import { browserInternalUrl } from "@/features/app-windows";
import { invokeShortcutCommand } from "@/features/shortcuts";
import { openSignInSheet, useAuth } from "@/features/account";
import { SpaceRow, SpaceRowPreview } from "@/features/spaces";
import { IconButton, toolbarIconProps } from "@/shared/ui";

const setToolsSlot = (element: HTMLDivElement | null) =>
  useBrowserToolbarSlot.getState().setTools(element);

/** Turns layout mode on or off: split and join the window's tabs over the live page. */
function LayoutButton() {
  const active = useLayoutEditor((state) => state.active);
  return (
    <IconButton
      label="Layout"
      aria-pressed={active}
      onClick={() => useLayoutEditor.getState().toggle()}
    >
      <LayoutPanelLeft {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
}

const openPage = (page: "downloads" | "history" | "passwords") =>
  useWorkspaceStore.getState().openBrowserView({ url: browserInternalUrl(page) });

/**
 * The tools at the sidebar's foot, the same on every page: the Space button, then those pinned from the pin menu
 * (pane layout and Agents to begin with), which belong to the window and not to a page, then the
 * pinned extensions a browser page fills in.
 */
export function SidebarToolsRow() {
  const { user, sessionExpired } = useAuth();
  // An expired session loads no Spaces, so it asks to sign in like being signed out does.
  const signedIn = Boolean(user) && !sessionExpired;
  const { pinned } = useSidebarTools();
  const tool = (id: SidebarToolId) => {
    if (!pinned.includes(id)) return null;
    if (id === "pane-layout") return <LayoutButton key={id} />;
    if (id === "agents") return <BrowserAgentsButton key={id} />;
    const definition: SidebarToolDefinition | undefined = sidebarTools.find(
      (item) => item.id === id,
    );
    const Icon = definition?.icon;
    if (!definition || !Icon) return null;
    return (
      <IconButton
        key={id}
        label={definition.label}
        onClick={() => {
          if (definition.page) openPage(definition.page);
          else if (definition.command) invokeShortcutCommand(definition.command);
        }}
      >
        <Icon {...toolbarIconProps} className="size-4" />
      </IconButton>
    );
  };
  return (
    <div
      className="misty-sidebar-head-tools"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
    >
      {signedIn ? (
        <SpaceRow />
      ) : (
        <SpaceRowPreview
          onSignIn={() =>
            sessionExpired ? openSignInSheet("expired", user?.email) : openSignInSheet("space")
          }
        />
      )}
      {sidebarTools.map((item) => tool(item.id))}
      <div ref={setToolsSlot} className="flex items-center empty:hidden" />
    </div>
  );
}
