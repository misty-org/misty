import { Star } from "lucide-react";
import { useWorkspaceStore } from "@/features/workspace";
import { IconButton, toolbarIconProps } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";

/** Shows whether this page is bookmarked and opens the bookmark dialog. */
export function BrowserBookmarkStar(props: { url: string; onBookmark: () => void }) {
  const saved = useWorkspaceStore((state) =>
    state.savedWebsites.some((site) => site.fields.url === props.url),
  );
  const label = saved ? "Edit bookmark" : "Bookmark this page";
  const title = useShortcutTitle(label, "browser.bookmark");
  return (
    <IconButton
      label={label}
      tooltip={false}
      title={title}
      aria-pressed={saved}
      className={saved ? "text-cream-bright" : undefined}
      onClick={props.onBookmark}
    >
      <Star {...toolbarIconProps} fill={saved ? "currentColor" : "none"} />
    </IconButton>
  );
}
