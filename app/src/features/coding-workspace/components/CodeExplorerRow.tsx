import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import type { FileEntry } from "@/native/contracts/app-explorer";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@/shared/ui";
import { FileIcon, FolderIcon } from "../icons/fileIcon";
import type { GitFileStatus } from "../native";
import { codeListDirectory } from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

interface CodeExplorerRowProps {
  entry: FileEntry;
  rootPath: string;
  depth: number;
  activePath: string | null;
  dirtyPaths: Set<string>;
  gitStatuses: Map<string, GitFileStatus>;
  onOpenFile: (entry: FileEntry) => void;
  onOpenFileInNewTab: (entry: FileEntry) => void;
  onRequestRename: (path: string, name: string) => void;
  onRequestDelete: (path: string, name: string, isDirectory: boolean) => void;
}

const STATUS_CLASS: Record<GitFileStatus, string> = {
  modified: "code-warning",
  added: "code-success",
  deleted: "code-danger",
  renamed: "code-info",
  untracked: "code-success",
  ignored: "code-muted",
  conflicted: "code-danger",
};

const STATUS_LETTER: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  ignored: "I",
  conflicted: "!",
};

export const CodeExplorerRow = memo(function CodeExplorerRow({
  entry,
  rootPath,
  depth,
  activePath,
  dirtyPaths,
  gitStatuses,
  onOpenFile,
  onOpenFileInNewTab,
  onRequestRename,
  onRequestDelete,
}: CodeExplorerRowProps) {
  const isDirectory = entry.kind === "folder";
  const expanded = useCodingWorkspaceStore((state) =>
    (state.projects[rootPath]?.expandedFolders ?? []).includes(entry.path),
  );
  const toggleFolder = useCodingWorkspaceStore((state) => state.toggleProjectFolder);

  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDirectory || !expanded || children !== null || loading) return;
    setLoading(true);
    setError(null);
    codeListDirectory(entry.path)
      .then((listing) => {
        setChildren(sortEntries(listing.entries));
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : "Could not open this folder.");
      })
      .finally(() => setLoading(false));
  }, [entry.path, expanded, isDirectory, children, loading]);

  const handleClick = useCallback(() => {
    if (isDirectory) toggleFolder(rootPath, entry.path);
    else onOpenFile(entry);
  }, [entry, isDirectory, onOpenFile, rootPath, toggleFolder]);

  const isActive = !isDirectory && activePath === entry.path;
  const isDirty = !isDirectory && dirtyPaths.has(entry.path);
  const status = gitStatuses.get(entry.path);
  const indent = 8 + depth * 12;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className={cn(
              "code-explorer-row group flex w-full items-center gap-2 rounded-md pr-2 text-left",
              "text-cream-muted hover:bg-charcoal-hover hover:text-cream",
              isActive && "bg-charcoal-hover font-medium text-cream-bright",
              status && STATUS_CLASS[status],
            )}
            style={{ paddingLeft: indent }}
          >
            {isDirectory ? (
              expanded ? (
                <ChevronDown className="code-explorer-chevron shrink-0 text-cream-muted/60" />
              ) : (
                <ChevronRight className="code-explorer-chevron shrink-0 text-cream-muted/60" />
              )
            ) : (
              <span className="inline-block shrink-0 code-explorer-chevron" />
            )}
            {isDirectory ? (
              <FolderIcon name={entry.name} open={expanded} />
            ) : (
              <FileIcon name={entry.name} />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {status ? (
              <span className={cn("font-mono text-[11px]", STATUS_CLASS[status])} title={status}>
                {STATUS_LETTER[status]}
              </span>
            ) : null}
            {isDirty ? <span className="code-accent text-[13px]">●</span> : null}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="code-theme-overlay w-44">
          {!isDirectory ? (
            <ContextMenuItem onSelect={() => onOpenFileInNewTab(entry)}>
              Open in New Code Tab
            </ContextMenuItem>
          ) : null}
          {!isDirectory ? <ContextMenuSeparator /> : null}
          <ContextMenuItem onSelect={() => onRequestRename(entry.path, entry.name)}>
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="code-danger"
            onSelect={() => onRequestDelete(entry.path, entry.name, isDirectory)}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isDirectory && expanded ? (
        <div>
          {loading && children === null ? (
            <div
              className="py-1 text-[11px] italic text-cream-muted/60"
              style={{ paddingLeft: indent + 20 }}
            >
              Loading…
            </div>
          ) : null}
          {error ? (
            <div
              className="code-danger py-1 text-[11px] italic"
              style={{ paddingLeft: indent + 20 }}
            >
              {error}
            </div>
          ) : null}
          {children?.map((child) => (
            <CodeExplorerRow
              key={child.id}
              entry={child}
              rootPath={rootPath}
              depth={depth + 1}
              activePath={activePath}
              dirtyPaths={dirtyPaths}
              gitStatuses={gitStatuses}
              onOpenFile={onOpenFile}
              onOpenFileInNewTab={onOpenFileInNewTab}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
