import { BrowserDownloadsButton } from "@/features/browser/workspace";
import { BrowserMistyButton } from "@/features/browser/workspace/BrowserMistyPanel";
import { browserInternalUrl, useWorkspaceStore } from "@/features/workspace";

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

/** The chat panel's toggle, at a sidebar's bottom-right: your Space's chat beside the page. */
export function StripChat() {
  return (
    <div
      className="flex shrink-0 items-center"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
    >
      <BrowserMistyButton />
    </div>
  );
}
