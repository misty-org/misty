import { listen } from "@tauri-apps/api/event";
import { browserRuntimeId } from "@/features/browser";
import { useWorkspaceStore } from "@/features/workspace";
import { extensionsNative } from "./native";

/**
 * Popup-type windows an extension opens (a game or panel from its toolbar
 * button) float as small windows, as in Chrome. Each is a tab in a workspace
 * window of its own whose page is moved into the floating host; this tracks
 * the pair so closing either side closes the other.
 */
const popups = new Map<string, { host: string; windowId: string }>();

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Floats the popup's page. The page is created once its window is showing, so
 * this waits for it, then returns the person to the window they were in.
 * Returns false when the page could not be moved; it then stays a window.
 */
export async function floatExtensionPopup(
  view: Parameters<typeof browserRuntimeId>[0],
  windowId: string,
  popup: { name?: string; width?: number; height?: number },
  previousWindow: string | null | undefined,
): Promise<boolean> {
  const tab = browserRuntimeId(view);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const host = await extensionsNative.popupOpen(
        tab,
        popup.name || "Extension",
        popup.width ?? 380,
        popup.height ?? 520,
      );
      popups.set(tab, { host, windowId });
      if (previousWindow) useWorkspaceStore.getState().switchWindow(previousWindow);
      return true;
    } catch {
      await pause(150);
    }
  }
  return false;
}

/** The extension closed the popup's tab or window. */
export function closeExtensionPopup(match: { tabId?: string; windowId?: string }) {
  for (const [tab, popup] of popups) {
    if (tab === match.tabId || popup.windowId === match.windowId)
      void extensionsNative.popupClose(popup.host).catch(() => undefined);
  }
}

/** The person closed a popup window: its tab and workspace window go too. */
export function watchExtensionPopups() {
  const stop = listen<{ action?: string; tab?: string }>(
    "misty://extension-popup",
    ({ payload }) => {
      const popup = payload.tab ? popups.get(payload.tab) : undefined;
      if (payload.action !== "closed" || !payload.tab || !popup) return;
      popups.delete(payload.tab);
      useWorkspaceStore.getState().closeWindow(popup.windowId);
    },
  );
  return () => void stop.then((unlisten) => unlisten());
}
