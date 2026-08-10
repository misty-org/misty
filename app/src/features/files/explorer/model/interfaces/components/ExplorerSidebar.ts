import type {
  AndroidAllFilesAccessStatus,
  ExplorerLibrarySnapshot,
  FileEntry,
  MountedDevice,
  ProviderRemote,
} from "@/native/contracts";
import type { ExplorerWorkspaceEntry } from "../../../store";

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
  workspaceEntries: ExplorerWorkspaceEntry[];
  activeWorkspaceId: string;
  activeWorkspaceTitle: string;
  workspaceLocked?: boolean;
  onNavigate: (path: string) => void;
  onRefreshDevices: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (title: string) => void;
  onRenameWorkspace: (workspaceId: string, title: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onOpenInNewTab: (path: string, title?: string) => void;
  onManageRemotes: () => void;
  onAddRemote: () => void;
  androidLocal: boolean;
  androidAllFilesAccess: AndroidAllFilesAccessStatus | null;
  androidGrantedFolders: FileEntry[];
  onGrantLocalFolder: (request?: AndroidLocalGrantRequest) => void;
  onUnpinPinnedPath: (path: string) => void;
}

export interface AndroidLocalGrantRequest {
  label: string;
  targetNames: string[];
  initialDirectory: string;
  grantedPath?: string;
}
