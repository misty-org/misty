import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, LayoutGrid, Plus, RefreshCw } from "lucide-react";
import { useBrowserOverlayControl } from "@/features/browser";
import { BrowserDownloadsButton } from "@/features/browser/workspace";
import { SpacesLauncherList } from "@/features/spaces";
import {
  browserInternalUrl,
  dockLeaves,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { AgentAvatar, MistyPanelSprite, useMistyPanelStore, usePersonalAgentsStore } from "@/features/agents";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  AvatarShuffleStack,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SplitMenuPill,
  toolbarIconProps,
} from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

/** The Space the focused view shows, or "" when it shows something else. */
function useActiveSpaceId(): string {
  return useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((p) => p.id === state.layout.focusedPaneId) ?? panes[0];
    const view = pane?.views.find((item) => item.id === pane.activeViewId);
    if (view?.surfaceId !== "space") return "";
    const segment = view.route.split(/[?#]/)[0].split("/")[2] ?? "";
    try {
      return decodeURIComponent(segment);
    } catch {
      return "";
    }
  });
}

/**
 * The app launcher, at a sidebar's bottom-right: one button that opens a panel beside the drawer
 * with the user's Spaces and agents. Choosing a Space opens it; choosing an agent opens the Misty
 * panel with that agent selected.
 */
export function AppLauncherButton() {
  const overlay = useBrowserOverlayControl("app-launcher");
  const navigate = useNavigate();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const selectedAgentId = useMistyStore((state) => state.selectedAgentId);
  const activeSpaceId = useActiveSpaceId();
  const selected =
    agents.find((agent) => agent.id === selectedAgentId) ??
    agents.find((agent) => agent.system_managed);
  const close = () => overlay.onOpenChange(false);
  return (
    <div
      className="flex shrink-0 items-center"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
    >
      <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
        <PopoverTrigger asChild>
          <IconButton label="Apps" tooltip={false} aria-pressed={overlay.open}>
            <LayoutGrid {...toolbarIconProps} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={14} className="w-72 p-0">
          <Command label="Spaces and agents">
            <CommandList>
              <SpacesLauncherList activeSpaceId={activeSpaceId} onChoose={close} />
              <CommandSeparator />
              <CommandGroup heading="Agents">
                {agents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={`agent:${agent.id}`}
                    onSelect={() => {
                      useMistyStore.setState({
                        selectedAgentId: agent.id,
                        activeConversationId: "",
                      });
                      useMistyPanelStore.getState().setOpen(true, null);
                      close();
                    }}
                  >
                    <span className="size-6 shrink-0 [&_.agent-avatar]:!size-6">
                      <AgentAvatar agent={agent} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    {agent.id === selected?.id ? <Check aria-label="Current agent" /> : null}
                  </CommandItem>
                ))}
                <CommandItem
                  value="new-agent"
                  onSelect={() => {
                    const surface = workspaceSurfaceFromRoute("/agents");
                    if (surface)
                      navigate(useWorkspaceStore.getState().openDestination(surface).route, {
                        replace: true,
                      });
                    close();
                  }}
                >
                  <Plus />
                  New agent
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Downloads, at a sidebar's bottom-right: a progress ring while something downloads. */
export function StripDownloads() {
  return (
    // Marked as sidebar chrome, so the button takes the same size and icon as the back and
    // forward buttons in the header (28px, 18px glyph), not the toolbar's larger ones.
    <div
      className="flex shrink-0 items-center"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
    >
      <BrowserDownloadsButton
        alwaysVisible
        suspensionReason="strip-downloads"
        onShowAll={() =>
          useWorkspaceStore.getState().openBrowserView({ url: browserInternalUrl("downloads") })
        }
      />
    </div>
  );
}

/** The browser menu's closing row in horizontal tabs: Sync. The profile has its own button. */
export function BrowserMenuAccountItems(props: { onSyncClick: () => void }) {
  return <MenuItem icon={<RefreshCw />} label="Sync" onSelect={props.onSyncClick} />;
}

/**
 * The agents pill: the personal agents as a stack of avatars, the selected one in front and
 * named beside it. Choosing an agent rotates it to the front and opens the Misty panel on it.
 */
export function AgentsMenuButton() {
  const navigate = useNavigate();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const selectedAgentId = useMistyStore((state) => state.selectedAgentId);
  const paneId = useWorkspaceStore((state) => state.layout.focusedPaneId);
  const selected =
    agents.find((agent) => agent.id === selectedAgentId) ??
    agents.find((agent) => agent.system_managed) ??
    agents[0];
  return (
    <div className="flex min-w-0 items-center" data-misty-window-drag-block="true">
      <DropdownMenu>
        <SplitMenuPill
          label={selected?.name ?? "Agents"}
          actionLabel={selected ? `Open ${selected.name}` : "Open Agents"}
          menuLabel="Choose Agent"
          onAction={() => useMistyPanelStore.getState().setOpen(true, paneId ?? null)}
          icon={
            selected ? (
              <AvatarShuffleStack
                activeId={selected.id}
                items={agents.map((agent) => ({
                  id: agent.id,
                  node: (
                    <span className="[&_.agent-avatar]:!size-5">
                      <AgentAvatar agent={agent} />
                    </span>
                  ),
                }))}
              />
            ) : (
              <MistyPanelSprite size={20} />
            )
          }
        />
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-16px)]">
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => {
                useMistyStore.setState({ selectedAgentId: agent.id, activeConversationId: "" });
                useMistyPanelStore.getState().setOpen(true, paneId ?? null);
              }}
            >
              <span className="size-5 shrink-0 [&_.agent-avatar]:!size-5">
                <AgentAvatar agent={agent} />
              </span>
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {agent.id === selected?.id ? <Check className="size-4" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onSelect={() => {
              const surface = workspaceSurfaceFromRoute("/agents");
              if (surface)
                navigate(useWorkspaceStore.getState().openDestination(surface).route, {
                  replace: true,
                });
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">New agent</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
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
