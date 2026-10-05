import type { AiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import {
  useLibraryAi as useAiSurfaceAdapter,
  useLibraryTitle as useWorkspaceViewTitle,
} from "./LibraryRuntime";
import { CollectionPage } from "@/shared/ui";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { SpaceLibraryOverlays } from "./components/SpaceLibraryOverlays";
import { SpaceLibraryInlineStatus } from "./components/SpaceLibraryStatus";
import { LibraryEntryHeader } from "./components/LibraryEntryHeader";
import { LibraryItemsRegion } from "./librarySurfaces/LibraryItemsRegion";
import { SpaceLibraryProvider } from "./SpaceLibraryContext";
import { LibraryCanEditContext } from "./SpaceLibraryPrimitives";
import { useSpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import { useSpaceLibraryData } from "./useSpaceLibraryData";
import { useSpaceLibraryItemActions } from "./useSpaceLibraryItemActions";
import { useLibraryItemLink } from "./libraryData/useLibraryItemLink";

/**
 * The Library surface for one Space.
 *
 * Every section below decides for itself whether the current collection
 * concerns it, so adding a collection means adding one component here rather
 * than another branch in a shared conditional.
 */
export function SpaceLibrary({
  spaceId,
  workspaceTabId,
}: {
  spaceId: string;
  workspaceTabId?: string;
}) {
  const data = useSpaceLibraryData(spaceId);
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadQueryConsumedRef = useRef(false);
  const itemActions = useSpaceLibraryItemActions(data);
  const collectionActions = useSpaceLibraryCollectionActions(data, itemActions);
  const { canUploadLibrary, setFilePickerOpen } = data;
  useWorkspaceViewTitle(workspaceTabId, libraryWorkspaceTitle(data));
  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const selectedItems = data.selectedItems ?? [];
    return {
      surfaceId: "library",
      label: selectedItems.length
        ? `${selectedItems.length} Library item${selectedItems.length === 1 ? "" : "s"}`
        : "Library",
      getContext: () =>
        selectedItems.slice(0, 12).map((item) => ({
          kind: "library.item",
          id: item.id,
          title: item.display_name,
          privacy: "shared" as const,
          spaceId,
          href: `/spaces/${encodeURIComponent(spaceId)}/library?item=${encodeURIComponent(item.id)}`,
          revision: item.version,
        })),
      getSuggestedActions: () => [
        {
          id: "library-synthesize",
          label: "Synthesize",
          prompt: "Synthesize the selected files. Cite each file used.",
        },
        {
          id: "library-compare",
          label: "Compare",
          prompt: "Compare the selected files, noting relationships and meaningful differences.",
        },
      ],
    };
  }, [data.selectedItems, spaceId]);
  useAiSurfaceAdapter(aiAdapter);
  useLibraryItemLink(data, itemActions.loadMore);
  useEffect(() => {
    if (searchParams.get("upload") !== "1") {
      uploadQueryConsumedRef.current = false;
      return;
    }
    if (uploadQueryConsumedRef.current) return;
    uploadQueryConsumedRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("upload");
    setSearchParams(next, {
      replace: true,
    });
    if (canUploadLibrary) setFilePickerOpen(true);
  }, [canUploadLibrary, searchParams, setFilePickerOpen, setSearchParams]);
  return (
    <SpaceLibraryProvider
      value={{
        data,
        itemActions,
        collectionActions,
      }}
    >
      <LibraryCanEditContext.Provider value={data.canEditLibrary}>
        <CollectionPage>
          <>
            <LibraryEntryHeader />
            <SpaceLibraryInlineStatus />
            <div className="min-h-0">
              <LibraryItemsRegion />
            </div>
          </>
          <SpaceLibraryOverlays />
        </CollectionPage>
      </LibraryCanEditContext.Provider>
    </SpaceLibraryProvider>
  );
}
const collectionTitles: Record<string, string> = {
  recent: "Library",
  favorites: "Favorites",
  deleted: "Recently deleted",
};
function libraryWorkspaceTitle(data: ReturnType<typeof useSpaceLibraryData>): string {
  const displayItems = data.displayItems ?? [];
  const selectedItems = data.selectedItems ?? [];
  const viewedItem = displayItems.find((item) => item.id === data.selectedItemId);
  if (viewedItem?.display_name.trim()) return viewedItem.display_name.trim();
  if (selectedItems.length === 1 && selectedItems[0].display_name.trim()) {
    return selectedItems[0].display_name.trim();
  }
  return collectionTitles[data.collection] || "Library";
}
