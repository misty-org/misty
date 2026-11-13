// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronsDown, ChevronsUp, Plus, RotateCw, Search } from "lucide-react";
import { memo, useCallback, useMemo, type MouseEvent } from "react";
import {
  cn,
  IconButton,
  Pressable,
  RowTools,
  Spinner,
  Surface,
  Text,
  Tooltip,
  type TextTone,
} from "@/shared/ui";
import type { FileTreeColor, RepositorySummary } from "./filesApi";
import { getFileTreeIconSvg } from "./fileIcons";
import { useFilesStore } from "./filesStore";
import type { VisibleNode } from "./visibleNodes";

/** The badge's words for a repository: `branch, clean` or `branch, 2 changed, 1 new`. */
function repositoryLabel(repo: RepositorySummary): string {
  if (repo.changed + repo.untracked === 0) return `${repo.branch}, no changes`;
  const parts = [repo.branch];
  if (repo.changed > 0) parts.push(`${repo.changed} changed`);
  if (repo.untracked > 0) parts.push(`${repo.untracked} new`);
  return parts.join(", ");
}

/** A name's Git color as a text tone: amber changed, green new, blue a repository's top folder. */
const nameTone: Record<FileTreeColor, TextTone> = {
  modified: "changed",
  untracked: "added",
  repository: "working",
};

/** The root row's refresh. Its spinner follows the store, since a Git action or a retry can start
 * a refresh too; it lives in this small child so only the root row subscribes. */
function TreeRootRefreshButton() {
  const refreshing = useFilesStore((state) => state.refreshing);
  return (
    <IconButton
      label="Refresh"
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
        onClick={(event) => {
          event.stopPropagation();
          useFilesStore.getState().openSearch(root);
        }}
      >
        <Search aria-hidden />
      </IconButton>
      <IconButton
        label="Expand loaded folders"
        hint="Expand loaded folders (⌥⇧→)"
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
        hint="Collapse all folders (⌥⇧←)"
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
    <Surface
      tone="none"
      radius="md"
      // The selected row keeps the pressed fill under the pointer; the others take the row wash.
      wash={selected ? "control" : "row"}
      data-selected={selected || undefined}
      className="group/row flex h-8 w-full min-w-0 items-center gap-1 pr-1 text-meta"
      style={{ paddingLeft: 8 + node.depth * 14 }}
      onContextMenu={(event: MouseEvent<HTMLElement>) => onContextMenu(event, node)}
    >
      <Tooltip content={node.path}>
        <Pressable
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-2",
            // What Git ignores stays usable but reads as secondary; the row's hover and
            // selection keep their strength.
            node.ignored && "opacity-50",
          )}
          aria-expanded={node.isDir ? node.expanded : undefined}
          onClick={handleClick}
        >
          {node.loading ? (
            <Text bare tone="muted" className="flex size-4 flex-none items-center justify-center">
              <Spinner label={false} />
            </Text>
          ) : (
            <Text
              bare
              tone={node.isDir ? "working" : "muted"}
              className="inline-flex size-4 flex-none items-center justify-center"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
          )}
          <Text
            tone={node.color ? nameTone[node.color] : "default"}
            className="max-w-full flex-none"
          >
            {node.name}
          </Text>
          {node.repository ? (
            <Tooltip content={repositoryLabel(node.repository)}>
              <Text
                bare
                tone={clean ? "added" : "changed"}
                weight="medium"
                className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-micro"
                aria-label={repositoryLabel(node.repository)}
              >
                <Text tone="muted" className="flex-1">
                  {node.repository.branch}
                </Text>
                {clean ? (
                  <span aria-hidden>✓</span>
                ) : (
                  <>
                    {node.repository.changed > 0 ? (
                      <Text bare tone="changed" className="flex-none" aria-hidden>
                        M{node.repository.changed}
                      </Text>
                    ) : null}
                    {node.repository.untracked > 0 ? (
                      <Text bare tone="added" className="flex-none" aria-hidden>
                        ?{node.repository.untracked}
                      </Text>
                    ) : null}
                  </>
                )}
              </Text>
            </Tooltip>
          ) : null}
        </Pressable>
      </Tooltip>
      {/* The row's tools show while the pointer is over it, or while one has focus. */}
      <RowTools reveal="hover">
        {isRoot ? (
          <>
            <TreeRootRefreshButton />
            <TreeRootViewActions root={node.path} />
          </>
        ) : null}
        <IconButton
          label="Add to chat"
          onClick={(event) => {
            event.stopPropagation();
            onMention(node.path, node.isDir);
          }}
        >
          <Plus aria-hidden />
        </IconButton>
      </RowTools>
    </Surface>
  );
});
