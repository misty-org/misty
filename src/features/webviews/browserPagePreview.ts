import type { WorkspaceView } from "@/features/workspace";
import { parseBrowserViewState } from "@/features/workspace/model";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";
import { invoke } from "@tauri-apps/api/core";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import type { PagePreview } from "./browserRuntimeTypes";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  browserWebviewSuspensions,
  visibleRuntimeIds,
} from "./browserRuntimeSets";

let previewGeneration = 0;
const pendingPreviews = new Set<string>();

/** Drops every preview a captured-before-the-change page might still deliver. */
export function invalidatePagePreviews() {
  previewGeneration += 1;
}

export function savePagePreview(tabId: string, preview: PagePreview) {
  useBrowserRuntimeStore.setState((runtime) => {
    const previews = { ...runtime.previews };
    delete previews[tabId];
    previews[tabId] = preview;
    let bytes = 0;
    for (const key of Object.keys(previews).reverse()) {
      bytes += (previews[key].dataUrl?.length ?? 0) + (previews[key].document?.html.length ?? 0);
      if (bytes > 32_000_000) delete previews[key];
    }
    return { previews };
  });
}

export function pagePreviewGeneration() {
  return previewGeneration;
}

/** Capture an already-rendered page. Background reads never bring it to the front. */
export async function captureBrowserPagePreview(
  tab: WorkspaceView,
  bounds: { width: number; height: number },
  stillCurrent: () => boolean,
  background = false,
  previewRuntimeId?: string,
): Promise<void> {
  const state = parseBrowserViewState(tab.state);
  const id = previewRuntimeId ?? browserRuntimeId(tab);
  if (
    isIncognitoWindow() ||
    !/^https?:\/\//i.test(state.url) ||
    (!background && (!visibleRuntimeIds.has(id) || browserWebviewSuspensions.size > 0)) ||
    useBrowserRuntimeStore.getState().loading[tab.id] ||
    pendingPreviews.has(id) ||
    bounds.width < 8 ||
    bounds.height < 8
  )
    return;
  const generation = previewGeneration;
  pendingPreviews.add(id);
  try {
    const result = await invoke<PagePreview>("browser_webview_preview_document", {
      request: { id },
    });
    if (!stillCurrent() || generation !== previewGeneration || result.url !== state.url) return;
    if (
      result.dataUrl &&
      (!/^data:image\/(png|jpeg);base64,/.test(result.dataUrl) || result.dataUrl.length > 8_000_000)
    ) {
      delete result.dataUrl;
    }
    if (
      result.document &&
      (typeof result.document.html !== "string" || result.document.html.length > 3_000_000)
    ) {
      delete result.document;
    }
    if (result.dataUrl || result.document) savePagePreview(tab.id, result);
  } catch {
    // A stopped or unsupported page remains resumable while no preview is available.
  } finally {
    pendingPreviews.delete(id);
  }
}

/** Prepare every browser card without focusing, navigating, or resizing its real tab. */
export async function prepareBrowserPagePreview(tab: WorkspaceView, stillCurrent: () => boolean) {
  const state = parseBrowserViewState(tab.state);
  if (isIncognitoWindow() || !/^https?:\/\//i.test(state.url) || !stillCurrent()) return;
  const existing = browserRuntimeCreated(tab);
  const id = existing ? browserRuntimeId(tab) : `preview-${crypto.randomUUID()}`;
  const generation = previewGeneration;
  const current = () => stillCurrent() && generation === previewGeneration;
  const profileId = state.profileId;
  try {
    if (!existing) {
      await invoke("browser_webview_create", {
        request: {
          id,
          previewOnly: true,
          workspaceTabId: tab.id,
          url: state.url,
          ...(profileId ? { profileId } : {}),
          x: 100_000,
          y: 0,
          width: 1440,
          height: 900,
          theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        },
      });
    }
    for (let attempt = 0; attempt < 6 && current(); attempt++) {
      await captureBrowserPagePreview(tab, { width: 1440, height: 900 }, current, true, id);
      if (!current()) break;
      if (useBrowserRuntimeStore.getState().previews[tab.id]?.url === state.url) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } finally {
    if (!existing)
      await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
  }
}
