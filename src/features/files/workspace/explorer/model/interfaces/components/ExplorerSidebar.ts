import type {
  AndroidAllFilesAccessStatus,
  ExplorerLibrarySnapshot,
  FileEntry,
  MountedDevice,
  ProviderRemote,
} from "@/native/contracts";
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
  androidLocal: boolean;
  androidAllFilesAccess: AndroidAllFilesAccessStatus | null;
  androidGrantedFolders: FileEntry[];
  onGrantLocalFolder: (request?: AndroidLocalGrantRequest) => void;
  /** SDK desktop views choose and retain folders through the host picker. */
  onChooseFolder?: () => void;
  onUnpinPinnedPath: (path: string) => void;
}

export interface AndroidLocalGrantRequest {
  label: string;
  targetNames: string[];
  initialDirectory: string;
  grantedPath?: string;
}
