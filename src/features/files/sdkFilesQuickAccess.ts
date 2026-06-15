import { Folder } from "lucide-react";
import { useMemo } from "react";
import { useSidebarQuickAccess } from "./explorer/components/explorerSidebar/useSidebarQuickAccess";
import type { SdkFilesStore } from "./sdkFilesStore";

/** Use the existing quick-access interactions with folders this view actually owns. */
export function createSdkFilesQuickAccess(files: SdkFilesStore) {
  return function useSdkFilesQuickAccess(options: Parameters<typeof useSidebarQuickAccess>[0]) {
    const folders = files.store((state) => state.folders);
    const items = useMemo(
      () => folders.map((folder) => ({ label: folder.name, path: folder.root, icon: Folder })),
      [folders],
    );
    return useSidebarQuickAccess({ ...options, items });
  };
}
