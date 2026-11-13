import { invoke } from "@/native/invoke";
import { setBrowserRuntimeKeepLive } from "@/features/app-windows";
import { agentPageBounds } from "../tabs/agentTabs";
import { readPickedElement, type PickedElement } from "./pickedElement";

export interface PreviewPick {
  element: PickedElement;
  /** A picture of the element, where the page could be captured. */
  image?: string;
}

/** The pages this load of the window opened. */
const open = new Set<string>();
const openKey = "misty.preview.pages";

/** Writes down which pages are open, where a reload of the window can still read it. */
function record(): void {
  try {
    sessionStorage.setItem(openKey, JSON.stringify([...open]));
  } catch {
    // Without it, a page left by a reload stays until the app quits.
  }
}

/**
 * Closes pages an earlier load of this window left behind. A native page outlives a reload of
 * the window, and nothing unmounts to close it.
 */
async function closeLeftovers(): Promise<void> {
  let recorded: unknown = [];
  try {
    recorded = JSON.parse(sessionStorage.getItem(openKey) ?? "[]");
  } catch {
    return;
  }
  if (!Array.isArray(recorded)) return;
  const left = recorded.filter(
    (id): id is string => typeof id === "string" && id.startsWith("preview-") && !open.has(id),
  );
  await Promise.all(
    left.map((id) => invoke("browser_webview_close", { request: { id } }).catch(() => undefined)),
  );
}

/**
 * The preview's native page. It is one of Misty's own pages (the kind an agent's tab is), so the
 * panel can place it over its frame and Misty can run the picker in it; a cross-origin frame in
 * the app window could be neither scripted nor captured.
 */
export const previewApi = {
  /** Whether anything answers at `url`, so a dev server that isn't running is said plainly. */
  reachable: (url: string) => invoke<boolean>("project_preview_reachable", { url }),
  /** Opens a page at `url`, parked out of sight until the panel places it. Returns its id. */
  async open(url: string): Promise<string> {
    await closeLeftovers();
    const id = `preview-${crypto.randomUUID()}`;
    open.add(id);
    record();
    try {
      await invoke("browser_webview_create", {
        request: { id, scopeId: id, url, originSpaceId: "", ...agentPageBounds() },
      });
      await invoke("browser_webview_hide", { request: { id, keepLive: true } });
    } catch (reason) {
      await previewApi.close(id);
      throw reason;
    }
    // The window's sweep of pages no tab owns leaves this one alone.
    setBrowserRuntimeKeepLive(id, true);
    return id;
  },
  async close(id: string): Promise<void> {
    setBrowserRuntimeKeepLive(id, false);
    open.delete(id);
    record();
    await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
  },
  navigate: (id: string, url: string) =>
    invoke<void>("browser_webview_navigate", { request: { id, url } }),
  reload: (id: string) => invoke<void>("browser_webview_reload", { request: { id } }),
  /** Resolves once the page's first load is over, true if it loaded. */
  loaded: (id: string) => invoke<boolean>("browser_webview_await_load", { request: { id } }),
  /** Starts keeping the page's errors for the next pick. */
  watch: (id: string) => invoke<void>("project_preview_watch", { id }),
  /** Waits for the person to pick an element; nothing when they cancel. */
  async pick(id: string): Promise<PreviewPick | null> {
    const picked = await invoke<{ element: unknown; image?: string | null } | null>(
      "project_preview_pick",
      { id },
    );
    const element = readPickedElement(picked?.element);
    if (!element) return null;
    const image = picked?.image?.startsWith("data:image/") ? picked.image : undefined;
    return { element, image };
  },
  cancelPick: (id: string) => invoke<void>("project_preview_cancel_pick", { id }),
};
