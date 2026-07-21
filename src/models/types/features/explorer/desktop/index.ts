import {
  Archive,
  AppWindow,
  ArrowUp,
  ArrowRightLeft,
  ChevronRight,
  Clipboard,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FilePlus,
  Eye,
  FlaskConical,
  Folder,
  FolderPlus,
  Hash,
  Info,
  Link,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PanelTopClose,
  Pencil,
  Pin,
  Puzzle,
  RefreshCcw,
  Rows2,
  Scissors,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { readText, writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { MultiPanelWorkspace } from "@/features/workspace";
import { useTransientScrollbars } from "@/hooks/useTransientScrollbars";
import { hasTauriInternals } from "@/platform/tauri";
import { isAndroidBuild } from "@/platform/buildTarget";
import { useAppStore } from "@/stores/app";
import {
  clipboardApplyShared,
  clipboardPublishImageBytes,
  clipboardPublishShared,
  clipboardSetLocal,
  clipboardSharedImageBytes,
  clipboardWriteFileRefs,
  archiveCreate,
  archiveExtract,
  archiveList,
  devicesSnapshot,
  compareApplyTextMerge,
  compareFiles,
  compareFolders,
  duplicatesCancel,
  duplicatesHashRemoteCandidates,
  duplicatesScan,
  explorerListDirectory,
  explorerPreviewItem,
  explorerPrepareDragItems,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  fileToolsChecksum,
  fileToolsCreateSymlink,
  fileToolsReadSymlink,
  openTerminalAtPath,
  operationQueueRedo,
  operationQueueUndo,
  pluginCommandRun,
  pluginCommandsSnapshot,
  pluginPanelRender,
  providersJobStatus,
  providersVerifyResult,
  providersVerifyStart,
  shortcutsSnapshot,
  transfersSnapshot,
  androidGrantLocalFolder,
  androidAllFilesAccessStatus,
  androidOpenAllFilesAccessSettings,
} from "@/stores/backend";
import { ExplorerPane } from "@/features/explorer/components/ExplorerPane";
import { ExplorerSidebar } from "@/features/explorer/components/ExplorerSidebar";
import type { AndroidLocalGrantRequest } from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
import {
  ExplorerPaneToolbarActions,
  ExplorerToolbar,
} from "@/features/explorer/components/ExplorerToolbar";
import type { ExplorerLocationResult } from "@/features/explorer/components/ExplorerToolbar";
import {
  LibraryWorkspace,
  libraryWorkspacePath,
} from "@/features/explorer/components/LibraryWorkspace";
import { FileInspector } from "@/features/explorer/components/FileInspector";
import { ExplorerLoadingShell } from "@/features/explorer/components/ExplorerLoadingShell";
import {
  explorerWorkspaceNeedsSave,
  scheduleExplorerWorkspaceSave,
  selectedEntryForPane,
  selectedDeletePathsForPane,
  useExplorerStore,
  validateBatchRenameItems,
} from "@/stores/explorer";
import type {
  ExplorerBatchRenameItem,
  ExplorerDialogState,
  ExplorerInlineEditState,
  ExplorerNotification,
  ExplorerSortColumn,
} from "@/stores/explorer";
import { maxMultiPanelPanes, useMultiPanelStore } from "@/features/workspace";
import { ProvidersWorkspacePanel } from "@/pages/Providers/desktop";
import { useProvidersStore } from "@/stores/providers";
import type {
  AndroidAllFilesAccessStatus,
  ClipboardPayload,
  ExplorerLibrarySnapshot,
  FileEntry,
  MountedDevice,
  PluginCommandEntry,
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
  ProviderRemote,
  TransferRecord,
  DuplicateGroup,
  DuplicateScanResult,
  CompareFilesResult,
  CompareFolderRow,
  CompareFoldersResult,
  PasteItem,
} from "@/models/interfaces/services/misty-api";
import type { MultiPanelTab } from "@/models/interfaces/workspace";
import { useOperationQueueStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { TransfersWorkspacePanel } from "@/pages/Transfers/desktop";
import { shortcutMapFromBindings, shortcutMatchesEvent } from "@/lib/shortcuts";
import type { ShortcutMap } from "@/models/types/lib/shortcuts";
import {
  selectAdvancedPreferences,
  selectAssistantPreferences,
  selectGeneralPreferences,
  selectShortcutPreferences,
  useSettingsStore,
} from "@/stores/app";
import {
  openCloudFolderBotChatWindow,
  openCloudFolderBotWindow,
} from "@/features/bots/cloudFolderBot";
import { errorText } from "@/lib/format";
import { clipboardImagePng } from "@/features/explorer/utils/clipboardImage";
import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";
import { revealSearchResultInPane } from "@/features/explorer/utils/searchNavigation";
import type { ExplorerSearchNavigationTarget } from "@/models/interfaces/features/explorer/utils/searchNavigation";
import { cx } from "@/features/explorer/desktop/ExplorerDesktopShared";
import { explorerShellStyles } from "@/features/explorer/desktop/ExplorerShellStyles";
import {
  ConnectedExplorerToolbar,
  ConnectedFileInspector,
  ExplorerPaneHeaderActions,
} from "@/features/explorer/desktop/ExplorerToolbarConnections";
import {
  defaultExplorerShortcutMap,
  executableShortcutCommands,
  runExplorerCommand,
  runPluginCommand,
  shortcutCommandForEvent,
} from "@/features/explorer/desktop/ExplorerCommands";
import {
  buildExplorerLocationResults,
  clamp,
  ExplorerBottomBar,
  mountedDevicesEqual,
  multiPanelWorkspaceNeedsSave,
  pluginCommandsEqual,
  pluginPanelsEqual,
  resolveMountRoot,
  resolvePreferredWorkspaceRoot,
  workspaceSearchPaths,
} from "@/features/explorer/desktop/ExplorerWorkspaceUtils";
import {
  ExplorerNotifications,
  ExplorerRenameStatus,
} from "@/features/explorer/desktop/ExplorerDesktopStatus";
import {
  canOpenTerminalPath,
  ExplorerPluginTabContent,
  ExplorerPluginTabHeader,
  ExplorerTray,
  isChromeTabPath,
  isRemotesTabPath,
  isTransfersTabPath,
  openTransfersTab,
  parsePluginTabPath,
  toggleActiveTabPanelVisibility,
} from "@/features/explorer/desktop/ExplorerDesktopPlugins";
import { ExplorerDialog } from "@/features/explorer/desktop/ExplorerBatchRenameDialog";
import { CompareDialog } from "@/features/explorer/desktop/ExplorerCompareDialog";
import type { CompareDialogSeed } from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
import { DuplicateFinderDialog } from "@/features/explorer/desktop/ExplorerDuplicateFinderDialog";
import {
  compareSeedForPane,
  ExplorerContextMenu,
  openCompareWith,
} from "@/features/explorer/desktop/ExplorerContextMenu";
import { ExplorerDragProvider } from "@/features/explorer/drag/ExplorerDragContext";

export type ResizeTarget = "sidebar" | "preview" | null;
