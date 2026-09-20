import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { BrowserDownloadsButton } from "@/features/browser/workspace";
import { SpacesMenuButton } from "@/features/spaces";
import { browserInternalUrl, useWorkspaceStore } from "@/features/workspace";
import { MistyPanelSprite, useMistyPanelAgentName, useMistyPanelStore } from "@/features/agents";
import { Button, DropdownMenu, DropdownMenuTrigger, MenuItem } from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

/** The selected agent, as its cloud and name (Misty by default): opens the side panel in the browser. */
function MistyButton() {
  const open = useMistyPanelStore((state) => state.open);
  const name = useMistyPanelAgentName();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={open}
      title={name}
      className="min-w-0 gap-1.5"
      onClick={() => useMistyPanelStore.getState().setOpen(!open, null)}
    >
      <MistyPanelSprite size={20} />
      <span className="min-w-0 truncate">{name}</span>
    </Button>
  );
}

/** Spaces and Misty, named, in their own container at a sidebar's bottom-left. */
export function StripShortcuts() {
  return (
    <div className="misty-sidebar-shortcuts" data-misty-window-drag-block="true">
      <SpacesMenuButton labeled />
      <MistyButton />
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
