import { useEffect } from "react";
import { BookmarkEditor } from "@/features/bookmarks/BookmarkEditor";
import { useBookmarkLibrary } from "@/features/bookmarks/library";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

export function BrowserBookmarkDialog(props: {
  request: number;
  url: string;
  title: string;
  suspensionReason: string;
}) {
  const overlay = useBrowserOverlayControl(props.suspensionReason);
  const { bookmarks } = useBookmarkLibrary();
  useEffect(() => {
    if (props.request) overlay.onOpenChange(true);
    // Each request captures the currently displayed page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request]);
  return overlay.open ? (
    <BookmarkEditor
      key={props.request}
      title={props.title}
      url={props.url}
      bookmark={bookmarks.find((b) => b.url === props.url)}
      onClose={() => overlay.onOpenChange(false)}
    />
  ) : null;
}
