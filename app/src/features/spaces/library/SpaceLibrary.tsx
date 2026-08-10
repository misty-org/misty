import { useEffect, useRef } from "react";
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
export function SpaceLibrary({ spaceId }: { spaceId: string }) {
  const data = useSpaceLibraryData(spaceId);
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadQueryConsumedRef = useRef(false);
  const itemActions = useSpaceLibraryItemActions(data);
  const collectionActions = useSpaceLibraryCollectionActions(data, itemActions);
  const { canUploadLibrary, setFilePickerOpen } = data;

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

  return (
    <SpaceLibraryProvider value={{ data, itemActions, collectionActions }}>
      <LibraryCanEditContext.Provider value={data.canEditLibrary}>
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent">
          <SpaceLibraryTopChrome />
          <div className="min-h-0 overflow-auto bg-transparent px-5 pb-6 pt-5">
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
