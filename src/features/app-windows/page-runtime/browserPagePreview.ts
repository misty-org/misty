import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import type { PagePreview } from "./browserRuntimeTypes";

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
