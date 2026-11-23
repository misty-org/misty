// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronsDown, ChevronsUp, Plus, RotateCw, Search } from "lucide-react";
import { memo, useCallback, useMemo, type MouseEvent } from "react";
import {
  Button,
  cn,
  FoldChevron,
  IconButton,
  Pressable,
  RowTools,
  Skeleton,
  Surface,
  Text,
  Tooltip,
  type TextTone,
} from "@misty/ui";
import type { FileTreeColor, RepositorySummary } from "./files_api";
import { getFileTreeIconSvg } from "./file_icons";
import { useFilesStore } from "./files_store";
import type { VisibleNode } from "./visible_nodes";
import { remCss } from "@misty/ui";

function repositoryLabel(repo: RepositorySummary): string {
  if (repo.changed + repo.untracked === 0) return `${repo.branch}, no changes`;
  const parts = [repo.branch];
  if (repo.changed > 0) parts.push(`${repo.changed} changed`);
  if (repo.untracked > 0) parts.push(`${repo.untracked} new`);
  return parts.join(", ");
}

const nameTone: Record<FileTreeColor, TextTone> = {
  modified: "changed",
  untracked: "added",
  repository: "working",
};

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
      <RotateCw aria-hidden />
    </IconButton>
  );
}

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
  isRoot: boolean;
  onToggleDir(paths: string[]): void;
  onOpenFile(path: string): void;
  onSelectDir(path: string): void;
  onContextMenu(event: MouseEvent<HTMLElement>, node: VisibleNode): void;
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

  const root = useFilesStore((state) => state.root);
  const shownPath =
    root && node.path.startsWith(`${root}/`) ? node.path.slice(root.length + 1) : node.path;
  const iconSvg = useMemo(
    () => getFileTreeIconSvg(node.name, node.isDir, node.expanded),
    [node.name, node.isDir, node.expanded],
  );
  const clean = node.repository && node.repository.changed + node.repository.untracked === 0;

  return (
    <Surface
      tone="none"
      radius="md"
      wash={selected ? "control" : "row"}
      data-selected={selected || undefined}
      className="group/row flex h-8 w-full min-w-0 items-center gap-1 pr-1 text-meta"
      style={rowInset(node.depth)}
      onContextMenu={(event: MouseEvent<HTMLElement>) => onContextMenu(event, node)}
    >
      <Tooltip content={shownPath}>
        <Pressable
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-2",
            node.ignored && "opacity-50",
          )}
          aria-expanded={node.isDir ? node.expanded : undefined}
          onClick={handleClick}
        >
          {isRoot ? null : node.isDir ? (
            <Text bare tone="muted" className="inline-flex flex-none" aria-hidden>
              <FoldChevron open={Boolean(node.expanded)} />
            </Text>
          ) : (
            <span className="size-4 flex-none" aria-hidden />
          )}
          <Text
            bare
            tone={node.isDir ? "working" : "muted"}
            className="inline-flex size-4 flex-none items-center justify-center"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: iconSvg }}
          />
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

const rowInset = (depth: number) => ({ paddingLeft: remCss(8 + depth * 14) });

const childNameWidths = ["w-2/5", "w-1/2", "w-1/3"];

export function TreeChildRowsSkeleton({ depth, label }: { depth: number; label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      {childNameWidths.map((width, index) => (
        <div key={index} className="flex h-8 items-center gap-2 pr-1" style={rowInset(depth)}>
          <span className="size-4 flex-none" aria-hidden />
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className={cn("h-3 rounded-sm", width)} />
        </div>
      ))}
    </div>
  );
}

export function TreeChildErrorRow(props: { depth: number; error: string; onRetry(): void }) {
  return (
    <div
      role="alert"
      className="flex min-h-8 min-w-0 items-center gap-2 py-1 pr-1"
      style={rowInset(props.depth)}
    >
      <span className="size-4 flex-none" aria-hidden />
      <Text size="caption" tone="removed" className="min-w-0 flex-1">
        {props.error}
      </Text>
      <Button size="sm" variant="secondary" onClick={props.onRetry}>
        Try again
      </Button>
    </div>
  );
}
