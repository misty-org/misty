import {
  AppWindow,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Command,
  Download,
  Eye,
  FilePlus,
  Folder,
  FolderPlus,
  Grid2X2,
  Filter,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Scissors,
  Search,
  Trash2,
  Redo2,
  Undo2,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import { searchQuery } from "../../../api/misty";
import type { PluginCommandEntry, SearchResult } from "../../../api/types";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import {
  cx,
  fuzzyIncludes,
  OverflowMenuItem,
  paneToolbarActionStyles,
  searchResultSubtitle,
  toolbarStyles,
} from "./ExplorerToolbarSupport";
import {
  useExplorerStore,
  type ExplorerCommandQueryMode,
  type ExplorerSortColumn,
  type ExplorerSortState,
  type ExplorerViewMode,
} from "../../../stores/useExplorerStore";
import { breadcrumbSegments } from "../utils/fileFormat";
import { mergeLibrarySearchResults } from "../utils/librarySearch";
import { searchResultNavigationTarget } from "../utils/searchNavigation";
import type { ExplorerSearchNavigationTarget } from "../utils/searchNavigation";

export interface ExplorerLocationResult {
  id: string;
  label: string;
  path: string;
  subtitle: string;
  badge: string;
}

export type ExplorerCommandId =
  | "app.toggle_transfers"
  | "app.open_settings"
  | "app.toggle_plugin_launcher"
  | "clipboard.publish_shared"
  | "clipboard.apply_shared"
  | "search.toggle"
  | "explorer.new_tab"
  | "explorer.restore_tab"
  | "explorer.close_pane"
  | "explorer.restore_pane"
  | "explorer.split_vertical"
  | "explorer.split_horizontal"
  | "explorer.refresh"
  | "explorer.rename"
  | "explorer.batch_rename"
  | "explorer.duplicate_finder"
  | "explorer.compare_with"
  | "explorer.automation_rules"
  | "explorer.delete"
  | "explorer.download"
  | "explorer.open_with"
  | "explorer.copy"
  | "explorer.cut"
  | "explorer.paste"
  | "explorer.undo"
  | "explorer.redo"
  | "explorer.preview.toggle"
  | "explorer.sidebar.toggle"
  | "explorer.toggle_chat"
  | "explorer.toggle_mika"
  | "explorer.next_workspace"
  | "explorer.tab_1"
  | "explorer.tab_2"
  | "explorer.tab_3"
  | "explorer.tab_4"
  | "explorer.tab_5"
  | "explorer.tab_6"
  | "explorer.tab_7"
  | "explorer.tab_8"
  | "explorer.tab_9";

interface ExplorerCommandPaletteEntry {
  id: string;
  label: string;
  hint: string;
  group?: "Explorer" | "Extension";
  pluginName?: string;
}

const explorerCommands: ExplorerCommandPaletteEntry[] = [
  { id: "app.toggle_transfers", label: "Open Transfers", hint: "Show transfer history and active work" },
  { id: "app.open_settings", label: "Open Settings", hint: "Switch to application settings" },
  { id: "app.toggle_plugin_launcher", label: "Open Extensions", hint: "Open Extensions" },
  { id: "clipboard.publish_shared", label: "Publish Shared Clipboard", hint: "Send the current clipboard to shared devices" },
  { id: "clipboard.apply_shared", label: "Apply Shared Clipboard", hint: "Copy the latest shared clipboard payload locally" },
  { id: "search.toggle", label: "Search", hint: "Focus Explorer search for the active folder" },
  { id: "explorer.new_tab", label: "New Tab", hint: "Open another tab for the active folder" },
  { id: "explorer.restore_tab", label: "Restore Closed Tab", hint: "Restore the most recently closed tab" },
  { id: "explorer.close_pane", label: "Close Pane", hint: "Close the active split pane or tab" },
  { id: "explorer.restore_pane", label: "Restore Pane", hint: "Restore the most recently closed pane" },
  { id: "explorer.split_vertical", label: "Split Vertically", hint: "Add a side-by-side pane for the active folder" },
  { id: "explorer.split_horizontal", label: "Split Horizontally", hint: "Add a stacked pane for the active folder" },
  { id: "explorer.refresh", label: "Refresh", hint: "Reload the active folder" },
  { id: "explorer.rename", label: "Rename", hint: "Rename the selected item" },
  { id: "explorer.batch_rename", label: "Batch Rename", hint: "Preview and queue renames for selected items" },
  { id: "explorer.duplicate_finder", label: "Find Duplicates", hint: "Scan folders and queue reviewed cleanup" },
  { id: "explorer.compare_with", label: "Compare With", hint: "Compare the selected file or folder against another path" },
  { id: "explorer.automation_rules", label: "Automation Rules", hint: "coming soon..." },
  { id: "explorer.delete", label: "Delete", hint: "Delete the selected items" },
  { id: "explorer.download", label: "Download", hint: "Download selected remote items to Downloads" },
  { id: "explorer.open_with", label: "Open With", hint: "Choose an app for the selected file" },
  { id: "explorer.copy", label: "Copy", hint: "Copy selected items" },
  { id: "explorer.cut", label: "Cut", hint: "Move selected items with paste" },
  { id: "explorer.paste", label: "Paste", hint: "Paste into the active folder" },
  { id: "explorer.undo", label: "Undo", hint: "Undo the latest completed rename or move" },
  { id: "explorer.redo", label: "Redo", hint: "Redo the latest undone rename or move" },
  { id: "explorer.preview.toggle", label: "Toggle Preview", hint: "Show or hide the preview/details panel" },
  { id: "explorer.sidebar.toggle", label: "Toggle Sidebar", hint: "Show or hide the navigation sidebar" },
  { id: "explorer.toggle_chat", label: "Toggle Chat", hint: "Open or close the explorer chat overlay" },
  { id: "explorer.toggle_mika", label: "Toggle Mika", hint: "Mika AI is coming soon" },
  { id: "explorer.next_workspace", label: "Next Workspace", hint: "Cycle to the next explorer tab" },
  { id: "explorer.tab_1", label: "Select Tab 1", hint: "Switch to tab 1" },
  { id: "explorer.tab_2", label: "Select Tab 2", hint: "Switch to tab 2" },
  { id: "explorer.tab_3", label: "Select Tab 3", hint: "Switch to tab 3" },
  { id: "explorer.tab_4", label: "Select Tab 4", hint: "Switch to tab 4" },
  { id: "explorer.tab_5", label: "Select Tab 5", hint: "Switch to tab 5" },
  { id: "explorer.tab_6", label: "Select Tab 6", hint: "Switch to tab 6" },
  { id: "explorer.tab_7", label: "Select Tab 7", hint: "Switch to tab 7" },
  { id: "explorer.tab_8", label: "Select Tab 8", hint: "Switch to tab 8" },
  { id: "explorer.tab_9", label: "Select Tab 9", hint: "Switch to tab 9" },
];

const toolbarSortOptions: Array<{ column: ExplorerSortColumn; label: string }> = [
  { column: "name", label: "Name" },
  { column: "modified", label: "Modified" },
  { column: "size", label: "Size" },
  { column: "type", label: "Type" },
];

interface ExplorerToolbarProps {
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
  canGoBack: boolean;
  canGoForward: boolean;
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
  sort: ExplorerSortState;
  showHidden: boolean;
  selectedCount: number;
  selectedEntryPath: string | null;
  hasRemoteSelection: boolean;
  canOpenWithSelected: boolean;
  canCalculateDirectorySizes: boolean;
  onViewMode: (mode: ExplorerViewMode) => void;
  onSort: (column: ExplorerSortColumn) => void;
  onToggleHidden: () => void;
  onRefresh: () => void;
  onCalculateDirectorySizes: () => void;
  onDownload: () => void;
  onOpenWith: () => void;
  onCopyPath: (path: string) => void;
}

export const ExplorerToolbar = memo(function ExplorerToolbar(props: ExplorerToolbarProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newMenuPosition, setNewMenuPosition] = useState<CSSProperties>({
    left: 0,
    top: 0,
  });
  const [commandMenuPosition, setCommandMenuPosition] = useState<CSSProperties>({
    left: 0,
    top: 0,
  });
  const [indexedResults, setIndexedResults] = useState<SearchResult[]>([]);
  const [indexedSearching, setIndexedSearching] = useState(false);
  const [indexedError, setIndexedError] = useState<string | null>(null);
  const newMenuPopupRef = useRef<HTMLDivElement | null>(null);
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const commandSearchRef = useRef<HTMLLabelElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const commandMenuRef = useRef<HTMLDivElement | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(props.path);
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);
  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props.onRefresh, startRefreshSpin]);
  const commandMode = props.commandQuery.trimStart().startsWith(">");
  const commandFilter = commandMode ? props.commandQuery.trimStart().slice(1).trim().toLowerCase() : "";
  const searchMode = props.commandQueryMode === "search";
  const locationFilter = commandMode || !searchMode ? "" : props.commandQuery.trim().toLowerCase();
  const paletteCommands = useMemo(
    () => [
      ...explorerCommands,
      ...props.pluginCommands.map((command): ExplorerCommandPaletteEntry => ({
        id: command.id,
        label: command.label,
        hint: command.hint,
        group: "Extension",
        pluginName: command.pluginName,
      })),
    ],
    [props.pluginCommands],
  );
  const filteredCommands = useMemo(
    () => paletteCommands.filter((command) => {
      if (!commandFilter) return true;
      const haystack = `${command.id} ${command.label} ${command.hint} ${command.pluginName ?? ""} ${command.group ?? "Explorer"}`.toLowerCase();
      return haystack.includes(commandFilter);
    }),
    [commandFilter, paletteCommands],
  );
  const filteredLocations = useMemo(
    () => {
      if (!locationFilter) return [];
      return props.locationResults
        .filter((location) => {
          const haystack = `${location.label} ${location.path} ${location.subtitle} ${location.badge}`.toLowerCase();
          return fuzzyIncludes(haystack, locationFilter);
        })
        .slice(0, 8);
    },
    [locationFilter, props.locationResults],
  );
  const locationMode = searchFocused
    && !commandMode
    && Boolean(locationFilter)
    && (filteredLocations.length > 0 || indexedResults.length > 0 || indexedSearching || Boolean(indexedError));

  useEffect(() => {
    let canceled = false;
    const query = locationFilter.trim();
    if (!query) {
      setIndexedResults([]);
      setIndexedSearching(false);
      setIndexedError(null);
      return;
    }
    setIndexedSearching(true);
    setIndexedError(null);
    const timer = window.setTimeout(() => {
      void searchQuery({
        query,
        scope: "everything",
        currentPath: props.path,
        includeFiles: true,
        includeDirectories: true,
        includeHidden: false,
        limit: 8,
      })
        .then((results) => {
          if (canceled) return;
          setIndexedResults(mergeLibrarySearchResults(
            results,
            useExplorerStore.getState().library,
            query,
            { scope: "everything", currentPath: props.path, limit: 8 },
          ));
          setIndexedSearching(false);
        })
        .catch((error: unknown) => {
          if (canceled) return;
          const results = mergeLibrarySearchResults(
            [],
            useExplorerStore.getState().library,
            query,
            { scope: "everything", currentPath: props.path, limit: 8 },
          );
          setIndexedResults(results);
          setIndexedSearching(false);
          setIndexedError(results.length > 0 ? null : error instanceof Error ? error.message : String(error));
        });
    }, 160);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [locationFilter, props.path]);

  useEffect(() => {
    if (!pathEditing) setPathDraft(props.path);
  }, [pathEditing, props.path]);

  useLayoutEffect(() => {
    if (!pathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [pathEditing]);

  const positionNewMenu = useCallback(() => {
    const rect = newButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = 208;
    const viewportPadding = 8;
    const nextPosition = {
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
      top: rect.bottom + 6,
    };
    setNewMenuPosition((current) => {
      if (current.left === nextPosition.left && current.top === nextPosition.top) return current;
      return nextPosition;
    });
  }, []);

  const positionCommandMenu = useCallback(() => {
    const rect = commandSearchRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = Math.max(280, Math.min(rect.width, 420));
    const viewportPadding = 8;
    const nextPosition = {
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
      top: rect.bottom + 6,
      width: menuWidth,
    };
    setCommandMenuPosition((current) => {
      if (current.left === nextPosition.left && current.top === nextPosition.top && current.width === nextPosition.width) return current;
      return nextPosition;
    });
  }, []);

  useLayoutEffect(() => {
    if (newMenuOpen) positionNewMenu();
  }, [newMenuOpen, positionNewMenu]);

  useLayoutEffect(() => {
    if (commandMode || locationMode) positionCommandMenu();
  }, [commandMode, locationMode, positionCommandMenu]);

  useEffect(() => {
    if (!commandMode) return;
    commandInputRef.current?.focus();
  }, [commandMode]);

  useEffect(() => {
    const onSearchFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: string; mode?: "search" | "command" }>).detail;
      if (detail?.paneId !== props.paneId) return;
      setSearchFocused(true);
      window.requestAnimationFrame(() => {
        commandInputRef.current?.focus();
        commandInputRef.current?.select();
      });
    };
    window.addEventListener("misty:explorer-search-focus", onSearchFocus);
    return () => window.removeEventListener("misty:explorer-search-focus", onSearchFocus);
  }, [props.paneId]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!newButtonRef.current?.contains(target) && !newMenuPopupRef.current?.contains(target)) {
        setNewMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNewMenuOpen(false);
        newButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", positionNewMenu);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", positionNewMenu);
    };
  }, [newMenuOpen, positionNewMenu]);

  useEffect(() => {
    if (!commandMode && !locationMode) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!commandSearchRef.current?.contains(target) && !commandMenuRef.current?.contains(target)) {
        if (commandMode) props.onCommandQuery("");
        else setSearchFocused(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", positionCommandMenu);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", positionCommandMenu);
    };
  }, [commandMode, locationMode, positionCommandMenu, props.onCommandQuery]);

  const toggleNewMenu = () => {
    setNewMenuOpen((open) => !open);
  };

  const runCommand = (commandId: string) => {
    props.onRunCommand(commandId);
    props.onCommandQuery("");
  };

  const runLocation = (path: string) => {
    props.onNavigateLocation(path);
    setSearchFocused(false);
    props.onCommandQuery("");
  };

  const runIndexedResult = (result: SearchResult) => {
    props.onNavigateSearchResult(searchResultNavigationTarget(result));
    setSearchFocused(false);
    props.onCommandQuery("");
  };

  const beginPathEdit = useCallback(() => {
    setPathDraft(props.path);
    setPathEditing(true);
  }, [props.path]);

  const submitPathEdit = useCallback(() => {
    const target = pathDraft.trim();
    setPathEditing(false);
    setPathDraft(props.path);
    if (target) {
      props.onNavigateLocation(target);
    }
  }, [pathDraft, props.onNavigateLocation, props.path]);

  const cancelPathEdit = useCallback(() => {
    setPathEditing(false);
    setPathDraft(props.path);
  }, [props.path]);

  return (
    <header className={toolbarStyles.root}>
      <div className={toolbarStyles.navRow}>
        <div className={toolbarStyles.navButtons}>
          <button className={toolbarStyles.toolbarButton} disabled={!props.canGoBack} onClick={props.onBack}><ChevronLeft size={18} /></button>
          <button className={toolbarStyles.toolbarButton} disabled={!props.canGoForward} onClick={props.onForward}><ChevronRight size={18} /></button>
          <button className={toolbarStyles.toolbarButton} onClick={props.onParent}><ArrowUp size={18} /></button>
          <button
            className={toolbarStyles.toolbarButton}
            type="button"
            title="Refresh current folder"
            aria-label="Refresh current folder"
            onClick={runRefresh}
          >
            <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={17} />
          </button>
        </div>

        <div
          className={cx(toolbarStyles.pathBar, pathEditing && toolbarStyles.pathBarEditing)}
          title={pathEditing ? undefined : "Click empty space to edit path"}
          onClick={(event) => {
            if (event.target === event.currentTarget) beginPathEdit();
          }}
          onDoubleClick={beginPathEdit}
        >
          {pathEditing ? (
            <input
              ref={pathInputRef}
              className={toolbarStyles.pathInput}
              value={pathDraft}
              placeholder="Enter file path"
              spellCheck={false}
              onChange={(event) => setPathDraft(event.target.value)}
              onBlur={cancelPathEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitPathEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelPathEdit();
                }
              }}
            />
          ) : (
            breadcrumbSegments(props.path).map((segment, index) => (
              <button
                key={`${segment.path}-${index}`}
                className={toolbarStyles.pathButton}
                onClick={() => props.onNavigate(segment.path)}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {index > 0 ? <ChevronRight className={toolbarStyles.breadcrumbCaret} size={14} /> : null}
                {segment.label}
              </button>
            ))
          )}
        </div>

        <div className={toolbarStyles.commandSearchGroup}>
          <label ref={commandSearchRef} className={cx(toolbarStyles.commandSearch, commandMode && toolbarStyles.commandSearchMode)}>
            {props.commandQueryMode === "filter" && !commandMode ? <Filter size={18} /> : <Search size={18} />}
            <input
              ref={commandInputRef}
              className={toolbarStyles.commandInput}
              value={props.commandQuery}
              placeholder={props.commandQueryMode === "filter" ? "Filter current folder" : "Search or run command"}
              onFocus={() => setSearchFocused(true)}
              onChange={(event) => props.onCommandQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (commandMode) props.onCommandQuery("");
                  else setSearchFocused(false);
                } else if (commandMode && event.key === "Enter" && filteredCommands[0]) {
                  event.preventDefault();
                  runCommand(filteredCommands[0].id);
                } else if (locationMode && event.key === "Enter" && filteredLocations[0]) {
                  event.preventDefault();
                  runLocation(filteredLocations[0].path);
                } else if (locationMode && event.key === "Enter" && indexedResults[0]) {
                  event.preventDefault();
                  runIndexedResult(indexedResults[0]);
                }
              }}
            />
          </label>
          <div className={toolbarStyles.searchModeToggle} aria-label="Search input mode">
            <button
              type="button"
              className={cx(toolbarStyles.searchModeButton, props.commandQueryMode === "search" && toolbarStyles.searchModeButtonActive)}
              aria-label="Search mode"
              aria-pressed={props.commandQueryMode === "search"}
              title="Search"
              onClick={() => props.onCommandQueryMode("search")}
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              className={cx(toolbarStyles.searchModeButton, props.commandQueryMode === "filter" && toolbarStyles.searchModeButtonActive)}
              aria-label="Filter mode"
              aria-pressed={props.commandQueryMode === "filter"}
              title="Filter (*, ?, /regex/)"
              onClick={() => props.onCommandQueryMode("filter")}
            >
              <Filter size={15} />
            </button>
          </div>
        </div>
        {commandMode
          ? createPortal(
              <div
                ref={commandMenuRef}
                role="menu"
                aria-label="Explorer commands"
                style={{
                  ...commandMenuPosition,
                  position: "fixed",
                  zIndex: 2147483000,
                }}
                className={toolbarStyles.palette}
              >
                {filteredCommands.length > 0 ? filteredCommands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="menuitem"
                    className={toolbarStyles.paletteButton}
                    onClick={() => runCommand(command.id)}
                  >
                    <Command size={16} />
                    <span className={toolbarStyles.paletteText}>
                      <strong className={toolbarStyles.paletteTitle}>{command.label}</strong>
                      <small className={toolbarStyles.paletteSubtitle}>{command.group === "Extension" && command.pluginName ? `${command.pluginName} · ${command.hint}` : command.hint}</small>
                    </span>
                  </button>
                )) : <div className={toolbarStyles.paletteEmpty}>No explorer commands found.</div>}
              </div>,
              document.body,
            )
          : null}
        {locationMode
          ? createPortal(
              <div
                ref={commandMenuRef}
                role="menu"
                aria-label="Explorer locations"
                style={{
                  ...commandMenuPosition,
                  position: "fixed",
                  zIndex: 2147483000,
                }}
                className={toolbarStyles.palette}
              >
                {filteredLocations.length > 0 ? (
                  <>
                    <span className={toolbarStyles.paletteSection}>Locations</span>
                    {filteredLocations.map((location) => (
                      <button
                        key={location.id}
                        type="button"
                        role="menuitem"
                        className={toolbarStyles.paletteButton}
                        onClick={() => runLocation(location.path)}
                      >
                        <Folder size={16} />
                        <span className={toolbarStyles.paletteText}>
                          <strong className={toolbarStyles.paletteTitle}>{location.label}</strong>
                          <small className={toolbarStyles.paletteSubtitle}>{location.badge} · {location.subtitle}</small>
                        </span>
                      </button>
                    ))}
                  </>
                ) : null}
                {filteredLocations.length > 0 && (indexedResults.length > 0 || indexedSearching || indexedError) ? <span className={toolbarStyles.paletteDivider} /> : null}
                {indexedResults.length > 0 ? (
                  <>
                    <span className={toolbarStyles.paletteSection}>Indexed Search</span>
                    {indexedResults.map((result) => (
                      <button
                        key={`${result.sourceKind}:${result.entry.path}`}
                        type="button"
                        role="menuitem"
                        className={toolbarStyles.paletteButton}
                        onClick={() => runIndexedResult(result)}
                      >
                        <Search size={16} />
                        <span className={toolbarStyles.paletteText}>
                          <strong className={toolbarStyles.paletteTitle}>{result.entry.name}</strong>
                          <small className={toolbarStyles.paletteSubtitle}>{searchResultSubtitle(result)}</small>
                        </span>
                      </button>
                    ))}
                  </>
                ) : indexedSearching ? (
                  <div className={toolbarStyles.paletteEmpty}>Searching index...</div>
                ) : indexedError ? (
                  <div className={toolbarStyles.paletteEmpty}>Search index unavailable.</div>
                ) : null}
              </div>,
              document.body,
            )
          : null}
      </div>

      <div className={toolbarStyles.actionRow}>
        <div className={toolbarStyles.actionLeft}>
          <div className="shrink-0">
            <button
              ref={newButtonRef}
              type="button"
              className={toolbarStyles.newButton}
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              onClick={toggleNewMenu}
            >
              <Plus size={17} />
              <span>New</span>
              <ChevronDown size={15} className={`transition-transform ${newMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {newMenuOpen
              ? createPortal(
                  <div
                    ref={newMenuPopupRef}
                    role="menu"
                    aria-label="Create new"
                    style={{
                      ...newMenuPosition,
                      position: "fixed",
                      zIndex: 2147483000,
                    }}
                    className={toolbarStyles.newMenu}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className={toolbarStyles.newItem}
                      disabled={!props.canCreateFolder}
                      onClick={() => {
                        if (!props.canCreateFolder) return;
                        setNewMenuOpen(false);
                        props.onCreateFolder();
                      }}
                    >
                      <FolderPlus size={20} />
                      Folder
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={toolbarStyles.newItem}
                      disabled={!props.canCreateFile}
                      onClick={() => {
                        if (!props.canCreateFile) return;
                        setNewMenuOpen(false);
                        props.onCreateFile();
                      }}
                    >
                      <FilePlus size={20} />
                      File
                    </button>
                  </div>,
                  document.body,
                )
              : null}
          </div>
          <button className={toolbarStyles.toolbarButton} type="button" title={props.undoTitle} disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title={props.redoTitle} disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Cut" onClick={props.onCut}><Scissors size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Copy" onClick={props.onCopy}><Copy size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Paste" onClick={props.onPaste}><Clipboard size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Rename" onClick={props.onRename}><Pencil size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Delete" onClick={props.onDelete}><Trash2 size={18} /></button>
        </div>

      </div>
    </header>
  );
});

export const ExplorerPaneToolbarActions = memo(function ExplorerPaneToolbarActions(props: ExplorerPaneToolbarActionsProps) {
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [overflowMenuPosition, setOverflowMenuPosition] = useState<CSSProperties>({
    left: 0,
    top: 0,
  });
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);
  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props.onRefresh, startRefreshSpin]);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const overflowButtonRef = useRef<HTMLButtonElement | null>(null);

  const positionOverflowMenu = useCallback(() => {
    const rect = overflowButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = 240;
    const viewportPadding = 8;
    const nextPosition = {
      left: Math.max(viewportPadding, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding)),
      top: rect.bottom + 6,
    };
    setOverflowMenuPosition((current) => {
      if (current.left === nextPosition.left && current.top === nextPosition.top) return current;
      return nextPosition;
    });
  }, []);

  useLayoutEffect(() => {
    if (overflowMenuOpen) positionOverflowMenu();
  }, [overflowMenuOpen, positionOverflowMenu]);

  useEffect(() => {
    if (!overflowMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!overflowButtonRef.current?.contains(target) && !overflowMenuRef.current?.contains(target)) {
        setOverflowMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverflowMenuOpen(false);
        overflowButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", positionOverflowMenu);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", positionOverflowMenu);
    };
  }, [overflowMenuOpen, positionOverflowMenu]);

  const toggleOverflowMenu = () => {
    setOverflowMenuOpen((open) => !open);
  };

  const runOverflowAction = (action: () => void) => {
    setOverflowMenuOpen(false);
    action();
  };

  return (
    <>
      <div className={paneToolbarActionStyles.section}>
        <button
          className={cx(paneToolbarActionStyles.button, props.viewMode === "grid" && paneToolbarActionStyles.buttonActive)}
          type="button"
          title="View as grid"
          aria-label="View as grid"
          onClick={() => props.onViewMode("grid")}
        >
          <Grid2X2 size={15} />
        </button>
        <button
          className={cx(paneToolbarActionStyles.button, props.viewMode === "list" && paneToolbarActionStyles.buttonActive)}
          type="button"
          title="View as list"
          aria-label="View as list"
          onClick={() => props.onViewMode("list")}
        >
          <List size={15} />
        </button>
        <button
          ref={overflowButtonRef}
          className={cx(paneToolbarActionStyles.button, overflowMenuOpen && paneToolbarActionStyles.buttonActive)}
          type="button"
          title="More file actions"
          aria-label="More file actions"
          aria-haspopup="menu"
          aria-expanded={overflowMenuOpen}
          onClick={toggleOverflowMenu}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {overflowMenuOpen
        ? createPortal(
            <div
              ref={overflowMenuRef}
              role="menu"
              aria-label="More file actions"
              style={{
                ...overflowMenuPosition,
                position: "fixed",
                zIndex: 2147483000,
              }}
              className={toolbarStyles.overflowMenu}
            >
              <span className={toolbarStyles.overflowSection}>View</span>
              <OverflowMenuItem
                icon={<Grid2X2 size={16} />}
                label="View as Grid"
                active={props.viewMode === "grid"}
                onRun={() => runOverflowAction(() => props.onViewMode("grid"))}
              />
              <OverflowMenuItem
                icon={<List size={16} />}
                label="View as List"
                active={props.viewMode === "list"}
                onRun={() => runOverflowAction(() => props.onViewMode("list"))}
              />
              <div className={toolbarStyles.overflowSeparator} />
              {toolbarSortOptions.map((option) => {
                const active = props.sort.column === option.column;
                return (
                  <OverflowMenuItem
                    key={option.column}
                    label={`Sort by ${option.label}`}
                    active={active}
                    meta={active ? (props.sort.direction === "asc" ? "Asc" : "Desc") : undefined}
                    onRun={() => runOverflowAction(() => props.onSort(option.column))}
                  />
                );
              })}
              <OverflowMenuItem
                icon={<Eye size={16} />}
                label={props.showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
                active={props.showHidden}
                onRun={() => runOverflowAction(props.onToggleHidden)}
              />
              <div className={toolbarStyles.overflowSeparator} />
              <span className={toolbarStyles.overflowSection}>Location</span>
              <OverflowMenuItem
                icon={<RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={16} />}
                label="Refresh"
                onRun={() => runOverflowAction(runRefresh)}
              />
              <OverflowMenuItem
                icon={<Copy size={16} />}
                label="Copy Current Path"
                onRun={() => runOverflowAction(() => props.onCopyPath(props.path))}
              />
              <OverflowMenuItem
                icon={<Folder size={16} />}
                label="Calculate Folder Sizes"
                disabled={!props.canCalculateDirectorySizes}
                onRun={() => runOverflowAction(props.onCalculateDirectorySizes)}
              />
              {props.selectedCount > 0 ? (
                <>
                  <div className={toolbarStyles.overflowSeparator} />
                  <span className={toolbarStyles.overflowSection}>
                    {props.selectedCount === 1 ? "Selection" : `${props.selectedCount} Selected`}
                  </span>
                  <OverflowMenuItem
                    icon={<AppWindow size={16} />}
                    label="Open With..."
                    disabled={!props.canOpenWithSelected}
                    onRun={() => runOverflowAction(props.onOpenWith)}
                  />
                  <OverflowMenuItem
                    icon={<Download size={16} />}
                    label="Download"
                    disabled={!props.hasRemoteSelection}
                    onRun={() => runOverflowAction(props.onDownload)}
                  />
                  <OverflowMenuItem
                    icon={<Copy size={16} />}
                    label="Copy Selected Path"
                    disabled={props.selectedCount !== 1 || !props.selectedEntryPath}
                    onRun={() => {
                      if (!props.selectedEntryPath) return;
                      runOverflowAction(() => props.onCopyPath(props.selectedEntryPath!));
                    }}
                  />
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
});
