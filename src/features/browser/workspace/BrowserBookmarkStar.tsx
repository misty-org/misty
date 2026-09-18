import { Bookmark } from "lucide-react";
import { useBookmarkLibrary } from "@/features/bookmarks/library";
import { IconButton, toolbarIconProps } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";

/** The bookmark button: filled when this page is bookmarked; opens the bookmark dialog. */
export function BrowserBookmarkStar(props: { url: string; onBookmark: () => void }) {
  const { bookmarks } = useBookmarkLibrary();
  const saved = bookmarks.some((bookmark) => bookmark.url === props.url);
  const label = saved ? "Edit bookmark" : "Bookmark this page";
  const title = useShortcutTitle(label, "browser.bookmark");
  return (
    <IconButton
      label={label}
      size="xs"
      tooltip={false}
      title={title}
      aria-pressed={saved}
      className={saved ? "text-cream-bright" : undefined}
      onClick={props.onBookmark}
    >
      <Bookmark {...toolbarIconProps} size={16} fill={saved ? "currentColor" : "none"} />
    </IconButton>
  );
}
