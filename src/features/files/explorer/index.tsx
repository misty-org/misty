import { lazy, Suspense } from "react";
import { ExplorerLoadingShell } from "./components/ExplorerLoadingShell";

export * from "./components/ExplorerPickerToolbar";
export {
  buildDeviceEntries,
  dedupePinnedPathsForQuickAccess,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
} from "./components/ExplorerSidebarSupport";
export * from "./components/FileBrowser";
export { FileNameIcon } from "./components/FileBrowserIcons";
export * from "./components/GlobalPreview";
export { MediaSearchViewer } from "./components/MediaSearchViewer";
export * from "./drag/ExplorerDragContext";
export * from "./drag/ExplorerDropTarget";
export type * from "./model/stores/media/interfaces/useMediaSearchServerStore";
export type * from "./model/stores/media/interfaces/useSmartLibraryServerStore";
export * from "./store";
export * from "./utils/fileFormat";
export * from "./utils/globalSearch";
export * from "./utils/librarySearch";
export * from "./utils/searchNavigation";

const loadDesktopFilesPage = () => import("./workspace");
const DesktopFilesPage = lazy(loadDesktopFilesPage);

export function preloadDesktopFilesPage(): Promise<unknown> {
  return loadDesktopFilesPage();
}

export default function FilesPage(props: {
  embedded?: boolean;
  workspaceId?: string;
  workspaceTitle?: string;
}) {
  return (
    <Suspense fallback={<ExplorerLoadingShell />}>
      <DesktopFilesPage {...props} />
    </Suspense>
  );
}
