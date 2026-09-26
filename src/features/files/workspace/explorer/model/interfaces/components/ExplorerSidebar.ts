import type { ExplorerLibrarySnapshot, MountedDevice, ProviderRemote } from "@/native/contracts";
export interface ExplorerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  library: ExplorerLibrarySnapshot | null;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  onNavigate: (path: string) => void;
  onRefreshDevices: () => void;
  onOpenInNewTab: (path: string, title?: string) => void;
  onManageRemotes: () => void;
  onAddRemote: () => void;
  /** Desktop views choose and retain folders through the host picker. */
  onChooseFolder?: () => void;
  onUnpinPinnedPath: (path: string) => void;
}
