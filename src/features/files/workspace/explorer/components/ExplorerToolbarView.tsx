import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  IconButton,
  Input,
  MenuItem,
  MenuTrigger,
  toolbarIconProps,
} from "@/shared/ui";
import {
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
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerToolbarRuntime } from "./ExplorerToolbarRuntime";
import type { ExplorerToolbarProps } from "../model/interfaces/components/ExplorerToolbarModel";
import { breadcrumbSegments, cx, toolbarStyles } from "@/features/file-ui";
import { ExplorerToolbarDragNavigationView } from "./ExplorerToolbarDragNavigationView";

export { ExplorerPaneToolbarActions } from "./ExplorerPaneToolbarActions";

export const ExplorerToolbarView = memo(function ExplorerToolbarView(
  props: ExplorerToolbarProps & { runtime: ExplorerToolbarRuntime },
) {
  const { DropTarget, Search } = props.runtime;
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
      <div className={toolbarStyles.navRow} data-window-toolbar>
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
          <IconButton label="Refresh current folder" onClick={runRefresh}>
            <RefreshCcw
              {...toolbarIconProps}
              className={refreshSpinning ? "animate-spin" : undefined}
            />
          </IconButton>
        </div>

        <div
          className={cx(toolbarStyles.pathBar, pathEditing && toolbarStyles.pathBarEditing)}
          data-misty-window-drag-block="true"
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

        <div className="flex min-w-0 items-center gap-2">
          <Search
            paneId={props.paneId}
            path={props.path}
            commandQuery={props.commandQuery}
            commandQueryMode={props.commandQueryMode}
            locationResults={props.locationResults}
            onCommandQuery={props.onCommandQuery}
            onNavigateLocation={props.onNavigateLocation}
            onNavigateSearchResult={props.onNavigateSearchResult}
            onRunCommand={props.onRunCommand}
          />
        </div>
      </div>

      <div role="toolbar" aria-label="File actions" className={toolbarStyles.actionRow}>
        <div className={toolbarStyles.actionLeft}>
          <DropdownMenu>
            <MenuTrigger label="New" icon={<Plus size={16} />} className="text-cream" />
            <DropdownMenuContent align="start" sideOffset={6} width="sm">
              <DropdownMenuLabel>Create in this folder</DropdownMenuLabel>
              <MenuItem
                icon={<FolderPlus />}
                label="Folder"
                disabled={!props.canCreateFolder}
                onSelect={props.onCreateFolder}
              />
              <MenuItem
                icon={<FilePlus />}
                label="File"
                disabled={!props.canCreateFile}
                onSelect={props.onCreateFile}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label={props.undoTitle} disabled={!props.canUndo} onClick={props.onUndo}>
            <Undo2 {...toolbarIconProps} />
          </IconButton>
          <IconButton label={props.redoTitle} disabled={!props.canRedo} onClick={props.onRedo}>
            <Redo2 {...toolbarIconProps} />
          </IconButton>
          <IconButton label="Cut" disabled={props.canCut === false} onClick={props.onCut}>
            <Scissors {...toolbarIconProps} />
          </IconButton>
          <IconButton label="Copy" disabled={props.canCopy === false} onClick={props.onCopy}>
            <Copy {...toolbarIconProps} />
          </IconButton>
          <IconButton label="Paste" disabled={props.canPaste === false} onClick={props.onPaste}>
            <Clipboard {...toolbarIconProps} />
          </IconButton>
          {props.onRestore && (
            <IconButton
              label="Restore"
              disabled={props.canRestore === false}
              onClick={props.onRestore}
            >
              <RotateCcw {...toolbarIconProps} />
            </IconButton>
          )}
          <IconButton label="Rename" disabled={props.canRename === false} onClick={props.onRename}>
            <Pencil {...toolbarIconProps} />
          </IconButton>
          <IconButton label="Delete" disabled={props.canDelete === false} onClick={props.onDelete}>
            <Trash2 {...toolbarIconProps} />
          </IconButton>
        </div>
        {props.trailingActions ? (
          <div className="flex shrink-0 items-center justify-end gap-3">
            {props.trailingActions}
          </div>
        ) : null}
      </div>
    </header>
  );
});
