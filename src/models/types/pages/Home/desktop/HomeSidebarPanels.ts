import {
  Clock3,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Monitor,
  Pin,
  Search,
  Server,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import type { MountedDevice, ProviderRemote } from "@/models/interfaces/services/misty-api";
import { providerIconForType } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { joinPath, titleFromPath } from "@/pages/Home/desktop/recentFileUtils";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Skeleton } from "@/ui";

export type HomeQuickAccessItem = {
  id: string;
  label: string;
  path: string;
  icon:
    | "desktop"
    | "documents"
    | "downloads"
    | "folder"
    | "home"
    | "pin"
    | "recent"
    | "starred"
    | "trash";
};

export type HomeSmartFolderItem = {
  id: string;
  name: string;
  query: string;
};

export type HomeTagItem = {
  key: string;
  name: string;
  count: number;
};

export type HomeSidebarPanelsProps = {
  devices: MountedDevice[];
  devicesLoading: boolean;
  onOpenDevice: (device: MountedDevice) => void;
  onOpenQuickAccess: (item: HomeQuickAccessItem) => void;
  onOpenRemote: (remote: ProviderRemote) => void;
  onOpenSmartFolder: (smartFolder: HomeSmartFolderItem) => void;
  onOpenTag: (tag: HomeTagItem) => void;
  quickAccessItems: HomeQuickAccessItem[];
  remotes: ProviderRemote[];
  remotesLoading: boolean;
  smartFolders: HomeSmartFolderItem[];
  smartFoldersLoading: boolean;
  tags: HomeTagItem[];
  tagsLoading: boolean;
  workspacePanel: ReactNode;
};
