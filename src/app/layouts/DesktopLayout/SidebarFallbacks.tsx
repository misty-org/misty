import { ArrowLeft, ArrowRight, RotateCw, Search } from "lucide-react";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { useBrowserToolbarSlot } from "@/features/browser/workspace";
import { Pressable, IconButton, toolbarIconProps } from "@/shared/ui";

/**
 * The vertical sidebar's address field and nav buttons belong to the focused browser page.
 * On any other page they stay put as stand-ins, so the sidebar never loses its top: the field
 * opens the same search a new tab does, and the nav buttons are resting.
 */
export function SidebarAddressFallback() {
  return (
    <Pressable
      type="button"
      className="misty-sidebar-address-fallback"
      data-misty-window-drag-block="true"
      onClick={() => useBrowserSearchStore.getState().show()}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">Search or enter address</span>
    </Pressable>
  );
}

export function SidebarNavFallback() {
  // Hidden in code, not only by style, while a browser page's own buttons fill the slot.
  const claimed = useBrowserToolbarSlot((state) => state.navClaims > 0);
  if (claimed) return null;
  return (
    // Sized like the page's own buttons that replace it: sidebar chrome, 6px apart.
    <div
      className="misty-sidebar-nav-fallback flex items-center gap-1.5"
      data-browser-toolbar
      data-sidebar
    >
      <IconButton tooltip={false} label="Back" disabled>
        <ArrowLeft {...toolbarIconProps} />
      </IconButton>
      <IconButton tooltip={false} label="Forward" disabled>
        <ArrowRight {...toolbarIconProps} />
      </IconButton>
      <IconButton tooltip={false} label="Reload" disabled>
        <RotateCw {...toolbarIconProps} className="size-4" />
      </IconButton>
    </div>
  );
}
