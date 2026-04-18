import { Clock3, Download, FileText, Folder, Home, Monitor, Star, Trash2 } from "lucide-react";
import type { QuickAccessItem } from "@/models/types/features/explorer/components/ExplorerSidebar";
import type { ExplorerSidebarProps } from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
import { androidSuggestedLocalFolders, normalizeAndroidLocalName } from "./sidebarAndroid";

export type QuickAccessOptions = Pick<
  ExplorerSidebarProps,
  "androidLocal" | "androidAllFilesAccess" | "androidGrantedFolders" | "homePath"
>;

/**
 * The fixed Quick access rows for the current platform.
 *
 * Desktop gets the standard home folders. Android has three shapes: full
 * storage access (real paths), no access yet (grant-request placeholders), or
 * per-folder grants already collected.
 */
export function buildQuickAccessItems(options: QuickAccessOptions): QuickAccessItem[] {
  if (!options.androidLocal) {
    return [
      { label: "Home", icon: Home, path: options.homePath },
      { label: "Desktop", icon: Monitor, path: `${options.homePath}/Desktop` },
      { label: "Documents", icon: FileText, path: `${options.homePath}/Documents` },
      { label: "Downloads", icon: Download, path: `${options.homePath}/Downloads` },
      { label: "Recent", icon: Clock3, path: "misty://recent" },
      { label: "Starred", icon: Star, path: "misty://starred" },
      { label: "Trash", icon: Trash2, path: "misty://trash" },
    ];
  }

  const storageRoot =
    options.androidAllFilesAccess?.granted && options.androidAllFilesAccess.storageRoot
      ? options.androidAllFilesAccess.storageRoot.replace(/\/+$/, "")
      : null;
  if (storageRoot) {
    return [
      { label: "Local", icon: Folder, path: storageRoot },
      ...androidSuggestedLocalFolders.map((item) => ({
        label: item.label,
        icon: item.icon,
        path: `${storageRoot}/${item.initialDirectory}`,
      })),
      { label: "Recent", icon: Clock3, path: "misty://recent" },
      { label: "Starred", icon: Star, path: "misty://starred" },
      { label: "Trash", icon: Trash2, path: "misty://trash" },
    ];
  }

  return [
    {
      label: "Local",
      icon: Folder,
      path: options.homePath,
      grantRequest: { label: "Local", targetNames: [], initialDirectory: "" },
    },
    ...androidSuggestedLocalFolders.map((item) => {
      const granted = options.androidGrantedFolders.find((folder) =>
        item.targetNames.includes(normalizeAndroidLocalName(folder.name)),
      );
      const path = granted?.path ?? `misty://local/grant/${normalizeAndroidLocalName(item.label)}`;
      return {
        label: item.label,
        icon: item.icon,
        path,
        grantRequest: {
          label: item.label,
          targetNames: item.targetNames,
          initialDirectory: item.initialDirectory,
          grantedPath: granted?.path,
        },
      };
    }),
    { label: "Recent", icon: Clock3, path: "misty://recent" },
    { label: "Starred", icon: Star, path: "misty://starred" },
    { label: "Trash", icon: Trash2, path: "misty://trash" },
  ];
}
