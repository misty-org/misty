import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  FilePlus,
  FolderInput,
  FolderPlus,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@/native/contracts/app-explorer";
import {
  codeCreateFile,
  codeCreateFolder,
  codeDeletePath,
  codeListDirectory,
  codeRenamePath,
  type GitFileStatus,
} from "../native";
import { useGitStore } from "../git/useGitStore";
import { openFileInWorkspace } from "../openFile";
import {
  useCodingWorkspaceStore,
  useDirtyPaths,
} from "../store/useCodingWorkspaceStore";
import { CodeExplorerRow } from "./CodeExplorerRow";

export function CodeExplorer() {
  const rootPath = useCodingWorkspaceStore((state) => state.rootPath);
  const setRootPath = useCodingWorkspaceStore((state) => state.setRootPath);
  const activeTabPath = useCodingWorkspaceStore(
    (state) =>
      state.groups.find((group) => group.id === state.activeGroupId)?.activeTabPath ?? null,
  );
  const closeTab = useCodingWorkspaceStore((state) => state.closeTab);
  const dirtyPaths = useDirtyPaths();
  const gitSnapshot = useGitStore((state) => state.snapshot);
  const refreshGit = useGitStore((state) => state.refresh);

  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  const rootName = useMemo(() => {
    if (!rootPath) return "";
    const parts = rootPath.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? rootPath;
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      setRootEntries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    codeListDirectory(rootPath)
      .then((listing) => {
        if (cancelled) return;
        setRootEntries(sortEntries(listing.entries));
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(
          nextError instanceof Error ? nextError.message : "Could not open that folder.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, reloadToken]);

  const gitStatuses = useMemo(() => {
    const map = new Map<string, GitFileStatus>();
    if (!gitSnapshot?.files) return map;
    for (const entry of gitSnapshot.files) {
      map.set(entry.absolutePath, entry.status);
    }
    return map;
  }, [gitSnapshot]);

  const handleOpenFile = useCallback((entry: FileEntry) => {
    openFileInWorkspace(entry.path, entry.name);
  }, []);

  const changeRoot = useCallback(async () => {
    try {
      const selection = await openDialog({ directory: true, multiple: false });
      if (typeof selection === "string" && selection.length > 0) {
        setRootPath(selection);
      }
    } catch {
      /* dialog cancelled */
    }
  }, [setRootPath]);

  const doCreate = useCallback(
    async (kind: "file" | "folder") => {
      if (!rootPath) return;
      const name = window.prompt(`Name of new ${kind} (relative to ${rootName})`);
      if (!name?.trim()) return;
      setBusyMessage(`Creating ${name}…`);
      try {
        const target = `${rootPath.replace(/\/$/, "")}/${name.trim()}`;
        if (kind === "file") await codeCreateFile(target, "");
        else await codeCreateFolder(target);
        setReloadToken((token) => token + 1);
        if (kind === "file") {
          const parts = name.trim().split("/");
          openFileInWorkspace(target, parts[parts.length - 1] ?? name.trim());
        }
        void refreshGit(rootPath);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not create.");
      } finally {
        setBusyMessage(null);
      }
    },
    [refreshGit, rootPath, rootName],
  );

  useEffect(() => {
    const handleRename = async (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; newName: string }>).detail;
      if (!detail || !rootPath) return;
      const trimmedName = detail.newName.trim();
      if (!trimmedName) return;
      const parent = detail.path.split("/").slice(0, -1).join("/");
      const dest = `${parent}/${trimmedName}`;
      try {
        await codeRenamePath(detail.path, dest);
        setReloadToken((token) => token + 1);
        void refreshGit(rootPath);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not rename.");
      }
    };
    window.addEventListener("misty:code-rename-request", handleRename);
    return () => window.removeEventListener("misty:code-rename-request", handleRename);
  }, [refreshGit, rootPath]);

  const handleDelete = useCallback(
    async (path: string, isDirectory: boolean) => {
      try {
        await codeDeletePath(path);
        setReloadToken((token) => token + 1);
        if (rootPath) void refreshGit(rootPath);
        // Close any tabs matching path or under it if directory
        const store = useCodingWorkspaceStore.getState();
        for (const group of store.groups) {
          for (const tab of group.tabs) {
            if (tab.path === path || (isDirectory && tab.path.startsWith(`${path}/`))) {
              closeTab(group.id, tab.path);
            }
          }
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not delete.");
      }
    },
    [closeTab, refreshGit, rootPath],
  );

  const handleRename = useCallback((_path: string) => {
    /* The prompt handler in the row already dispatches; nothing else to do here. */
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-sidebar">
      <header className="flex h-8 items-center justify-between border-b border-charcoal-border px-3 text-[10px] uppercase tracking-[0.18em] text-cream-muted">
        <span className="truncate" title={rootPath ?? ""}>
          {rootName || "Explorer"}
        </span>
        <span className="flex items-center gap-1 text-cream-muted/60">
          <IconButton label="New file" onClick={() => void doCreate("file")}>
            <FilePlus size={11} />
          </IconButton>
          <IconButton label="New folder" onClick={() => void doCreate("folder")}>
            <FolderPlus size={11} />
          </IconButton>
          <IconButton label="Reload folder" onClick={() => setReloadToken((token) => token + 1)}>
            <RotateCcw size={11} />
          </IconButton>
          <IconButton label="Open a different folder" onClick={() => void changeRoot()}>
            <FolderInput size={11} />
          </IconButton>
        </span>
      </header>
      {busyMessage ? (
        <div className="border-b border-charcoal-border px-3 py-1 text-[11px] italic text-cream-muted">
          {busyMessage}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto py-1 pl-1 pr-1">
        {loading && rootEntries === null ? (
          <p className="px-3 py-2 text-[11px] italic text-cream-muted/60">Loading…</p>
        ) : null}
        {error ? (
          <p className="px-3 py-2 text-[11px] italic text-[#d68b80]">{error}</p>
        ) : null}
        {rootEntries?.map((entry) => (
          <CodeExplorerRow
            key={entry.id}
            entry={entry}
            depth={0}
            activePath={activeTabPath}
            dirtyPaths={dirtyPaths}
            gitStatuses={gitStatuses}
            onOpenFile={handleOpenFile}
            onRequestRename={handleRename}
            onRequestDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded hover:bg-charcoal-hover hover:text-cream"
    >
      {children}
    </button>
  );
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
