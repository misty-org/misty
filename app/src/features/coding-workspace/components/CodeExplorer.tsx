import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus, FolderInput, FolderPlus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
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
import { useCodingWorkspaceStore, useDirtyPaths } from "../store/useCodingWorkspaceStore";
import { CodeExplorerRow } from "./CodeExplorerRow";

type NameDialogState =
  | { kind: "file" | "folder"; initialValue: string }
  | { kind: "rename"; initialValue: string; path: string };

interface DeleteTarget {
  path: string;
  name: string;
  isDirectory: boolean;
}

interface CodeExplorerProps {
  rootPath: string;
  viewId: string;
  onOpenFile: (path: string, name: string) => void;
  onOpenFileInNewTab: (path: string, name: string) => void;
  onOpenRoot: (path: string) => void;
}

export function CodeExplorer({
  rootPath,
  viewId,
  onOpenFile,
  onOpenFileInNewTab,
  onOpenRoot,
}: CodeExplorerProps) {
  const activeTabPath = useCodingWorkspaceStore(
    (state) => state.views[viewId]?.activeFilePath ?? null,
  );
  const removeBuffer = useCodingWorkspaceStore((state) => state.removeBuffer);
  const dirtyPaths = useDirtyPaths();
  const gitSnapshot = useGitStore((state) => state.snapshots[rootPath] ?? state.snapshot);
  const refreshGit = useGitStore((state) => state.refresh);

  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

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
        if (!cancelled) setRootEntries(sortEntries(listing.entries));
      })
      .catch((nextError: unknown) => {
        if (!cancelled)
          setError(nextError instanceof Error ? nextError.message : "Could not open that folder.");
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
    for (const entry of gitSnapshot?.files ?? []) map.set(entry.absolutePath, entry.status);
    return map;
  }, [gitSnapshot]);

  const handleOpenFile = useCallback(
    (entry: FileEntry) => onOpenFile(entry.path, entry.name),
    [onOpenFile],
  );

  const changeRoot = useCallback(async () => {
    try {
      const selection = await openDialog({ directory: true, multiple: false });
      if (typeof selection === "string" && selection.length > 0) onOpenRoot(selection);
    } catch {
      /* native picker cancellation */
    }
  }, [onOpenRoot]);

  const openNameDialog = useCallback((dialog: NameDialogState) => {
    setNameDraft(dialog.initialValue);
    setNameDialog(dialog);
  }, []);

  const submitNameDialog = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!rootPath || !nameDialog || !nameDraft.trim()) return;
      const name = nameDraft.trim();
      setBusyMessage(nameDialog.kind === "rename" ? `Renaming ${name}…` : `Creating ${name}…`);
      try {
        if (nameDialog.kind === "rename") {
          const parent = nameDialog.path.split("/").slice(0, -1).join("/");
          await codeRenamePath(nameDialog.path, `${parent}/${name}`);
        } else {
          const target = `${rootPath.replace(/\/$/, "")}/${name}`;
          if (nameDialog.kind === "file") {
            await codeCreateFile(target, "");
            const parts = name.split("/");
            onOpenFile(target, parts[parts.length - 1] ?? name);
          } else {
            await codeCreateFolder(target);
          }
        }
        setNameDialog(null);
        setReloadToken((token) => token + 1);
        void refreshGit(rootPath);
      } catch (nextError) {
        setOperationError(nextError instanceof Error ? nextError.message : "The operation failed.");
      } finally {
        setBusyMessage(null);
      }
    },
    [nameDialog, nameDraft, onOpenFile, refreshGit, rootPath],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await codeDeletePath(deleteTarget.path);
      setReloadToken((token) => token + 1);
      if (rootPath) void refreshGit(rootPath);
      const store = useCodingWorkspaceStore.getState();
      for (const buffer of Object.values(store.projectBuffers[rootPath] ?? {})) {
        if (
          buffer.path === deleteTarget.path ||
          (deleteTarget.isDirectory && buffer.path.startsWith(`${deleteTarget.path}/`))
        ) {
          removeBuffer(rootPath, buffer.path);
        }
      }
    } catch (nextError) {
      setOperationError(nextError instanceof Error ? nextError.message : "Could not delete.");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, refreshGit, removeBuffer, rootPath]);

  return (
    <div className="code-theme-sidebar flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-sidebar text-cream">
      <header className="code-explorer-header flex items-center justify-between border-b border-charcoal-border px-3">
        <span className="truncate font-semibold" title={rootPath ?? ""}>
          {rootName || "Explorer"}
        </span>
        <span className="flex items-center gap-1">
          <ExplorerIconButton
            label="New file"
            onClick={() => openNameDialog({ kind: "file", initialValue: "" })}
          >
            <FilePlus />
          </ExplorerIconButton>
          <ExplorerIconButton
            label="New folder"
            onClick={() => openNameDialog({ kind: "folder", initialValue: "" })}
          >
            <FolderPlus />
          </ExplorerIconButton>
          <ExplorerIconButton
            label="Reload folder"
            onClick={() => setReloadToken((token) => token + 1)}
          >
            <RotateCcw />
          </ExplorerIconButton>
          <ExplorerIconButton label="Open a different folder" onClick={() => void changeRoot()}>
            <FolderInput />
          </ExplorerIconButton>
        </span>
      </header>

      {busyMessage ? (
        <div className="border-b border-charcoal-border px-3 py-1.5 italic text-cream-muted">
          {busyMessage}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {loading && rootEntries === null ? (
          <p className="px-3 py-2 italic text-cream-muted">Loading…</p>
        ) : null}
        {error ? <p className="code-danger px-3 py-2 italic">{error}</p> : null}
        {rootEntries?.map((entry) => (
          <CodeExplorerRow
            key={entry.id}
            entry={entry}
            rootPath={rootPath}
            depth={0}
            activePath={activeTabPath}
            dirtyPaths={dirtyPaths}
            gitStatuses={gitStatuses}
            onOpenFile={handleOpenFile}
            onOpenFileInNewTab={(entry) => onOpenFileInNewTab(entry.path, entry.name)}
            onRequestRename={(path, name) =>
              openNameDialog({ kind: "rename", path, initialValue: name })
            }
            onRequestDelete={(path, name, isDirectory) =>
              setDeleteTarget({ path, name, isDirectory })
            }
          />
        ))}
      </div>

      <Dialog open={Boolean(nameDialog)} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent className="code-theme-overlay max-w-sm">
          <form onSubmit={(event) => void submitNameDialog(event)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {nameDialog?.kind === "rename"
                  ? "Rename item"
                  : nameDialog?.kind === "folder"
                    ? "New folder"
                    : "New file"}
              </DialogTitle>
              <DialogDescription>
                {nameDialog?.kind === "rename"
                  ? "Enter a new name. The file extension may be changed."
                  : `Create inside ${rootName}. Relative paths are supported.`}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              aria-label="Name"
              className="code-themed-control"
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!nameDraft.trim() || Boolean(busyMessage)}>
                {nameDialog?.kind === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="code-theme-overlay max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {deleteTarget?.isDirectory ? "folder and its contents" : "file"}
              from disk. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="code-destructive" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(operationError)} onOpenChange={() => setOperationError(null)}>
        <DialogContent className="code-theme-overlay max-w-sm">
          <DialogHeader>
            <DialogTitle>Couldn’t complete that action</DialogTitle>
            <DialogDescription>{operationError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">OK</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExplorerIconButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            onClick={props.onClick}
            className="code-interface-icon-button text-cream-muted"
          >
            {props.children}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="code-theme-overlay">{props.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
