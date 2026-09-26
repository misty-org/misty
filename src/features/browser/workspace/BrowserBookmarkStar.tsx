import { Star } from "lucide-react";
import { useWorkspaceStore } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { useShortcutTitle } from "@/features/shortcuts";
import { browserToolbarStyles } from "./browserToolbarStyles";

/** Shows whether this page is bookmarked and opens the bookmark dialog. */
export function BrowserBookmarkStar(props: {
  url: string;
  iconButtonClass: string;
  onBookmark: () => void;
}) {
  const saved = useWorkspaceStore((state) =>
    state.savedWebsites.some((site) => site.fields.url === props.url),
  );
  const label = saved ? "Edit bookmark" : "Bookmark this page";
  const title = useShortcutTitle(label, "browser.bookmark");
  return (
    <button
      type="button"
      className={cn(props.iconButtonClass, saved && "text-cream-bright")}
      aria-label={label}
      aria-pressed={saved}
      title={title}
      onClick={props.onBookmark}
    >
      <Star {...browserToolbarStyles.icon} fill={saved ? "currentColor" : "none"} />
    </button>
  );
}
