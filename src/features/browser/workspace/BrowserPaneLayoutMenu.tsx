import { LayoutPanelLeft, PanelBottomDashed, PanelRightDashed, X } from "lucide-react";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { invokeShortcutCommand } from "@/features/shortcuts/runtime";
import { DropdownMenu, DropdownMenuContent, MenuItem, MenuSubmenu, MenuTrigger } from "@/shared/ui";
import { browserToolbarStyles } from "./browserToolbarStyles";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

/** Splits and closes this tab's pane, beside the site information button. */
export function BrowserPaneLayoutMenu({ tabId }: { tabId: string }) {
  const { open, onOpenChange } = useBrowserOverlayControl(`pane-layout:${tabId}`);
  const paneCount = useWorkspaceStore((state) => dockLeaves(state.layout.root).length);
  // The menu closes first, then the command runs on the pane this tab is in.
  const run = (commandId: string) => {
    onOpenChange(false);
    useWorkspaceStore.getState().focusView(tabId);
    window.setTimeout(() => invokeShortcutCommand(commandId), 0);
  };
  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
        <MenuTrigger
          iconOnly
          label="Pane layout"
          title="Pane layout"
          icon={<LayoutPanelLeft {...browserToolbarStyles.roundIcon} />}
        />
        <DropdownMenuContent align="start">
          <MenuItem
            icon={<PanelRightDashed />}
            label="Split right"
            disabled={paneCount >= 4}
            onSelect={() => run("workspace.split_right")}
          />
          <MenuItem
            icon={<PanelBottomDashed />}
            label="Split down"
            disabled={paneCount >= 4}
            onSelect={() => run("workspace.split_down")}
          />
          <MenuItem
            icon={<X />}
            label="Close pane"
            disabled={paneCount <= 1}
            onSelect={() => run("workspace.close_pane")}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** The same choices as a submenu of the ⋯ menu, where the top-tabs toolbar keeps them. Choosing
 * one closes the whole menu, then the command runs on the pane this tab is in. */
export function BrowserPaneLayoutSubmenu({ tabId }: { tabId: string }) {
  const paneCount = useWorkspaceStore((state) => dockLeaves(state.layout.root).length);
  const run = (commandId: string) => {
    useWorkspaceStore.getState().focusView(tabId);
    window.setTimeout(() => invokeShortcutCommand(commandId), 0);
  };
  return (
    <MenuSubmenu icon={<LayoutPanelLeft />} label="Pane layout">
      <MenuItem
        icon={<PanelRightDashed />}
        label="Split right"
        disabled={paneCount >= 4}
        onSelect={() => run("workspace.split_right")}
      />
      <MenuItem
        icon={<PanelBottomDashed />}
        label="Split down"
        disabled={paneCount >= 4}
        onSelect={() => run("workspace.split_down")}
      />
      <MenuItem
        icon={<X />}
        label="Close pane"
        disabled={paneCount <= 1}
        onSelect={() => run("workspace.close_pane")}
      />
    </MenuSubmenu>
  );
}
