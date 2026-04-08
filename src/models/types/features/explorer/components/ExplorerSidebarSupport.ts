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
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";

export type WorkspaceDialogState =
  | { kind: "create"; workspaceId: ""; title: string }
  | { kind: "rename"; workspaceId: string; title: string }
  | { kind: "delete"; workspaceId: string; title: string }
  | null;

export type SmartFolderMatchMode = "all" | "any";

export type SmartFolderDialogState = { draft: SmartFolderDraft } | null;

export type QuickAccessMenuItem = {
  kind: "builtIn" | "pinned";
  label: string;
  path: string;
};
