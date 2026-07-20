import { Button } from "@/ui";
import {
  Briefcase,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Monitor,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MountedDevice, ProviderRemote } from "@/models/interfaces/services/misty-api";
import { providerIconForType } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import {
  buildDeviceEntries,
  dedupePinnedPathsForQuickAccess,
  deviceCapacityLabel,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
  saveSidebarCollapsedState,
  sidebarStyles,
  SidebarSectionHeader,
} from "@/features/explorer/components/ExplorerSidebarSupport";
import type { SidebarCollapsedState } from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";

export interface ExplorerPickerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  activeWorkspaceTitle: string;
  onNavigate: (path: string) => void;
  onRefreshDevices: () => void;
}
