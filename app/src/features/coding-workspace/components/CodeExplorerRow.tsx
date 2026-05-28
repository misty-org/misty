import { SystemErrorActivity } from "@/features/activity";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useState, type MouseEvent } from "react";
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
import { codeListDirectory } from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

interface CodeExplorerRowProps {
  entry: FileEntry;
  rootPath: string;
  depth: number;
  activePath: string | null;
  dirtyPaths: Set<string>;
  selectedPaths: Set<string>;
  registerEntry: (entry: FileEntry) => () => void;
  onSelectEntry: (entry: FileEntry, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenFile: (entry: FileEntry) => void;
  onOpenFileInNewTab: (entry: FileEntry) => void;
  onRequestRename: (path: string, name: string) => void;
  onRequestDelete: (path: string, name: string, isDirectory: boolean) => void;
  onRequestBatchRename: () => void;
  onRequestBatchDelete: () => void;
}

export const CodeExplorerRow = memo(function CodeExplorerRow({
  entry,
  rootPath,
  depth,
  activePath,
  dirtyPaths,
  selectedPaths,
  registerEntry,
  onSelectEntry,
  onOpenFile,
  onOpenFileInNewTab,
  onRequestRename,
  onRequestDelete,
  onRequestBatchRename,
  onRequestBatchDelete,
}: CodeExplorerRowProps) {
  const isDirectory = entry.kind === "folder";
  const expanded = useCodingWorkspaceStore((state) =>
    (state.projects[rootPath]?.expandedFolders ?? []).includes(entry.path),
  );
  const toggleFolder = useCodingWorkspaceStore((state) => state.toggleProjectFolder);

  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => registerEntry(entry), [entry, registerEntry]);

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

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onSelectEntry(entry, event);
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (isDirectory) toggleFolder(rootPath, entry.path);
      else onOpenFile(entry);
    },
    [entry, isDirectory, onOpenFile, onSelectEntry, rootPath, toggleFolder],
  );

  const isActive = !isDirectory && activePath === entry.path;
  const isDirty = !isDirectory && dirtyPaths.has(entry.path);
  const isSelected = selectedPaths.has(entry.path);
  const indent = 8 + depth * 12;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className={cn(
              "code-explorer-row group my-0.5 flex w-full items-center gap-2 rounded-md py-0.5 pr-2 text-left",
              "text-cream-muted hover:bg-charcoal-hover hover:text-cream",
              isActive && "bg-charcoal-hover font-medium text-cream-bright",
              isSelected && "bg-charcoal-active text-cream-bright",
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
          <ContextMenuItem
            onSelect={() =>
              selectedPaths.size > 1
                ? onRequestBatchRename()
                : onRequestRename(entry.path, entry.name)
            }
          >
            <Pencil />
            {selectedPaths.size > 1 ? `Rename ${selectedPaths.size} items` : "Rename"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="code-danger"
            onSelect={() =>
              selectedPaths.size > 1
                ? onRequestBatchDelete()
                : onRequestDelete(entry.path, entry.name, isDirectory)
            }
          >
            <Trash2 />
            {selectedPaths.size > 1 ? `Delete ${selectedPaths.size} items` : "Delete"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isDirectory && expanded ? (
        <div className="flex flex-col">
          {loading && children === null ? (
            <div
              className="py-1 text-[11px] italic text-cream-muted/60"
              style={{ paddingLeft: indent + 20 }}
            >
              Loading…
            </div>
          ) : null}
          {error ? (
            <SystemErrorActivity
              error={error}
              scope={`code:folder:${entry.path}`}
              title="Code folder could not be loaded"
              target={{ kind: "route", href: "/code" }}
            />
          ) : null}
          {children?.map((child) => (
            <CodeExplorerRow
              key={child.id}
              entry={child}
              rootPath={rootPath}
              depth={depth + 1}
              activePath={activePath}
              dirtyPaths={dirtyPaths}
              selectedPaths={selectedPaths}
              registerEntry={registerEntry}
              onSelectEntry={onSelectEntry}
              onOpenFile={onOpenFile}
              onOpenFileInNewTab={onOpenFileInNewTab}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
              onRequestBatchRename={onRequestBatchRename}
              onRequestBatchDelete={onRequestBatchDelete}
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
