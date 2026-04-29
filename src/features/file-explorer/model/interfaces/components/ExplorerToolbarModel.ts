import type { PluginCommandEntry } from "@/services/misty/model/misty-api";
import type {
  ExplorerCommandQueryMode,
  ExplorerSortColumn,
  ExplorerSortState,
  ExplorerViewMode,
} from "../../../store";
import type { ExplorerSearchNavigationTarget } from "../utils/searchNavigation";

export interface ExplorerLocationResult {
  id: string;
  label: string;
  path: string;
  subtitle: string;
  badge: string;
}

export interface ExplorerCommandPaletteEntry {
  id: string;
  label: string;
  hint: string;
  group?: "Explorer" | "Extension";
  pluginName?: string;
}

export interface ExplorerToolbarProps {
  paneId: string;
  path: string;
  commandQuery: string;
  commandQueryMode: ExplorerCommandQueryMode;
  viewMode: ExplorerViewMode;
  sort: ExplorerSortState;
  showHidden: boolean;
  selectedCount: number;
  selectedEntryPath: string | null;
  hasRemoteSelection: boolean;
  canOpenWithSelected: boolean;
  canCalculateDirectorySizes: boolean;
  locationResults: ExplorerLocationResult[];
  pluginCommands: PluginCommandEntry[];
  onNavigate: (path: string) => void;
  onNavigateLocation: (path: string) => void;
  onNavigateSearchResult: (target: ExplorerSearchNavigationTarget) => void;
  backPath: string | null;
  forwardPath: string | null;
  parentPath: string | null;
  canCreateFile: boolean;
  canCreateFolder: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoTitle: string;
  redoTitle: string;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
  onCommandQuery: (value: string) => void;
  onCommandQueryMode: (mode: ExplorerCommandQueryMode) => void;
  onViewMode: (mode: ExplorerViewMode) => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onRename: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSort: (column: ExplorerSortColumn) => void;
  onToggleHidden: () => void;
  onRefresh: () => void;
  onCalculateDirectorySizes: () => void;
  onDownload: () => void;
  onOpenWith: () => void;
  onCopyPath: (path: string) => void;
  onRunCommand: (commandId: string) => void;
}

export interface ExplorerPaneToolbarActionsProps {
  path: string;
  viewMode: ExplorerViewMode;
  itemScale: number;
  sort: ExplorerSortState;
  showHidden: boolean;
  selectedCount: number;
  selectedEntryPath: string | null;
  hasRemoteSelection: boolean;
  canOpenWithSelected: boolean;
  canCalculateDirectorySizes: boolean;
  onViewMode: (mode: ExplorerViewMode) => void;
  onItemScale: (scale: number) => void;
  onSort: (column: ExplorerSortColumn) => void;
  onToggleHidden: () => void;
  onRefresh: () => void;
  onCalculateDirectorySizes: () => void;
  onDownload: () => void;
  onOpenWith: () => void;
  onCopyPath: (path: string) => void;
}
