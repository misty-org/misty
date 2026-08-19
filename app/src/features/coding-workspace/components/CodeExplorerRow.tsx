import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import type { FileEntry } from "@/native/contracts/app-explorer";
import { cn } from "@/shared/ui";
import { FileIcon, FolderIcon } from "../icons/fileIcon";
import type { GitFileStatus } from "../native";
import { codeListDirectory } from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

interface CodeExplorerRowProps {
  entry: FileEntry;
  depth: number;
  activePath: string | null;
  dirtyPaths: Set<string>;
  gitStatuses: Map<string, GitFileStatus>;
  onOpenFile: (entry: FileEntry) => void;
  onRequestRename: (path: string) => void;
  onRequestDelete: (path: string, isDirectory: boolean) => void;
}

const STATUS_COLOR: Record<GitFileStatus, string> = {
  modified: "#d4b880",
  added: "#a8c090",
  deleted: "#d68b80",
  renamed: "#a9c7e2",
  untracked: "#a8c090",
  ignored: "#5a5a5a",
  conflicted: "#efab9f",
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
  depth,
  activePath,
  dirtyPaths,
  gitStatuses,
  onOpenFile,
  onRequestRename,
  onRequestDelete,
}: CodeExplorerRowProps) {
  const isDirectory = entry.kind === "folder";
  const expanded = useCodingWorkspaceStore((state) => state.expandedFolders.includes(entry.path));
  const toggleFolder = useCodingWorkspaceStore((state) => state.toggleFolder);

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
    if (isDirectory) toggleFolder(entry.path);
    else onOpenFile(entry);
  }, [entry, isDirectory, onOpenFile, toggleFolder]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const action = window.prompt(
        `Rename or delete "${entry.name}"?\nType "delete" to delete, or the new name to rename.`,
        entry.name,
      );
      if (action == null) return;
      if (action.trim() === "delete") {
        if (window.confirm(`Really delete ${entry.name}?`)) {
          onRequestDelete(entry.path, isDirectory);
        }
      } else if (action.trim() !== entry.name) {
        onRequestRename(entry.path);
        window.dispatchEvent(
          new CustomEvent("misty:code-rename-request", {
            detail: { path: entry.path, newName: action.trim() },
          }),
        );
      }
    },
    [entry, isDirectory, onRequestDelete, onRequestRename],
  );

  const isActive = !isDirectory && activePath === entry.path;
  const isDirty = !isDirectory && dirtyPaths.has(entry.path);
  const status = gitStatuses.get(entry.path);
  const indent = 8 + depth * 12;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[12px]",
          "text-cream-muted hover:bg-charcoal-hover hover:text-cream",
          isActive && "bg-charcoal-hover text-cream-bright",
        )}
        style={{ paddingLeft: indent, color: status ? STATUS_COLOR[status] : undefined }}
      >
        {isDirectory ? (
          expanded ? (
            <ChevronDown size={12} className="shrink-0 text-cream-muted/60" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-cream-muted/60" />
          )
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}
        {isDirectory ? <FolderIcon open={expanded} /> : <FileIcon name={entry.name} />}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {status ? (
          <span
            className="font-mono text-[10px]"
            style={{ color: STATUS_COLOR[status] }}
            title={status}
          >
            {STATUS_LETTER[status]}
          </span>
        ) : null}
        {isDirty ? <span className="text-[10px] text-[#e8d9c0]">●</span> : null}
      </button>

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
              className="py-1 text-[11px] italic text-[#d68b80]"
              style={{ paddingLeft: indent + 20 }}
            >
              {error}
            </div>
          ) : null}
          {children?.map((child) => (
            <CodeExplorerRow
              key={child.id}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              dirtyPaths={dirtyPaths}
              gitStatuses={gitStatuses}
              onOpenFile={onOpenFile}
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
