import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Command,
  FilePlus,
  FolderPlus,
  FolderUp,
  Grid2X2,
  GitCompareArrows,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Scissors,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { PluginCommandEntry } from "../../../api/types";
import type { ExplorerViewMode } from "../state/useExplorerStore";
import { breadcrumbSegments } from "../utils/fileFormat";

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
  | "explorer.delete"
  | "explorer.download"
  | "explorer.open_with"
  | "explorer.copy"
  | "explorer.cut"
  | "explorer.paste"
  | "explorer.undo"
  | "explorer.redo"
  | "explorer.toggle_hidden"
  | "explorer.preview.toggle"
  | "explorer.sidebar.toggle"
  | "explorer.toggle_chat"
  | "explorer.toggle_claude"
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
  group?: "Explorer" | "Plugin";
  pluginName?: string;
}

const explorerCommands: ExplorerCommandPaletteEntry[] = [
  { id: "app.toggle_transfers", label: "Open Transfers", hint: "Switch to transfer history and active work" },
  { id: "app.open_settings", label: "Open Settings", hint: "Switch to application settings" },
  { id: "app.toggle_plugin_launcher", label: "Open Hub", hint: "Open Misty Hub" },
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
  { id: "explorer.delete", label: "Delete", hint: "Delete the selected items" },
  { id: "explorer.download", label: "Download", hint: "Download selected remote items to Downloads" },
  { id: "explorer.open_with", label: "Open With", hint: "Choose an app for the selected file" },
  { id: "explorer.copy", label: "Copy", hint: "Copy selected items" },
  { id: "explorer.cut", label: "Cut", hint: "Move selected items with paste" },
  { id: "explorer.paste", label: "Paste", hint: "Paste into the active folder" },
  { id: "explorer.undo", label: "Undo", hint: "Undo the latest completed rename or move" },
  { id: "explorer.redo", label: "Redo", hint: "Redo the latest undone rename or move" },
  { id: "explorer.toggle_hidden", label: "Toggle Hidden Files", hint: "Show or hide hidden files" },
  { id: "explorer.preview.toggle", label: "Toggle Preview", hint: "Show or hide the preview/details panel" },
  { id: "explorer.sidebar.toggle", label: "Toggle Sidebar", hint: "Show or hide the navigation sidebar" },
  { id: "explorer.toggle_chat", label: "Toggle Chat", hint: "Open or close the explorer chat overlay" },
  { id: "explorer.toggle_claude", label: "Toggle Claude", hint: "Open the Claude assistant panel when available" },
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

const toolbarStyles = {
  root:
    "min-w-0 overflow-visible border-b border-[#262626] bg-[#131313] max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden max-[720px]:bg-[#101010] max-[720px]:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  navRow: "grid min-w-0 grid-cols-[auto_minmax(240px,1fr)_minmax(220px,360px)] items-center gap-3 overflow-visible px-3 py-1.5 max-[980px]:grid-cols-[auto_minmax(180px,1fr)_minmax(190px,280px)]",
  actionRow: "grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center justify-between gap-3 overflow-hidden border-t border-[#262626] px-3 py-1.5",
  navButtons: "flex min-w-0 flex-none items-center gap-1",
  actionLeft: "flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  actionRight: "flex min-w-0 flex-none items-center gap-2",
  toolbarButton:
    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-1 leading-none text-[#adadad] hover:bg-[#212121] hover:text-[#eeeeee] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[#adadad]",
  toolbarButtonSelected: "bg-[#212121] text-[#eeeeee]",
  pathBar:
    "flex h-8 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-lg border border-[#2f2f2f] bg-[#1b1b1b] px-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  pathBarEditing: "border-[#828282] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.24)]",
  pathButton: "inline-flex h-7 min-w-[auto] flex-none items-center gap-0 border-0 bg-transparent px-1 py-0 leading-none text-[#d5d5d5]",
  pathInput: "!h-full !min-w-0 !w-full !appearance-none !rounded-none !border-0 !bg-transparent !p-0 !font-[inherit] !leading-none !text-[#eeeeee] !shadow-none !outline-0 placeholder:!text-[#868686]",
  breadcrumbCaret: "mr-[7px] flex-none text-[#949494]",
  commandSearch:
    "!flex !h-8 !w-full !min-w-0 !items-center !gap-2 rounded-lg border border-[#2f2f2f] bg-[#1b1b1b] px-2.5 !text-[#949494] !normal-case max-[980px]:w-full max-[720px]:min-w-40",
  commandSearchMode: "border-[#575757] bg-[#1e1e1e] text-[#c4c4c4]",
  commandInput: "!h-full !min-w-0 !flex-1 !appearance-none !rounded-none !border-0 !bg-transparent !p-0 !text-[#eeeeee] !shadow-none !outline-0 placeholder:!text-[#868686]",
  palette: "grid gap-0.5 rounded-xl border border-[#323232] bg-[rgba(17, 17, 17, 0.98)] p-[7px] shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl",
  paletteButton:
    "flex min-h-12 w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-[9px] py-[7px] text-left text-[#e2e2e2] hover:bg-[#252525] hover:text-[#f7f7f7] focus-visible:bg-[#252525] focus-visible:text-[#f7f7f7]",
  paletteText: "grid min-w-0 gap-0.5",
  paletteTitle: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold",
  paletteSubtitle: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#979797]",
  paletteEmpty: "p-2.5 text-xs text-[#979797]",
  newButton:
    "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#323232] bg-[#1b1b1b] px-3 py-0 leading-none text-[#eeeeee] hover:bg-[#212121]",
  newMenu: "grid w-52 gap-0.5 rounded-[13px] border border-[#323232] bg-[rgba(17, 17, 17, 0.96)] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl",
  newItem:
    "flex h-12 w-full items-center justify-start gap-3 rounded-[9px] border-0 bg-transparent px-3 py-0 text-left text-base text-[#dddddd] hover:bg-[#222222] hover:text-[#eeeeee] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[#dddddd]",
  viewToggle: "flex overflow-hidden rounded-lg bg-[#1a1a1a]",
  viewToggleSelected: "bg-[#333333]",
} as const;

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

interface ExplorerToolbarProps {
  paneId: string;
  path: string;
  commandQuery: string;
  viewMode: ExplorerViewMode;
  showHidden: boolean;
  locationResults: ExplorerLocationResult[];
  pluginCommands: PluginCommandEntry[];
  onNavigate: (path: string) => void;
  onNavigateLocation: (path: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  canCreateFile: boolean;
  canCreateFolder: boolean;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
  onRefresh: () => void;
  onCommandQuery: (value: string) => void;
  onViewMode: (mode: ExplorerViewMode) => void;
  onToggleHidden: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onRename: () => void;
  onDelete: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onCompare: () => void;
  onRunCommand: (commandId: string) => void;
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
  const newMenuPopupRef = useRef<HTMLDivElement | null>(null);
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const commandSearchRef = useRef<HTMLLabelElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const commandMenuRef = useRef<HTMLDivElement | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(props.path);
  const commandMode = props.commandQuery.trimStart().startsWith(">");
  const commandFilter = commandMode ? props.commandQuery.trimStart().slice(1).trim().toLowerCase() : "";
  const locationFilter = commandMode ? "" : props.commandQuery.trim().toLowerCase();
  const paletteCommands = useMemo(
    () => [
      ...explorerCommands,
      ...props.pluginCommands.map((command): ExplorerCommandPaletteEntry => ({
        id: command.id,
        label: command.label,
        hint: command.hint,
        group: "Plugin",
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
  const locationMode = searchFocused && !commandMode && filteredLocations.length > 0;

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
          <button className={toolbarStyles.toolbarButton} onClick={props.onRefresh}><RefreshCcw size={18} /></button>
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

        <label ref={commandSearchRef} className={cx(toolbarStyles.commandSearch, commandMode && toolbarStyles.commandSearchMode)}>
          <Search size={18} />
          <input
            ref={commandInputRef}
            className={toolbarStyles.commandInput}
            value={props.commandQuery}
            placeholder="Search or run command"
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
              }
            }}
          />
        </label>
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
                      <small className={toolbarStyles.paletteSubtitle}>{command.group === "Plugin" && command.pluginName ? `${command.pluginName} · ${command.hint}` : command.hint}</small>
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
                {filteredLocations.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    role="menuitem"
                    className={toolbarStyles.paletteButton}
                    onClick={() => runLocation(location.path)}
                  >
                    <FolderUp size={16} />
                    <span className={toolbarStyles.paletteText}>
                      <strong className={toolbarStyles.paletteTitle}>{location.label}</strong>
                      <small className={toolbarStyles.paletteSubtitle}>{location.badge} · {location.subtitle}</small>
                    </span>
                  </button>
                ))}
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
          <button className={toolbarStyles.toolbarButton} type="button" title="Cut" onClick={props.onCut}><Scissors size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Copy" onClick={props.onCopy}><Copy size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Paste" onClick={props.onPaste}><Clipboard size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Rename" onClick={props.onRename}><Pencil size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Delete" onClick={props.onDelete}><Trash2 size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Upload files" onClick={props.onUploadFiles}><Upload size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Upload folder" onClick={props.onUploadFolder}><FolderUp size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Compare folders" onClick={props.onCompare}><GitCompareArrows size={18} /></button>
          <button className={cx(toolbarStyles.toolbarButton, props.showHidden && toolbarStyles.toolbarButtonSelected)} onClick={props.onToggleHidden}>Hidden</button>
        </div>

        <div className={toolbarStyles.actionRight}>
          <div className={toolbarStyles.viewToggle}>
            <button className={cx(toolbarStyles.toolbarButton, props.viewMode === "grid" && toolbarStyles.viewToggleSelected)} onClick={() => props.onViewMode("grid")}>
              <Grid2X2 size={18} />
            </button>
            <button className={cx(toolbarStyles.toolbarButton, props.viewMode === "list" && toolbarStyles.viewToggleSelected)} onClick={() => props.onViewMode("list")}>
              <List size={18} />
            </button>
          </div>
          <button className={toolbarStyles.toolbarButton}><MoreHorizontal size={20} /></button>
        </div>
      </div>
    </header>
  );
});

function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  let index = 0;
  for (const char of needle) {
    index = haystack.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}
