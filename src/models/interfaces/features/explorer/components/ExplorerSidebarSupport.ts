import { Button } from "@/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type {
  MountedDevice,
  SavedSearch,
  SavedSearchRule,
} from "@/models/interfaces/services/misty-api";
import { formatBytes } from "@/features/explorer/utils/fileFormat";

import type {
  WorkspaceDialogState,
  SmartFolderMatchMode,
  SmartFolderDialogState,
  QuickAccessMenuItem,
} from "@/models/types/features/explorer/components/ExplorerSidebarSupport";

export interface DeviceCustomizationState {
  nameOverrides: Record<string, string>;
  hiddenPaths: string[];
  customMountPaths: string[];
}

export interface SidebarCollapsedState {
  quickAccess: boolean;
  smartFolders: boolean;
  remote: boolean;
  devices: boolean;
}

export interface SidebarDeviceEntry extends MountedDevice {
  custom: boolean;
}

export interface SmartFolderDraft {
  id: string;
  name: string;
  query: string;
  matchMode: SmartFolderMatchMode;
  rules: SavedSearchRule[];
}
