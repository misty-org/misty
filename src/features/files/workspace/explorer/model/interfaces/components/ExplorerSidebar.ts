import type { ExplorerLibrarySnapshot, MountedDevice } from "@/native/contracts";
export interface ExplorerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  library: ExplorerLibrarySnapshot | null;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  onNavigate: (path: string) => void;
  onRefreshDevices: () => void;
  onOpenInNewTab: (path: string, title?: string) => void;
  /** Desktop views choose and retain folders through the host picker. */
  onChooseFolder?: () => void;
  onUnpinPinnedPath: (path: string) => void;
}
