import { MistyFilePicker } from "@/features/picker";
import { FilePlus, FolderInput, FolderPlus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { SystemErrorActivity } from "@/features/activity";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
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
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueueRenameItems,
} from "@/features/files/native";
import {
  codeCreateFile,
  codeCreateFolder,
  codeDeletePath,
  codeListDirectory,
  codeRenamePath,
} from "../native";
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

interface BatchRenameItem extends DeleteTarget {
  draft: string;
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

  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<DeleteTarget[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [batchRenameItems, setBatchRenameItems] = useState<BatchRenameItem[] | null>(null);
  const [renamePattern, setRenamePattern] = useState("{name}{ext}");
  const [renameFind, setRenameFind] = useState("");
  const [renameReplace, setRenameReplace] = useState("");
  const [renameStart, setRenameStart] = useState(1);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [fileClipboard, setFileClipboard] = useState<{
    operation: "copy" | "move";
    sources: Array<{ path: string; isDirectory: boolean }>;
  } | null>(null);
  const entriesRef = useRef(new Map<string, FileEntry>());
  const visibleOrderRef = useRef<string[]>([]);

  const rootName = useMemo(() => {
    if (!rootPath) return "";
    const parts = rootPath.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? rootPath;
  }, [rootPath]);

  useEffect(() => {
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    entriesRef.current.clear();
    visibleOrderRef.current = [];
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

  const handleOpenFile = useCallback(
    (entry: FileEntry) => onOpenFile(entry.path, entry.name),
    [onOpenFile],
  );

  const registerEntry = useCallback((entry: FileEntry) => {
    entriesRef.current.set(entry.path, entry);
    if (!visibleOrderRef.current.includes(entry.path)) visibleOrderRef.current.push(entry.path);
    return () => {
      entriesRef.current.delete(entry.path);
      visibleOrderRef.current = visibleOrderRef.current.filter((path) => path !== entry.path);
    };
  }, []);

  const handleSelectEntry = useCallback(
    (entry: FileEntry, event: MouseEvent<HTMLButtonElement>) => {
      setSelectedPaths((current) => {
        if (event.shiftKey && selectionAnchor) {
          const order = visibleOrderRef.current;
          const start = order.indexOf(selectionAnchor);
          const end = order.indexOf(entry.path);
          if (start >= 0 && end >= 0) {
            const [from, to] = start < end ? [start, end] : [end, start];
            return new Set(order.slice(from, to + 1));
          }
        }
        if (event.metaKey || event.ctrlKey) {
          const next = new Set(current);
          if (next.has(entry.path)) next.delete(entry.path);
          else next.add(entry.path);
          return next;
        }
        return new Set([entry.path]);
      });
      if (!event.shiftKey) setSelectionAnchor(entry.path);
    },
    [selectionAnchor],
  );

  const selectedEntries = useCallback(
    () =>
      [...selectedPaths].map((path) => entriesRef.current.get(path)).filter(Boolean) as FileEntry[],
    [selectedPaths],
  );

  const openBatchRename = useCallback(() => {
    const items = selectedEntries();
    if (items.length < 2) return;
    setBatchRenameItems(
      items.map((entry) => ({
        path: entry.path,
        name: entry.name,
        isDirectory: entry.kind === "folder",
        draft: entry.name,
      })),
    );
  }, [selectedEntries]);

  const openBatchDelete = useCallback(() => {
    setDeleteTargets(
      selectedEntries().map((entry) => ({
        path: entry.path,
        name: entry.name,
        isDirectory: entry.kind === "folder",
      })),
    );
  }, [selectedEntries]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const changeRoot = useCallback(() => {
    setPickerOpen(true);
  }, []);

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
      } catch (nextError) {
        setOperationError(nextError instanceof Error ? nextError.message : "The operation failed.");
      } finally {
        setBusyMessage(null);
      }
    },
    [nameDialog, nameDraft, onOpenFile, rootPath],
  );

  const confirmDelete = useCallback(async () => {
    if (deleteTargets.length === 0) return;
    try {
      if (deleteTargets.length === 1) await codeDeletePath(deleteTargets[0]!.path);
      else
        await explorerQueueDeleteItems({
          paths: deleteTargets.map((target) => target.path),
          permanent: true,
        });
      setReloadToken((token) => token + 1);
      const store = useCodingWorkspaceStore.getState();
      for (const target of deleteTargets) {
        for (const buffer of Object.values(store.projectBuffers[rootPath] ?? {})) {
          if (
            buffer.path === target.path ||
            (target.isDirectory && buffer.path.startsWith(`${target.path}/`))
          ) {
            removeBuffer(rootPath, buffer.path);
          }
        }
      }
      setSelectedPaths(new Set());
    } catch (nextError) {
      setOperationError(nextError instanceof Error ? nextError.message : "Could not delete.");
    } finally {
      setDeleteTargets([]);
    }
  }, [deleteTargets, removeBuffer, rootPath]);

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

      {selectedPaths.size > 1 ? (
        <div className="flex items-center gap-1 border-b border-charcoal-border px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-xs text-cream-muted">
            {selectedPaths.size} selected
          </span>
          <ExplorerIconButton label="Batch rename" onClick={openBatchRename}>
            <Pencil />
          </ExplorerIconButton>
          <ExplorerIconButton label="Delete selected" onClick={openBatchDelete}>
            <Trash2 />
          </ExplorerIconButton>
        </div>
      ) : null}

      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto p-1.5"
        tabIndex={0}
        onKeyDown={(event) => {
          const command = event.metaKey || event.ctrlKey;
          if (command && event.key.toLowerCase() === "a") {
            event.preventDefault();
            setSelectedPaths(new Set(visibleOrderRef.current));
          } else if (
            command &&
            (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "x") &&
            selectedPaths.size > 0
          ) {
            event.preventDefault();
            setFileClipboard({
              operation: event.key.toLowerCase() === "x" ? "move" : "copy",
              sources: selectedEntries().map((entry) => ({
                path: entry.path,
                isDirectory: entry.kind === "folder",
              })),
            });
          } else if (command && event.key.toLowerCase() === "v" && fileClipboard) {
            event.preventDefault();
            const selected = selectedEntries();
            const destinationDirectory =
              selected.length === 1 && selected[0]?.kind === "folder" ? selected[0].path : rootPath;
            setBusyMessage(
              `${fileClipboard.operation === "move" ? "Moving" : "Copying"} ${fileClipboard.sources.length} items…`,
            );
            void explorerQueuePasteItems({
              sources: fileClipboard.sources,
              destinationDirectory,
              operation: fileClipboard.operation,
            })
              .then(() => {
                if (fileClipboard.operation === "move") setFileClipboard(null);
                setReloadToken((token) => token + 1);
              })
              .catch((nextError: unknown) => {
                setOperationError(
                  nextError instanceof Error ? nextError.message : "Could not paste the selection.",
                );
              })
              .finally(() => setBusyMessage(null));
          } else if (event.key === "F2" && selectedPaths.size > 1) {
            event.preventDefault();
            openBatchRename();
          } else if (
            (event.key === "Delete" || event.key === "Backspace") &&
            selectedPaths.size > 0
          ) {
            event.preventDefault();
            openBatchDelete();
          }
        }}
      >
        {loading && rootEntries === null ? (
          <p className="px-3 py-2 italic text-cream-muted">Loading…</p>
        ) : null}
        {error ? (
          <SystemErrorActivity
            error={error}
            scope="code:explorer"
            title="Code files could not be loaded"
            target={{ kind: "route", href: "/code" }}
          />
        ) : null}
        {rootEntries?.map((entry) => (
          <CodeExplorerRow
            key={entry.id}
            entry={entry}
            rootPath={rootPath}
            depth={0}
            activePath={activeTabPath}
            dirtyPaths={dirtyPaths}
            selectedPaths={selectedPaths}
            registerEntry={registerEntry}
            onSelectEntry={handleSelectEntry}
            onOpenFile={handleOpenFile}
            onOpenFileInNewTab={(entry) => onOpenFileInNewTab(entry.path, entry.name)}
            onRequestRename={(path, name) =>
              openNameDialog({ kind: "rename", path, initialValue: name })
            }
            onRequestDelete={(path, name, isDirectory) =>
              setDeleteTargets([{ path, name, isDirectory }])
            }
            onRequestBatchRename={openBatchRename}
            onRequestBatchDelete={openBatchDelete}
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

      <Dialog
        open={Boolean(batchRenameItems)}
        onOpenChange={(open) => !open && setBatchRenameItems(null)}
      >
        <DialogContent className="code-theme-overlay max-h-[80vh] max-w-2xl overflow-hidden">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!batchRenameItems) return;
              const targets = batchRenameItems.map((item) => ({
                ...item,
                draft: item.draft.trim(),
                target: `${item.path.split("/").slice(0, -1).join("/")}/${item.draft.trim()}`,
              }));
              const duplicate = targets.find(
                (item, index) =>
                  !item.draft ||
                  targets.some(
                    (other, otherIndex) => otherIndex !== index && other.target === item.target,
                  ),
              );
              if (duplicate) {
                setOperationError("Every selected item needs a unique, non-empty name.");
                return;
              }
              setBusyMessage(`Renaming ${targets.length} items…`);
              void explorerQueueRenameItems({
                items: targets.map((item) => ({
                  path: item.path,
                  newName: item.draft,
                  sourceIsDirectory: item.isDirectory,
                })),
              })
                .then(() => {
                  setBatchRenameItems(null);
                  setSelectedPaths(new Set());
                  setReloadToken((token) => token + 1);
                })
                .catch((nextError: unknown) => {
                  setOperationError(
                    nextError instanceof Error
                      ? nextError.message
                      : "Could not rename the selection.",
                  );
                })
                .finally(() => setBusyMessage(null));
            }}
            className="flex min-h-0 flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Rename {batchRenameItems?.length ?? 0} items</DialogTitle>
              <DialogDescription>
                Review every target name or apply a pattern. Use {`{name}`}, {`{ext}`}, and {`{n}`}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-[1fr_1fr_88px_auto] gap-2">
              <Input
                value={renameFind}
                onChange={(event) => setRenameFind(event.target.value)}
                placeholder="Find"
                aria-label="Find in names"
              />
              <Input
                value={renameReplace}
                onChange={(event) => setRenameReplace(event.target.value)}
                placeholder="Replace"
                aria-label="Replace in names"
              />
              <Input
                type="number"
                min={0}
                value={renameStart}
                onChange={(event) => setRenameStart(Number(event.target.value) || 0)}
                aria-label="Starting number"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setBatchRenameItems(
                    (items) =>
                      items?.map((item, index) => ({
                        ...item,
                        draft: batchRenameName(
                          item.name,
                          renamePattern,
                          renameFind,
                          renameReplace,
                          renameStart + index,
                        ),
                      })) ?? null,
                  )
                }
              >
                Apply
              </Button>
            </div>
            <Input
              value={renamePattern}
              onChange={(event) => setRenamePattern(event.target.value)}
              aria-label="Rename pattern"
              placeholder="{name}{ext}"
            />
            <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {batchRenameItems?.map((item, index) => (
                <label
                  key={item.path}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-xs"
                >
                  <span className="truncate text-cream-muted" title={item.path}>
                    {item.name}
                  </span>
                  <Input
                    value={item.draft}
                    aria-label={`New name for ${item.name}`}
                    onChange={(event) =>
                      setBatchRenameItems(
                        (items) =>
                          items?.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, draft: event.target.value }
                              : candidate,
                          ) ?? null,
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={Boolean(busyMessage)}>
                Rename selected
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTargets.length > 0}
        onOpenChange={(open) => !open && setDeleteTargets([])}
      >
        <AlertDialogContent className="code-theme-overlay max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTargets.length > 1
                ? `Delete ${deleteTargets.length} items?`
                : `Delete ${deleteTargets[0]?.name ?? "item"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected{" "}
              {deleteTargets.length === 1 && deleteTargets[0]?.isDirectory
                ? "folder and its contents"
                : deleteTargets.length === 1
                  ? "file"
                  : "items"}{" "}
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

      {operationError ? (
        <SystemErrorActivity
          error={operationError}
          scope="code:explorer:operation"
          title="File operation could not be completed"
          target={{ kind: "route", href: "/code" }}
        />
      ) : null}

      {pickerOpen ? (
        <MistyFilePicker
          mode="folder"
          title="Open project folder"
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false);
            onOpenRoot(path);
          }}
        />
      ) : null}
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

function batchRenameName(
  original: string,
  pattern: string,
  find: string,
  replacement: string,
  number: number,
) {
  const dot = original.lastIndexOf(".");
  const hasExtension = dot > 0;
  const extension = hasExtension ? original.slice(dot) : "";
  const stem = hasExtension ? original.slice(0, dot) : original;
  const transformed = find ? stem.split(find).join(replacement) : stem;
  return pattern
    .split("{name}")
    .join(transformed)
    .split("{ext}")
    .join(extension)
    .split("{n}")
    .join(String(number));
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
