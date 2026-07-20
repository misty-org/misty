import { Button } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui";
import { Input } from "@/ui";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  FilePlus,
  FolderPlus,
  Pencil,
  Plus,
  Redo2,
  RefreshCcw,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import { breadcrumbSegments } from "../utils/fileFormat";
import { ExplorerToolbarDragNavigation } from "./ExplorerToolbarDragNavigation";
import type { ExplorerToolbarProps } from "@/models/interfaces/features/explorer/components/ExplorerToolbarModel";
import { ExplorerToolbarSearch } from "./ExplorerToolbarSearch";
import { cx, toolbarStyles } from "./ExplorerToolbarSupport";

export type {
  ExplorerCommandId,
  ExplorerLocationResult,
  ExplorerPaneToolbarActionsProps,
} from "./ExplorerToolbarModel";
export { ExplorerPaneToolbarActions } from "./ExplorerPaneToolbarActions";

export const ExplorerToolbar = memo(function ExplorerToolbar(props: ExplorerToolbarProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(props.path);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);

  useEffect(() => {
    if (!pathEditing) setPathDraft(props.path);
  }, [pathEditing, props.path]);

  useLayoutEffect(() => {
    if (!pathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [pathEditing]);

  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props.onRefresh, startRefreshSpin]);

  const beginPathEdit = useCallback(() => {
    setPathDraft(props.path);
    setPathEditing(true);
  }, [props.path]);

  const submitPathEdit = useCallback(() => {
    const target = pathDraft.trim();
    setPathEditing(false);
    setPathDraft(props.path);
    if (target) props.onNavigateLocation(target);
  }, [pathDraft, props.onNavigateLocation, props.path]);

  const cancelPathEdit = useCallback(() => {
    setPathEditing(false);
    setPathDraft(props.path);
  }, [props.path]);

  return (
    <header className={toolbarStyles.root}>
      <div className={toolbarStyles.navRow}>
        <div className={toolbarStyles.navButtons}>
          <ExplorerToolbarDragNavigation
            paneId={props.paneId}
            backPath={props.backPath}
            forwardPath={props.forwardPath}
            parentPath={props.parentPath}
            onBack={props.onBack}
            onForward={props.onForward}
            onParent={props.onParent}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh current folder"
            title="Refresh current folder"
            className={toolbarStyles.navigationButton}
            onClick={runRefresh}
          >
            <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={17} />
          </Button>
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
            <Input
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
              <ExplorerDropTarget
                key={`${segment.path}-${index}`}
                id={`breadcrumb:${props.paneId}:${segment.path}`}
                path={segment.path}
                paneId={props.paneId}
                springLoad
                onSpringLoad={() => props.onNavigate(segment.path)}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={toolbarStyles.pathButton}
                  onClick={() => props.onNavigate(segment.path)}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {index > 0 ? (
                    <ChevronRight className={toolbarStyles.breadcrumbCaret} size={14} />
                  ) : null}
                  {segment.label}
                </Button>
              </ExplorerDropTarget>
            ))
          )}
        </div>

        <ExplorerToolbarSearch
          paneId={props.paneId}
          path={props.path}
          commandQuery={props.commandQuery}
          commandQueryMode={props.commandQueryMode}
          locationResults={props.locationResults}
          pluginCommands={props.pluginCommands}
          onCommandQuery={props.onCommandQuery}
          onNavigateLocation={props.onNavigateLocation}
          onNavigateSearchResult={props.onNavigateSearchResult}
          onRunCommand={props.onRunCommand}
        />
      </div>

      <div role="toolbar" aria-label="File actions" className={toolbarStyles.actionRow}>
        <div className={toolbarStyles.actionLeft}>
          <DropdownMenu open={newMenuOpen} onOpenChange={setNewMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className={toolbarStyles.newButton}>
                <Plus size={17} />
                <span>New</span>
                <ChevronDown
                  size={15}
                  className={cx("transition-transform", newMenuOpen && "rotate-180")}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="w-52">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Create in this folder
              </DropdownMenuLabel>
              <DropdownMenuItem disabled={!props.canCreateFolder} onSelect={props.onCreateFolder}>
                <FolderPlus />
                Folder
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!props.canCreateFile} onSelect={props.onCreateFile}>
                <FilePlus />
                File
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolbarIconButton
            label={props.undoTitle}
            disabled={!props.canUndo}
            onClick={props.onUndo}
          >
            <Undo2 size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={props.redoTitle}
            disabled={!props.canRedo}
            onClick={props.onRedo}
          >
            <Redo2 size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton label="Cut" onClick={props.onCut}>
            <Scissors size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton label="Copy" onClick={props.onCopy}>
            <Copy size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton label="Paste" onClick={props.onPaste}>
            <Clipboard size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton label="Rename" onClick={props.onRename}>
            <Pencil size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton label="Delete" onClick={props.onDelete}>
            <Trash2 size={18} />
          </ToolbarIconButton>
        </div>
      </div>
    </header>
  );
});

function ToolbarIconButton(props: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}
