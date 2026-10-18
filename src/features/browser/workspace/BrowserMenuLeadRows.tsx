import { Bookmark } from "lucide-react";
import { ExtensionsMenuRows } from "@/features/extensions/ExtensionsMenuRows";
import { useBookmarkLibrary } from "@/features/bookmarks/library";
import { DropdownMenuSeparator, MenuItem } from "@/shared/ui";

/**
 * What the sidebar's ⋯ menu adds above the browser menu: the page's bookmark
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
  return (
    <>
      <MenuItem
        icon={<Bookmark fill={saved ? "currentColor" : "none"} />}
        label={saved ? "Edit bookmark" : "Bookmark this page"}
        disabled={!props.onBookmark}
        onSelect={() => props.onBookmark?.()}
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
