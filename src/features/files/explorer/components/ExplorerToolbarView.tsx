import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
} from "@/shared/ui";
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
  RotateCcw,
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
import type { ExplorerToolbarRuntime } from "./ExplorerToolbarRuntime";
import type { ExplorerToolbarProps } from "../model/interfaces/components/ExplorerToolbarModel";
import { breadcrumbSegments } from "../utils/fileFormat";
import { ExplorerToolbarDragNavigationView } from "./ExplorerToolbarDragNavigationView";
import { cx, toolbarStyles } from "./ExplorerToolbarSupport";

export { ExplorerPaneToolbarActions } from "./ExplorerPaneToolbarActions";
export type {
  ExplorerCommandId,
  ExplorerLocationResult,
  ExplorerPaneToolbarActionsProps,
} from "./ExplorerToolbarModel";

export const ExplorerToolbarView = memo(function ExplorerToolbarView(
  props: ExplorerToolbarProps & { runtime: ExplorerToolbarRuntime },
) {
  const { DropTarget, Search } = props.runtime;
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(props.displayPath ?? props.path);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);

  useEffect(() => {
    if (!pathEditing) setPathDraft(props.displayPath ?? props.path);
  }, [pathEditing, props.path, props.displayPath]);

  useLayoutEffect(() => {
    if (!pathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [pathEditing]);

  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props, startRefreshSpin]);

  const beginPathEdit = useCallback(() => {
    setPathDraft(props.displayPath ?? props.path);
    setPathEditing(true);
  }, [props.path, props.displayPath]);

  const submitPathEdit = useCallback(() => {
    const target = pathDraft.trim();
    setPathEditing(false);
    setPathDraft(props.displayPath ?? props.path);
    if (target) props.onNavigateLocation(target);
  }, [pathDraft, props]);

  const cancelPathEdit = useCallback(() => {
    setPathEditing(false);
    setPathDraft(props.displayPath ?? props.path);
  }, [props.path, props.displayPath]);

  return (
    <header className={toolbarStyles.root}>
      <div className={toolbarStyles.navRow}>
        <div className={toolbarStyles.navButtons}>
          <ExplorerToolbarDragNavigationView
            DropTarget={DropTarget}
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
              placeholder={props.pathPlaceholder ?? "Enter file path"}
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
            (props.breadcrumbs ?? breadcrumbSegments(props.path)).map((segment, index) => (
              <DropTarget
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
              </DropTarget>
            ))
          )}
        </div>

        <Search
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
              <DropdownMenuLabel className="text-xs text-cream-muted">
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
          <ToolbarIconButton label="Cut" disabled={props.canCut === false} onClick={props.onCut}>
            <Scissors size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton label="Copy" disabled={props.canCopy === false} onClick={props.onCopy}>
            <Copy size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Paste"
            disabled={props.canPaste === false}
            onClick={props.onPaste}
          >
            <Clipboard size={18} />
          </ToolbarIconButton>
          {props.onRestore && (
            <ToolbarIconButton
              label="Restore"
              disabled={props.canRestore === false}
              onClick={props.onRestore}
            >
              <RotateCcw size={18} />
            </ToolbarIconButton>
          )}
          <ToolbarIconButton
            label="Rename"
            disabled={props.canRename === false}
            onClick={props.onRename}
          >
            <Pencil size={18} />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Delete"
            disabled={props.canDelete === false}
            onClick={props.onDelete}
          >
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
