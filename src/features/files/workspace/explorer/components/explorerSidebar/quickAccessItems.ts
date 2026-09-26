import { Clock3, Download, FileText, Home, Monitor, Star, Trash2 } from "lucide-react";
import type { ExplorerSidebarProps } from "../../model/interfaces/components/ExplorerSidebar";
import type { QuickAccessItem } from "../../model/types/components/ExplorerSidebar";
export type QuickAccessOptions = Pick<ExplorerSidebarProps, "homePath">;
export function buildQuickAccessItems(options: QuickAccessOptions): QuickAccessItem[] {
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
