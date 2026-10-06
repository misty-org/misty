import { Bookmark } from "lucide-react";
import { ExtensionsMenuRows } from "@/features/extensions/ExtensionsMenuRows";
import { useBookmarkLibrary } from "@/features/bookmarks/library";
import { DropdownMenuSeparator, MenuItem } from "@/shared/ui";
import { MistyPanelSprite, useMistyPanelStore } from "@/features/agents";
import { useBrowserMistyPanel } from "./BrowserMistyPanel";

/**
 * What the sidebar's ⋯ menu adds above the browser menu: the page's bookmark, the Misty panel
 * and the extensions, which sit beside the address field in the horizontal toolbar.
 */
export function BrowserMenuLeadRows(props: {
  tabId: string;
  runtimeId: string;
  url: string;
  agentOwned: boolean;
  onBookmark?: () => void;
  anchor: () => HTMLElement | null;
}) {
  const { bookmarks } = useBookmarkLibrary();
  const saved = bookmarks.some((bookmark) => bookmark.url === props.url);
  const { paneId, open } = useBrowserMistyPanel(props.tabId);
  return (
    <>
      <MenuItem
        icon={<Bookmark fill={saved ? "currentColor" : "none"} />}
        label={saved ? "Edit bookmark" : "Bookmark this page"}
        disabled={!props.onBookmark}
        onSelect={() => props.onBookmark?.()}
      />
      <MenuItem
        icon={<MistyPanelSprite size={16} />}
        label={open ? "Close agent panel" : "Ask an agent"}
        onSelect={() => useMistyPanelStore.getState().setOpen(!open, paneId ?? null)}
      />
      <ExtensionsMenuRows
        tabId={props.runtimeId}
        agentOwned={props.agentOwned}
        anchor={props.anchor}
      />
      <DropdownMenuSeparator />
    </>
  );
}
