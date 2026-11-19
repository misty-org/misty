import type { AiSurfaceAdapter } from "@/features/agents";
import { useAiSurfaceAdapter } from "@/features/agents";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { CollectionPage } from "@/shared/ui";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { SpaceLibraryOverlays } from "./components/SpaceLibraryOverlays";
import { SpaceLibraryStatus } from "./components/SpaceLibraryStatus";
import { LibraryEntryHeader } from "./components/LibraryEntryHeader";
import { LibraryItemsRegion } from "./library-surfaces/LibraryItemsRegion";
import { SpaceLibraryProvider } from "./SpaceLibraryContext";
import { LibraryCanEditContext } from "./SpaceLibraryPrimitives";
import { useSpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import { useSpaceLibraryData } from "./useSpaceLibraryData";
import { useSpaceLibraryItemActions } from "./useSpaceLibraryItemActions";
import { useLibraryItemLink } from "./library-data/useLibraryItemLink";
import { libraryItemMIME } from "./library-primitives/libraryMediaTypes";
import { libraryMediaKind } from "./library-viewer/libraryMediaKind";
import type { SpaceLibraryItem } from "../api/dto/entities";

/** The most selected photos the agent is told about: as many as one image edit changes. */
const selectedPhotosMost = 50;
/**
 * The Media page of one Space: its files, with photos and videos opening in their editors.
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
    // The photos picked in the grid, by item id and name, so "brighten these" has a referent: the
    // agent edits them together with image_edit's item_ids.
    const allPhotos = selectedItems.filter(isPhoto);
    const photos = allPhotos.slice(0, selectedPhotosMost);
    const picked = photos.length
      ? JSON.stringify({
          selected_photos: photos.map((item) => ({ item_id: item.id, name: item.display_name })),
          ...(allPhotos.length > photos.length
            ? { more_selected: allPhotos.length - photos.length }
            : {}),
        })
      : "";
    return {
      surfaceId: "media",
      label: selectedItems.length
        ? `${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} in Media`
        : "Media",
      getContext: () =>
        selectedItems.slice(0, 12).map((item) => ({
          kind: "library.item",
          id: item.id,
          title: item.display_name,
          privacy: "shared" as const,
          spaceId,
          href: `/spaces/${encodeURIComponent(spaceId)}/media?item=${encodeURIComponent(item.id)}`,
          revision: item.version,
        })),
      getSelection: () =>
        picked
          ? {
              kind: "objects",
              content: picked,
              object: { kind: "library.selection", id: `${spaceId}:photos`, spaceId },
              anchors: { surface: "media", photos: photos.length },
              contentHash: selectionHash(picked),
            }
          : null,
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
            <SpaceLibraryStatus />
            <div className="flex min-h-0 flex-1 flex-col">
              <LibraryItemsRegion />
            </div>
          </>
          <SpaceLibraryOverlays />
        </CollectionPage>
      </LibraryCanEditContext.Provider>
    </SpaceLibraryProvider>
  );
}
function isPhoto(item: SpaceLibraryItem) {
  return libraryMediaKind(libraryItemMIME(item), item.file.intrinsic_metadata).isImage;
}

function selectionHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

const collectionTitles: Record<string, string> = {
  recent: "Media",
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
  return collectionTitles[data.collection] || "Media";
}
