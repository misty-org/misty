// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronsDown, ChevronsUp, Plus, RotateCw, Search } from "lucide-react";
import { memo, useCallback, useMemo, type MouseEvent } from "react";
import { IconButton, Pressable, Spinner } from "@/shared/ui";
import type { RepositorySummary } from "./filesApi";
import { getFileTreeIconSvg } from "./fileIcons";
import { useFilesStore } from "./filesStore";
import type { VisibleNode } from "./visibleNodes";

/** The badge's words for a repository: `branch, clean` or `branch, 2 changed, 1 new`. */
export function repositoryLabel(repo: RepositorySummary): string {
  if (repo.changed + repo.untracked === 0) return `${repo.branch}, no changes`;
  const parts = [repo.branch];
  if (repo.changed > 0) parts.push(`${repo.changed} changed`);
  if (repo.untracked > 0) parts.push(`${repo.untracked} new`);
  return parts.join(", ");
}

/** The root row's refresh. Its spinner follows the store, since a Git action or a retry can start
 * a refresh too; it lives in this small child so only the root row subscribes. */
function TreeRootRefreshButton() {
  const refreshing = useFilesStore((state) => state.refreshing);
  return (
    <IconButton
      label="Refresh"
      size="2xs"
      className="file-tree-row-action"
      disabled={refreshing}
      onClick={(event) => {
        event.stopPropagation();
        void useFilesStore.getState().refreshTree();
      }}
    >
      <RotateCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
    </IconButton>
  );
}

/** The whole tree's actions sit on the one row that is always there, the root, and show on its
 * hover; Alt+Shift+→ and ← still work while focus is in the tree. */
function TreeRootViewActions({ root }: { root: string }) {
  return (
    <>
      <IconButton
        label="Search files"
        size="2xs"
        className="file-tree-row-action"
        onClick={(event) => {
          event.stopPropagation();
          useFilesStore.getState().openSearch(root);
        }}
      >
        <Search aria-hidden />
      </IconButton>
      <IconButton
        label="Expand loaded folders"
        tooltip="Expand loaded folders (⌥⇧→)"
        size="2xs"
        className="file-tree-row-action"
        aria-keyshortcuts="Alt+Shift+ArrowRight"
        onClick={(event) => {
          event.stopPropagation();
          useFilesStore.getState().expandLoadedDirs();
        }}
      >
        <ChevronsDown aria-hidden />
      </IconButton>
      <IconButton
        label="Collapse all folders"
        tooltip="Collapse all folders (⌥⇧←)"
        size="2xs"
        className="file-tree-row-action"
        aria-keyshortcuts="Alt+Shift+ArrowLeft"
        onClick={(event) => {
          event.stopPropagation();
          useFilesStore.getState().collapseAllDirs();
        }}
      >
        <ChevronsUp aria-hidden />
      </IconButton>
    </>
  );
}

interface TreeRowProps {
  node: VisibleNode;
  selected: boolean;
  /** The folder's own row: it carries the tree's refresh and view actions. */
  isRoot: boolean;
  onToggleDir(paths: string[]): void;
  onOpenFile(path: string): void;
  onSelectDir(path: string): void;
  onContextMenu(event: MouseEvent<HTMLElement>, node: VisibleNode): void;
  /** The hover "+": put an `@` mention of this path into the chat's composer. */
  onMention(path: string, isDir: boolean): void;
}

export const TreeRow = memo(function TreeRow({
  node,
  selected,
  isRoot,
  onToggleDir,
  onOpenFile,
  onSelectDir,
  onContextMenu,
  onMention,
}: TreeRowProps) {
  const handleClick = useCallback(() => {
    if (node.isDir) {
      onSelectDir(node.path);
      onToggleDir(node.compactPaths ?? [node.path]);
    } else {
      onOpenFile(node.path);
    }
  }, [node.isDir, node.path, node.compactPaths, onToggleDir, onOpenFile, onSelectDir]);

  // The icons are constant SVG strings; picking one is a lookup.
  const iconSvg = useMemo(
    () => getFileTreeIconSvg(node.name, node.isDir, node.expanded),
    [node.name, node.isDir, node.expanded],
  );
  const clean = node.repository && node.repository.changed + node.repository.untracked === 0;

  return (
    <div
      className="file-tree-row"
      data-selected={selected || undefined}
      style={{ paddingLeft: 8 + node.depth * 14 }}
      onContextMenu={(event) => onContextMenu(event, node)}
    >
      <Pressable
        className="file-tree-row-main"
        data-ignored={node.ignored || undefined}
        aria-expanded={node.isDir ? node.expanded : undefined}
        title={node.path}
        onClick={handleClick}
      >
        {node.loading ? (
          <Spinner className="file-tree-icon" label={false} size="sm" />
        ) : (
          <span
            className="file-tree-icon"
            data-folder={node.isDir || undefined}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: iconSvg }}
          />
        )}
        <span className="file-tree-name" data-color={node.color}>
          {node.name}
        </span>
        {node.repository ? (
          <span
            className="file-tree-repo"
            data-clean={clean || undefined}
            title={repositoryLabel(node.repository)}
            aria-label={repositoryLabel(node.repository)}
          >
            <span className="file-tree-repo-branch">{node.repository.branch}</span>
            {clean ? (
              <span aria-hidden>✓</span>
            ) : (
              <>
                {node.repository.changed > 0 ? (
                  <span data-kind="changed" aria-hidden>
                    M{node.repository.changed}
                  </span>
                ) : null}
                {node.repository.untracked > 0 ? (
                  <span data-kind="new" aria-hidden>
                    ?{node.repository.untracked}
                  </span>
                ) : null}
              </>
            )}
          </span>
        ) : null}
      </Pressable>
      {isRoot ? (
        <>
          <TreeRootRefreshButton />
          <TreeRootViewActions root={node.path} />
        </>
      ) : null}
      <IconButton
        label="Add to chat"
        size="2xs"
        className="file-tree-row-action"
        onClick={(event) => {
          event.stopPropagation();
          onMention(node.path, node.isDir);
        }}
      >
        <Plus aria-hidden />
      </IconButton>
    </div>
  );
});
