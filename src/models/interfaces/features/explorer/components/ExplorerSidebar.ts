import { Button } from "@/ui";
import {
  Briefcase,
  Camera,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  Film,
  FileText,
  Folder,
  HardDrive,
  Home,
  Headphones,
  Image,
  Check,
  Mic2,
  Monitor,
  Music,
  Pencil,
  PinOff,
  Plus,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { savedSearchesDelete, savedSearchesSave, savedSearchesSnapshot } from "@/stores/backend";
import type {
  AndroidAllFilesAccessStatus,
  ExplorerLibrarySnapshot,
  FileEntry,
  MountedDevice,
  ProviderRemote,
  SavedSearch,
} from "@/models/interfaces/services/misty-api";
import { providerIconForType } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { errorText } from "@/lib/format";
import type { ExplorerWorkspaceEntry } from "@/stores/explorer";
import { useSearchStore } from "@/stores/explorer";
import {
  addHiddenQuickAccessPath,
  buildDeviceEntries,
  createSmartFolderDialogState,
  dedupePinnedPathsForQuickAccess,
  deviceCapacityLabel,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  normalizeSidebarPath,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
  saveDeviceCustomization,
  saveHiddenQuickAccessPaths,
  saveSidebarCollapsedState,
  sidebarStyles,
  SidebarSectionHeader,
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
  uniqueStrings,
  visibleSmartFolderRules,
} from "@/features/explorer/components/ExplorerSidebarSupport";
import {
  SmartFolderDialog,
  WorkspaceDialog,
} from "@/features/explorer/components/ExplorerSidebarDialogs";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import type {
  QuickAccessMenuItem,
  SmartFolderDialogState,
  WorkspaceDialogState,
} from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import { ExplorerDropTarget } from "@/features/explorer/drag/ExplorerDropTarget";

import type { QuickAccessItem } from "@/models/types/features/explorer/components/ExplorerSidebar";

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
