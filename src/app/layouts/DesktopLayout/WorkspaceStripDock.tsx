import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SpacesMenuButton } from "@/features/spaces";
import { dockLeaves, useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { appIcons, DropdownMenu, DropdownMenuTrigger, IconButton, MenuItem } from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

const { agents: AgentsIcon } = appIcons;

/** Whether the focused view is the Agents surface, for the button's pressed state. */
function useAgentsActive(): boolean {
  return useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    const view = pane?.views.find((item) => item.id === pane.activeViewId);
    return view?.surfaceId === "agents" || view?.surfaceId === "scheduled";
  });
}

function AgentsButton() {
  const navigate = useNavigate();
  const active = useAgentsActive();
  return (
    <IconButton
      size="xs"
      label="Agents"
      tooltip={false}
      aria-pressed={active}
      onClick={() => {
        const surface = workspaceSurfaceFromRoute("/agents");
        if (surface)
          navigate(useWorkspaceStore.getState().openDestination(surface).route, { replace: true });
      }}
    >
      <AgentsIcon className="size-4" aria-hidden="true" />
    </IconButton>
  );
}

/** Spaces and Agents, as single buttons in the tab strip. */
export function StripShortcuts() {
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-misty-window-drag-block="true">
      <SpacesMenuButton />
      <AgentsButton />
    </div>
  );
}

/** The browser menu's closing row in horizontal tabs: Sync. The profile has its own button. */
export function BrowserMenuAccountItems(props: { onSyncClick: () => void }) {
  return <MenuItem icon={<RefreshCw />} label="Sync" onSelect={props.onSyncClick} />;
}

/** The profile avatar beside Spaces in the browser toolbar, opening the profile menu. */
export function BrowserProfileButton(props: { onOpenAccountSettings: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ProfileNavButton
          open={open}
          className="grid size-9 shrink-0 place-items-center rounded-md p-0 hover:bg-charcoal-hover"
          avatarClassName="size-6"
        />
      </DropdownMenuTrigger>
      <ProfileMenu
        onClose={() => setOpen(false)}
        onOpenAccountSettings={props.onOpenAccountSettings}
      />
    </DropdownMenu>
  );
}
