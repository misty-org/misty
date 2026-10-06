import { useState } from "react";
import { BrowserDownloadsButton } from "@/features/browser/workspace";
import { browserInternalUrl, useWorkspaceStore } from "@/features/workspace";
import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

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

/** The profile avatar in the browser toolbar, opening the profile menu. */
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
