import { useMemo } from "react";
import { parseBrowserTabState, type WorkspaceTab } from "@/features/workspace";
import { useBrowserRuntimeStore, type PagePreview } from "@/features/webviews/browserRuntime";
import { isHomePreviewTab, type ContinueItem } from "./useContinueItems";

/** A cached capture of this website, with content we can render immediately. */
export function readyHomePreview(tab: WorkspaceTab, preview?: PagePreview): PagePreview | null {
  if (!isHomePreviewTab(tab) || preview?.url !== parseBrowserTabState(tab.state).url) return null;
  const document = preview.document;
  const hasDocument =
    !!document?.html.trim() &&
    Number.isFinite(document.width) &&
    document.width > 0 &&
    Number.isFinite(document.height) &&
    document.height > 0;
  const hasImage = /^data:image\/(png|jpeg);base64,\S+/.test(preview.dataUrl ?? "");
  if (!hasDocument && !hasImage) return null;
  return {
    ...preview,
    document: hasDocument ? document : null,
    dataUrl: hasImage ? preview.dataUrl : undefined,
  };
}

export function useHomePreviewItems(items: ContinueItem[], limit = Infinity): ContinueItem[] {
  const previews = useBrowserRuntimeStore((state) => state.previews);
  return useMemo(
    () => items.filter(({ tab }) => readyHomePreview(tab, previews[tab.id])).slice(0, limit),
    [items, limit, previews],
  );
}
