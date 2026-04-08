import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui";
import {
  AppWindow,
  Archive,
  ArrowRightLeft,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FilePlus,
  Folder,
  FolderPlus,
  Hash,
  Link,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCcw,
  Scissors,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { memo } from "react";
import type { ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  archiveCreate,
  archiveExtract,
  archiveList,
  fileToolsChecksum,
  fileToolsCreateSymlink,
  fileToolsReadSymlink,
  openTerminalAtPath,
  providersJobStatus,
  providersVerifyResult,
  providersVerifyStart,
} from "@/stores/backend";
import {
  selectedDeletePathsForPane,
  selectedPathsForPane,
  useExplorerStore,
} from "@/stores/explorer";
import { selectShortcutPreferences, useSettingsStore } from "@/stores/app";
import { errorText } from "@/lib/format";
import { useShallow } from "zustand/react/shallow";
import {
  clearSelectionsAcrossPanes,
  selectedCountAcrossPanes,
} from "@/features/explorer/desktop/ExplorerAssistantPanels";
import type { CompareDialogSeed } from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";

export type ContextMenuLeafItem = {
  id: string;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  onRun: () => void;
};

export type ContextMenuBranchItem = {
  id: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  items: ContextMenuLeafItem[];
};

export type ContextMenuEntry = ContextMenuLeafItem | ContextMenuBranchItem;
