import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useLibraryAi as useAiSurfaceAdapter } from "@/features/spaces/library/libraryRuntime";
import { useLibraryTitle as useWorkspaceTabTitle } from "@/features/spaces/library/libraryRuntime";
import { ComingSoonSurface } from "@/shared/ui";
import { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import { Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { SpaceLibraryCollectionOverview } from "./components/SpaceLibraryCollections";
import { SpaceLibraryOverlays } from "./components/SpaceLibraryOverlays";
import { SpaceLibraryTopChrome } from "./components/SpaceLibraryStatus";
import { AlbumsIndex } from "./librarySurfaces/AlbumsIndex";
import { DateGroupIndex } from "./librarySurfaces/DateGroupIndex";
import { DuplicatesIndex } from "./librarySurfaces/DuplicatesIndex";
import { ImportHistoryIndex } from "./librarySurfaces/ImportHistoryIndex";
import { LibraryCollectionHeader } from "./librarySurfaces/LibraryCollectionHeader";
import { LibraryItemsRegion } from "./librarySurfaces/LibraryItemsRegion";
import { MemoryControls } from "./librarySurfaces/MemoryControls";
import { SharedReferencesIndex } from "./librarySurfaces/SharedReferencesIndex";
import { SpaceLibraryProvider } from "./SpaceLibraryContext";
import { LibraryCanEditContext } from "./SpaceLibraryPrimitives";
import { useSpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import { useSpaceLibraryData } from "./useSpaceLibraryData";
import { useSpaceLibraryItemActions } from "./useSpaceLibraryItemActions";

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
  const presentation = useSurfacePresentation();
  const mobile = presentation !== "desktop";
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadQueryConsumedRef = useRef(false);
  const itemActions = useSpaceLibraryItemActions(data);
  const collectionActions = useSpaceLibraryCollectionActions(data, itemActions);
  const { canUploadLibrary, setFilePickerOpen } = data;
  const mobileTitle = libraryWorkspaceTitle(data);
  const openUpload = useCallback(() => setFilePickerOpen(true), [setFilePickerOpen]);
  const chromeConfig = useMemo(
    () => ({
      title: mobileTitle,
      level: "root" as const,
      primaryAction: canUploadLibrary
        ? {
            id: "upload-library-item",
            label: "Upload",
            icon: Upload,
            onPress: openUpload,
          }
        : undefined,
    }),
    [canUploadLibrary, mobileTitle, openUpload],
  );
  useMobileSurfaceChrome(chromeConfig);
  useWorkspaceTabTitle(workspaceTabId, libraryWorkspaceTitle(data));
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
          prompt:
            "Synthesize the selected Library items from their authorized metadata and available intelligence. Cite each item used.",
        },
        {
          id: "library-organize",
          label: "Organize",
          prompt:
            "Suggest tags, captions, groupings, and album organization for the selected items. Do not change metadata.",
        },
        {
          id: "library-compare",
          label: "Compare",
          prompt:
            "Compare the selected items, noting relationships, duplicates, and meaningful differences.",
        },
        {
          id: "library-find-related",
          label: "Find related",
          prompt:
            "Describe semantic searches that would find related Library items and explain why.",
        },
      ],
    };
  }, [data.selectedItems, spaceId]);
  useAiSurfaceAdapter(aiAdapter);

  useEffect(() => {
    if (searchParams.get("upload") !== "1") {
      uploadQueryConsumedRef.current = false;
      return;
    }
    if (uploadQueryConsumedRef.current) return;
    uploadQueryConsumedRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("upload");
    setSearchParams(next, { replace: true });
    if (canUploadLibrary) setFilePickerOpen(true);
  }, [canUploadLibrary, searchParams, setFilePickerOpen, setSearchParams]);

  if (data.collection === "memory") {
    return <ComingSoonSurface feature="Library memories" />;
  }

  return (
    <SpaceLibraryProvider value={{ data, itemActions, collectionActions }}>
      <LibraryCanEditContext.Provider value={data.canEditLibrary}>
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent">
          <SpaceLibraryTopChrome />
          <div
            className={`min-h-0 overflow-auto bg-transparent pb-6 ${mobile ? "px-3 pt-3" : "px-5 pt-5"}`}
          >
            <DateGroupIndex />
            {data.collection === "collections" ? <SpaceLibraryCollectionOverview /> : null}
            <AlbumsIndex />
            <ImportHistoryIndex />
            <SharedReferencesIndex />
            <DuplicatesIndex />
            <LibraryCollectionHeader />
            <MemoryControls />
            <LibraryItemsRegion />
          </div>
          <SpaceLibraryOverlays />
        </div>
      </LibraryCanEditContext.Provider>
    </SpaceLibraryProvider>
  );
}

const collectionTitles: Partial<Record<string, string>> = {
  recent: "Library",
  months: "Months",
  years: "Years",
  "recent-days": "Recent days",
  utility: "Utilities",
  collections: "Collections",
  favorites: "Favorites",
  hidden: "Hidden",
  deleted: "Recently deleted",
  people: "People",
  albums: "Albums",
  groups: "Groups",
  memory: "Memories",
  trip: "Trips",
  map: "Map",
  duplicate: "Duplicates",
  shared: "Shared references",
  imports: "Imports",
};

function libraryWorkspaceTitle(data: ReturnType<typeof useSpaceLibraryData>): string {
  const displayItems = data.displayItems ?? [];
  const selectedItems = data.selectedItems ?? [];
  const viewedItem = displayItems.find((item) => item.id === data.selectedItemId);
  if (viewedItem?.display_name.trim()) return viewedItem.display_name.trim();
  if (selectedItems.length === 1 && selectedItems[0].display_name.trim()) {
    return selectedItems[0].display_name.trim();
  }
  return (
    data.currentAlbum?.name?.trim() ||
    data.currentAlbumFolder?.name?.trim() ||
    data.currentGroup?.name?.trim() ||
    data.currentPerson?.name?.trim() ||
    data.currentDiscoveryGroup?.title?.trim() ||
    data.currentDateGroup?.title?.trim() ||
    collectionTitles[data.collection] ||
    "Library"
  );
}
