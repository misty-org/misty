import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { CodeExplorerEntry as FileEntry, CodeExplorerServices } from "./codeExplorerServices";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@/shared/ui";
import { FileIcon, FolderIcon } from "../icons/fileIcon";

interface CodeExplorerRowProps {
  entry: FileEntry;
  rootPath: string;
  refreshVersion?: string;
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

export function createCodeExplorerRow(
  services: Pick<CodeExplorerServices, "store" | "listDirectory" | "ErrorActivity">,
) {
  const {
    store: useCodingWorkspaceStore,
    listDirectory: codeListDirectory,
    ErrorActivity: SystemErrorActivity,
  } = services;
  const CodeExplorerRow = memo(function CodeExplorerRow({
    entry,
    rootPath,
    refreshVersion,
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
    const pendingMenuAction = useRef<(() => void) | null>(null);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        pendingMenuAction.current = null;
      };
    }, []);

    useEffect(() => registerEntry(entry), [entry, registerEntry]);

    useEffect(() => {
      if (!isDirectory || !expanded) return;
      let cancelled = false;
      setLoading(true);
      setError(null);
      codeListDirectory(entry.path)
        .then((listing) => {
          if (!cancelled) setChildren(sortEntries(listing.entries));
        })
        .catch((nextError: unknown) => {
          if (!cancelled)
            setError(
              nextError instanceof Error ? nextError.message : "Could not open this folder.",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [entry.path, expanded, isDirectory, refreshVersion]);

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
          <ContextMenuContent
            className="code-theme-overlay w-44"
            onCloseAutoFocus={(event) => {
              const action = pendingMenuAction.current;
              if (!action) return;
              event.preventDefault();
              pendingMenuAction.current = null;
              // Let the menu release its focus scope before opening a modal.
              queueMicrotask(() => {
                if (mounted.current) action();
              });
            }}
          >
            {!isDirectory ? (
              <ContextMenuItem onSelect={() => onOpenFileInNewTab(entry)}>
                Open in New Code Tab
              </ContextMenuItem>
            ) : null}
            {!isDirectory ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              onSelect={() => {
                pendingMenuAction.current = () =>
                  selectedPaths.size > 1
                    ? onRequestBatchRename()
                    : onRequestRename(entry.path, entry.name);
              }}
            >
              <Pencil />
              {selectedPaths.size > 1 ? `Rename ${selectedPaths.size} items` : "Rename"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="code-danger"
              onSelect={() => {
                pendingMenuAction.current = () =>
                  selectedPaths.size > 1
                    ? onRequestBatchDelete()
                    : onRequestDelete(entry.path, entry.name, isDirectory);
              }}
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
                refreshVersion={refreshVersion}
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

  return CodeExplorerRow;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
