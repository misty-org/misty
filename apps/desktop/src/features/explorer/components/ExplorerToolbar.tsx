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
import type { ExplorerViewMode } from "../state/useExplorerStore";
import { breadcrumbSegments } from "../utils/fileFormat";

export type ExplorerCommandId =
  | "explorer.refresh"
  | "explorer.rename"
  | "explorer.delete"
  | "explorer.open_with"
  | "explorer.copy"
  | "explorer.cut"
  | "explorer.paste"
  | "explorer.toggle_hidden";

const explorerCommands: Array<{ id: ExplorerCommandId; label: string; hint: string }> = [
  { id: "explorer.refresh", label: "Refresh", hint: "Reload the active folder" },
  { id: "explorer.rename", label: "Rename", hint: "Rename the selected item" },
  { id: "explorer.delete", label: "Delete", hint: "Delete the selected items" },
  { id: "explorer.open_with", label: "Open With", hint: "Choose an app for the selected file" },
  { id: "explorer.copy", label: "Copy", hint: "Copy selected items" },
  { id: "explorer.cut", label: "Cut", hint: "Move selected items with paste" },
  { id: "explorer.paste", label: "Paste", hint: "Paste into the active folder" },
  { id: "explorer.toggle_hidden", label: "Toggle Hidden Files", hint: "Show or hide hidden files" },
];

interface ExplorerToolbarProps {
  path: string;
  commandQuery: string;
  viewMode: ExplorerViewMode;
  showHidden: boolean;
  onNavigate: (path: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
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
  onRunCommand: (commandId: ExplorerCommandId) => void;
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
  const commandMenuRef = useRef<HTMLDivElement | null>(null);
  const commandMode = props.commandQuery.trimStart().startsWith(">");
  const commandFilter = commandMode ? props.commandQuery.trimStart().slice(1).trim().toLowerCase() : "";
  const filteredCommands = useMemo(
    () => explorerCommands.filter((command) => {
      if (!commandFilter) return true;
      const haystack = `${command.id} ${command.label} ${command.hint}`.toLowerCase();
      return haystack.includes(commandFilter);
    }),
    [commandFilter],
  );

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
    if (commandMode) positionCommandMenu();
  }, [commandMode, positionCommandMenu]);

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
    const onViewportChange = () => positionNewMenu();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [newMenuOpen, positionNewMenu]);

  useEffect(() => {
    if (!commandMode) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!commandSearchRef.current?.contains(target) && !commandMenuRef.current?.contains(target)) {
        props.onCommandQuery("");
      }
    };
    const onViewportChange = () => positionCommandMenu();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [commandMode, positionCommandMenu, props.onCommandQuery]);

  const toggleNewMenu = () => {
    setNewMenuOpen((open) => !open);
  };

  const runCommand = (commandId: ExplorerCommandId) => {
    props.onRunCommand(commandId);
    props.onCommandQuery("");
  };

  return (
    <header className="explorer-toolbar">
      <div className="explorer-nav-row">
        <div className="toolbar-nav-buttons">
          <button disabled={!props.canGoBack} onClick={props.onBack}><ChevronLeft size={18} /></button>
          <button disabled={!props.canGoForward} onClick={props.onForward}><ChevronRight size={18} /></button>
          <button onClick={props.onParent}><ArrowUp size={18} /></button>
          <button onClick={props.onRefresh}><RefreshCcw size={18} /></button>
        </div>

        <div className="path-bar">
          {breadcrumbSegments(props.path).map((segment, index) => (
            <button key={`${segment.path}-${index}`} onClick={() => props.onNavigate(segment.path)}>
              {index > 0 ? <ChevronRight className="breadcrumb-caret" size={14} /> : null}
              {segment.label}
            </button>
          ))}
        </div>

        <label ref={commandSearchRef} className={commandMode ? "command-search command-mode" : "command-search"}>
          <Search size={18} />
          <input
            value={props.commandQuery}
            placeholder="Search or run command"
            onChange={(event) => props.onCommandQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!commandMode) return;
              if (event.key === "Escape") {
                event.preventDefault();
                props.onCommandQuery("");
              } else if (event.key === "Enter" && filteredCommands[0]) {
                event.preventDefault();
                runCommand(filteredCommands[0].id);
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
                className="command-palette-menu"
              >
                {filteredCommands.length > 0 ? filteredCommands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="menuitem"
                    onClick={() => runCommand(command.id)}
                  >
                    <Command size={16} />
                    <span>
                      <strong>{command.label}</strong>
                      <small>{command.hint}</small>
                    </span>
                  </button>
                )) : <div className="command-palette-empty">No explorer commands found.</div>}
              </div>,
              document.body,
            )
          : null}
      </div>

      <div className="explorer-action-row">
        <div className="toolbar-action-left">
          <div className="shrink-0">
            <button
              ref={newButtonRef}
              type="button"
              className="new-button !h-9 !gap-1.5 !px-3"
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
                    className="new-popup-menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="new-popup-item"
                      onClick={() => {
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
                      className="new-popup-item"
                      onClick={() => {
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
          <button type="button" title="Cut" onClick={props.onCut}><Scissors size={18} /></button>
          <button type="button" title="Copy" onClick={props.onCopy}><Copy size={18} /></button>
          <button type="button" title="Paste" onClick={props.onPaste}><Clipboard size={18} /></button>
          <button type="button" title="Rename" onClick={props.onRename}><Pencil size={18} /></button>
          <button type="button" title="Delete" onClick={props.onDelete}><Trash2 size={18} /></button>
          <button type="button" title="Upload files" onClick={props.onUploadFiles}><Upload size={18} /></button>
          <button type="button" title="Upload folder" onClick={props.onUploadFolder}><FolderUp size={18} /></button>
          <button type="button" title="Compare folders" onClick={props.onCompare}><GitCompareArrows size={18} /></button>
          <button onClick={props.onToggleHidden} className={props.showHidden ? "selected" : ""}>Hidden</button>
        </div>

        <div className="toolbar-action-right">
          <div className="view-toggle">
            <button className={props.viewMode === "grid" ? "selected" : ""} onClick={() => props.onViewMode("grid")}>
              <Grid2X2 size={18} />
            </button>
            <button className={props.viewMode === "list" ? "selected" : ""} onClick={() => props.onViewMode("list")}>
              <List size={18} />
            </button>
          </div>
          <button><MoreHorizontal size={20} /></button>
        </div>
      </div>
    </header>
  );
});
