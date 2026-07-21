import type { ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { CloudDownload, FolderOpen } from "lucide-react";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { devicesSnapshot, explorerListDirectory } from "@/stores/backend";
import type {
  DirectoryListing,
  FileEntry,
  MountedDevice,
  ProviderRemote,
} from "@/models/interfaces/services/misty-api";
import { FileBrowser } from "@/features/explorer/components/FileBrowser";
import { ExplorerPickerToolbar } from "@/features/explorer/components/ExplorerPickerToolbar";
import { errorText } from "@/lib/format";
import { useMultiPanelStore } from "@/features/workspace";
import { useAppStore } from "@/stores/app";
import { sortListing, useExplorerStore } from "@/stores/explorer";
import type { ExplorerSortColumn, ExplorerSortState } from "@/stores/explorer";
import { useProvidersStore } from "@/stores/providers";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  useSettingsStore,
} from "@/stores/app";

import type { MistyFilePickerMode } from "@/models/types/features/picker/FilePicker";

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  multiple?: boolean;
  title?: string;
  initialPath?: string | null;
  allowedExtensions?: string[];
  /** Source switcher rendered in the header when this picker is hosted by MistyPicker. */
  sourceToggle?: ReactNode;
  onCancel: () => void;
  onSelect: (path: string) => void;
  onSelectMany?: (paths: string[]) => void;
}
