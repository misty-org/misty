import { create } from "zustand";
import { createSdkFilesHistory } from "./sdkFilesHistory";
import type { MistyFileTransferStatus } from "@misty/sdk";
import { createSdkFilesTrash, type SdkFilesTrashItem } from "./sdkFilesTrash";
import type { MistyAppSDK, MistyArchiveFormat } from "@misty/sdk";
import type { FileEntry } from "@/native/contracts";
import type { ExplorerSortState, PaneExplorerState } from "./explorer/model/interfaces/store/types";
import type {
  ExplorerCommandQueryMode,
  ExplorerSortColumn,
  ExplorerViewMode,
  NavigationMode,
} from "./explorer/model/types/store/types";
import { applyNavigationResult } from "./explorer/utils/paneNavigation";
import { sortListing } from "./explorer/utils/sortListing";
import {
  openSdkFilesDirectory,
  transferSdkFilesEntry,
  type SdkFilesDirectory,
} from "./sdkFilesDirectory";

import { createSdkFilesEditing, type SdkFilesEditingState } from "./sdkFilesEditing";

interface FilesState extends SdkFilesEditingState {
  folders: SdkFilesDirectory[];
  transfers: Array<{
    id: string;
    name: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    bytes: number;
    message: string;
  }>;
  recent: FileEntry[];
  starred: FileEntry[];
  trashItems: SdkFilesTrashItem[];
  clipboard: { operation: "copy" | "move"; paths: string[] } | null;
  pane: PaneExplorerState;
  viewMode: ExplorerViewMode;
  itemScale: number;
  sort: ExplorerSortState;
  showHidden: boolean;
  busy: boolean;
  error: string | null;
}
type Clipboard = { folder: SdkFilesDirectory; entries: FileEntry[]; operation: "copy" | "move" };

/** One mounted Files view owns its grants, requests and explorer state. */
export function createSdkFilesStore(misty: Pick<MistyAppSDK, "files">, signal: AbortSignal) {
  const lifetime = new AbortController();
  const folders = new Set<SdkFilesDirectory>();
  const history = createSdkFilesHistory(lifetime.signal);
  const transfers = new Map<string, { cancel: AbortController; retry: () => Promise<unknown> }>();
  let closed = false,
    navigation = 0,
    queued = 0;
  let tail = Promise.resolve<unknown>(undefined);
  let clipboard: Clipboard | null = null;
  let trash: Promise<Awaited<ReturnType<typeof createSdkFilesTrash>>> | undefined;
  const store = create<FilesState>(() => ({
    folders: [],
    transfers: [],
    recent: [],
    starred: [],
    trashItems: [],
    clipboard: null,
    inlineEdit: null,
    dialog: null,
    viewMode: "list",
    itemScale: 1,
    sort: { column: "name", direction: "asc" },
    showHidden: false,
    busy: false,
    error: null,
    pane: {
      listing: null,
      hasFolderEntries: false,
      commandQuery: "",
      commandQueryMode: "filter",
      selectedIds: [],
      selectedIdsByPath: {},
      lastSelectedIndexByPath: {},
      backHistory: [],
      forwardHistory: [],
      loading: false,
      showLoadingSkeleton: false,
      needsLoad: false,
      error: null,
    },
  }));
  const assert = () => {
    if (closed || signal.aborted) throw new Error("This Files view is closed.");
  };
  const owner = (path: string) => {
    assert();
    const folder = [...folders].find(
      (folder) => path === folder.root || path.startsWith(`${folder.root}/`),
    );
    if (!folder) throw new Error("Choose the folder before accessing its files.");
    return folder;
  };
  const error = (cause: unknown) => {
    if (!closed) store.setState({ error: cause instanceof Error ? cause.message : String(cause) });
  };
  const currentPath = () => {
    const path = store.getState().pane.listing?.path;
    if (!path) throw new Error("Choose a folder first.");
    return path;
  };
  const selected = () => {
    const { pane } = store.getState();
    return pane.listing?.entries.filter((entry) => pane.selectedIds.includes(entry.id)) ?? [];
  };
  const getTrash = () => {
    assert();
    if (!trash)
      trash = createSdkFilesTrash(misty, lifetime.signal)
        .then((service) => {
          if (closed) {
            void service.close();
            assert();
          }
          folders.add(service.directory);
          return service;
        })
        .catch((cause) => {
          trash = undefined;
          throw cause;
        });
    return trash;
  };
  async function loadListing(path: string) {
    if (path === "misty://recent" || path === "misty://starred") {
      const entries = store
        .getState()
        [path === "misty://recent" ? "recent" : "starred"].filter((entry) =>
          [...folders].some((folder) => entry.path.startsWith(`${folder.root}/`)),
        );
      return {
        path,
        title: path === "misty://recent" ? "Recent" : "Starred",
        parentPath: null,
        location: {
          kind: "local" as const,
          providerType: null,
          remoteName: null,
          remotePath: null,
        },
        entries,
        totalCount: entries.length,
        hiddenCount: 0,
      };
    }
    if (path !== "misty://trash")
      return owner(path).list({ path, showHidden: store.getState().showHidden });
    const service = await getTrash(),
      items = await service.list();
    assert();
    store.setState({ trashItems: items });
    return {
      path,
      title: "Trash",
      parentPath: null,
      location: { kind: "local" as const, providerType: null, remoteName: null, remotePath: null },
      entries: items.map((item) => item.entry),
      totalCount: items.length,
      hiddenCount: 0,
    };
  }
  async function navigate(path: string, mode: NavigationMode = "push") {
    assert();
    if (!["misty://trash", "misty://recent", "misty://starred"].includes(path)) owner(path);
    const request = ++navigation;
    if (path !== store.getState().pane.listing?.path) editing.cancelInlineEdit();
    store.setState((state) => ({
      error: null,
      pane: { ...state.pane, loading: true, error: null },
    }));
    try {
      const listing = await loadListing(path);
      assert();
      if (request !== navigation) return;
      store.setState((state) => ({
        pane: applyNavigationResult(state.pane, sortListing(listing, state.sort), mode),
      }));
    } catch (cause) {
      if (!closed && request === navigation) {
        const message = cause instanceof Error ? cause.message : String(cause);
        store.setState((state) => ({
          error: message,
          pane: { ...state.pane, loading: false, error: message },
        }));
      }
      throw cause;
    }
  }
  async function refresh() {
    const path = store.getState().pane.listing?.path;
    if (path) await navigate(path, "replace");
  }
  function perform<T>(operation: () => Promise<T>): Promise<T> {
    assert();
    queued++;
    store.setState({ busy: true, error: null });
    const pending = tail
      .catch(() => undefined)
      .then(async () => {
        assert();
        const result = await operation();
        assert();
        if (!store.getState().pane.loading) await refresh();
        return result;
      });
    tail = pending;
    return pending
      .catch(async (cause) => {
        // A batch can have completed earlier entries before a later failure.
        if (!closed && !store.getState().pane.loading) {
          try {
            await refresh();
          } catch {
            /* Keep the original operation failure. */
          }
        }
        error(cause);
        throw cause;
      })
      .finally(() => {
        queued--;
        if (!closed) store.setState({ busy: queued > 0 });
      });
  }
  async function openFolder(
    options: Parameters<typeof openSdkFilesDirectory>[1] & { activate?: boolean } = {},
  ) {
    assert();
    const folder = await openSdkFilesDirectory(misty, { ...options, signal: lifetime.signal });
    if (!folder) return null;
    if (closed) {
      await folder.close();
      assert();
    }
    const create = folder.create.bind(folder),
      rename = folder.rename.bind(folder);
    folder.create = async (request) => {
      const result = await create(request);
      let path = result.affectedPaths[0];
      let receipt: string | undefined;
      history.record({
        title: `Create ${request.name}`,
        undo: async () => {
          receipt = (await (await getTrash()).moveFrom(folder, path)).id;
        },
        redo: async () => {
          if (!receipt) throw new Error("The recovery record is unavailable.");
          path = (await (await getTrash()).restore(receipt)).path;
        },
      });
      return result;
    };
    folder.rename = async (request) => {
      const result = await rename(request);
      let current = result.affectedPaths[0];
      const originalName = request.path.slice(request.path.lastIndexOf("/") + 1);
      history.record({
        title: `Rename ${originalName}`,
        undo: async () => {
          current = (await rename({ path: current, newName: originalName })).affectedPaths[0];
        },
        redo: async () => {
          current = (await rename({ path: current, newName: request.newName })).affectedPaths[0];
        },
      });
      return result;
    };
    folders.add(folder);
    store.setState({ folders: [...folders] });
    try {
      await folder.watch(() => {
        const path = store.getState().pane.listing?.path;
        if (
          path &&
          !closed &&
          !store.getState().pane.loading &&
          !path.startsWith("misty://") &&
          owner(path) === folder
        )
          void refresh().catch(error);
      }, error);
      if (options.activate !== false) await navigate(folder.root);
      return folder;
    } catch (cause) {
      if (closed) await folder.close();
      error(cause);
      throw cause;
    }
  }
  function select(
    entryId: string,
    options: { toggle?: boolean; range?: boolean; visibleEntryIds?: string[] } = {},
  ) {
    assert();
    store.setState((state) => {
      const pane = state.pane,
        entries = pane.listing?.entries ?? [],
        path = pane.listing?.path ?? "";
      const index = entries.findIndex((entry) => entry.id === entryId);
      if (index < 0) return state;
      let selectedIds: string[];
      if (options.range) {
        const ids =
          options.visibleEntryIds?.filter((id) => entries.some((entry) => entry.id === id)) ??
          entries.map((entry) => entry.id);
        const target = ids.indexOf(entryId);
        const previous = entries[pane.lastSelectedIndexByPath[path] ?? index]?.id;
        const previousIndex = ids.indexOf(previous);
        const anchor = previousIndex >= 0 ? previousIndex : target;
        selectedIds = ids.slice(Math.min(anchor, target), Math.max(anchor, target) + 1);
      } else if (options.toggle)
        selectedIds = pane.selectedIds.includes(entryId)
          ? pane.selectedIds.filter((id) => id !== entryId)
          : [...pane.selectedIds, entryId];
      else selectedIds = [entryId];
      return {
        pane: {
          ...pane,
          selectedIds,
          selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: selectedIds },
          lastSelectedIndexByPath: { ...pane.lastSelectedIndexByPath, [path]: index },
        },
      };
    });
  }
  const editing = createSdkFilesEditing({ store, owner, perform, assert });
  let closing: Promise<void> | undefined;
  function close() {
    if (closing) return closing;
    editing.invalidate();
    closed = true;
    lifetime.abort();
    transfers.forEach((transfer) => transfer.cancel.abort());
    transfers.clear();
    signal.removeEventListener("abort", onAbort);
    clipboard = null;
    closing = Promise.all([...folders].map((folder) => folder.close())).then(() => {
      folders.clear();
      store.setState({
        folders: [],
        busy: false,
        inlineEdit: null,
        dialog: null,
        trashItems: [],
        clipboard: null,
      });
    });
    return closing;
  }
  const onAbort = () => {
    void close();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  async function transfer(paths: string[], destinationPath: string, operation: "copy" | "move") {
    const destination = owner(destinationPath);
    const sources = paths.map((path) => ({ path, folder: owner(path) }));
    return perform(async () => {
      const results = [];
      for (const source of sources) {
        assert();
        const id = crypto.randomUUID(),
          cancel = new AbortController();
        const name = source.path.slice(source.path.lastIndexOf("/") + 1);
        const update = (change: Partial<FilesState["transfers"][number]>) => {
          if (!closed)
            store.setState((state) => ({
              transfers: state.transfers.map((item) =>
                item.id === id ? { ...item, ...change } : item,
              ),
            }));
        };
        store.setState((state) => ({
          transfers: [
            ...state.transfers.slice(-99),
            { id, name, status: "queued", bytes: 0, message: "Waiting" },
          ],
        }));
        transfers.set(id, {
          cancel,
          retry: () => transfer([source.path], destinationPath, operation),
        });
        try {
          const result = await transferSdkFilesEntry(
            source.folder,
            destination,
            source.path,
            destinationPath,
            operation,
            {
              signal: cancel.signal,
              onProgress: (status: MistyFileTransferStatus) =>
                update({
                  status:
                    status.status === "running"
                      ? "running"
                      : status.status === "completed"
                        ? "completed"
                        : "failed",
                  message: status.message,
                }),
            },
          );
          results.push(result);
          update({ status: "completed", message: operation === "copy" ? "Copied" : "Moved" });
          let current = result.path,
            receipt: string | undefined;
          history.record({
            title: `${operation === "copy" ? "Copy" : "Move"} ${name}`,
            undo: async () => {
              if (operation === "copy")
                receipt = (await (await getTrash()).moveFrom(destination, current)).id;
              else
                current = (
                  await transferSdkFilesEntry(
                    destination,
                    source.folder,
                    current,
                    source.path.slice(0, source.path.lastIndexOf("/")),
                    "move",
                    { signal: lifetime.signal },
                  )
                ).path;
            },
            redo: async () => {
              if (operation === "copy") {
                if (!receipt) throw new Error("The recovery record is unavailable.");
                current = (await (await getTrash()).restore(receipt)).path;
              } else
                current = (
                  await transferSdkFilesEntry(
                    source.folder,
                    destination,
                    current,
                    destinationPath,
                    "move",
                    { signal: lifetime.signal },
                  )
                ).path;
            },
          });
        } catch (cause) {
          update({
            status: cancel.signal.aborted ? "cancelled" : "failed",
            message: cause instanceof Error ? cause.message : String(cause),
          });
          throw cause;
        }
      }
      return results;
    });
  }
  const actions = {
    ...editing,
    store,
    history: history.store,
    undo: () => perform(() => history.run("undo")),
    redo: () => perform(() => history.run("redo")),
    transfer,
    cancelTransfer: (id: string) => transfers.get(id)?.cancel.abort(),
    retryTransfer: (id: string) => transfers.get(id)?.retry(),
    close,
    openFolder,
    navigate,
    refresh,
    owner,
    selected,
    select,
    recordRecent(entry: FileEntry) {
      store.setState((state) => ({
        recent: [entry, ...state.recent.filter((item) => item.path !== entry.path)].slice(0, 100),
      }));
    },
    toggleStar(entry: FileEntry) {
      store.setState((state) => ({
        starred: state.starred.some((item) => item.path === entry.path)
          ? state.starred.filter((item) => item.path !== entry.path)
          : [...state.starred, entry],
      }));
      if (currentPath() === "misty://starred") void refresh().catch(error);
    },
    openTrash: () => navigate("misty://trash"),
    trashSelected: () => {
      const entries = selected();
      if (currentPath() === "misty://trash") throw new Error("These items are already in Trash.");
      return perform(async () => {
        const service = await getTrash(),
          results = [];
        for (const entry of entries)
          results.push(await service.moveFrom(owner(entry.path), entry.path));
        return results;
      });
    },
    restoreSelected: (target?: { directory: SdkFilesDirectory; path: string }) => {
      const ids = store.getState().pane.selectedIds;
      const items = store.getState().trashItems.filter((item) => ids.includes(item.entry.id));
      return perform(async () => {
        const service = await getTrash(),
          results = [];
        for (const item of items) results.push(await service.restore(item.id, target));
        return results;
      });
    },
    deleteSelected: (paneId = "files"): Promise<unknown> => {
      if (currentPath() !== "misty://trash") return actions.trashSelected();
      const paths = selected().map((entry) => entry.path);
      if (paths.length)
        store.setState({ dialog: { kind: "delete", paneId, paths, permanent: true } });
      return Promise.resolve();
    },
    confirmDelete: async () => {
      const dialog = store.getState().dialog;
      if (dialog?.kind !== "delete") return;
      const items = store
        .getState()
        .trashItems.filter((item) => dialog.paths.includes(item.entry.path));
      await perform(async () => {
        const service = await getTrash();
        for (const item of items) await service.purge(item.id);
        if (store.getState().dialog === dialog) store.setState({ dialog: null });
      });
    },
    purgeSelected: () => {
      const ids = store.getState().pane.selectedIds;
      const items = store.getState().trashItems.filter((item) => ids.includes(item.entry.id));
      return perform(async () => {
        const service = await getTrash();
        for (const item of items) await service.purge(item.id);
      });
    },
    error,
    back: () => {
      const path = store.getState().pane.backHistory.slice(-1)[0];
      return path ? navigate(path, "back") : Promise.resolve();
    },
    forward: () => {
      const path = store.getState().pane.forwardHistory.slice(-1)[0];
      return path ? navigate(path, "forward") : Promise.resolve();
    },
    parent: () => {
      const path = store.getState().pane.listing?.parentPath;
      return path ? navigate(path) : Promise.resolve();
    },
    setQuery: (query: string) => {
      assert();
      store.setState((state) => ({ pane: { ...state.pane, commandQuery: query } }));
    },
    setQueryMode: (commandQueryMode: ExplorerCommandQueryMode) => {
      assert();
      store.setState((state) => ({ pane: { ...state.pane, commandQueryMode } }));
    },
    setItemScale: (itemScale: number) => {
      assert();
      store.setState({ itemScale: Math.min(2, Math.max(0, Math.round(itemScale))) });
    },
    setViewMode: (viewMode: ExplorerViewMode) => {
      assert();
      store.setState({ viewMode });
    },
    setSort: (column: ExplorerSortColumn) => {
      assert();
      store.setState((state) => {
        const sort: ExplorerSortState = {
          column,
          direction:
            state.sort.column === column && state.sort.direction === "asc" ? "desc" : "asc",
        };
        return {
          sort,
          pane: {
            ...state.pane,
            listing: state.pane.listing ? sortListing(state.pane.listing, sort) : null,
          },
        };
      });
    },
    toggleHidden: () => {
      assert();
      store.setState((state) => ({ showHidden: !state.showHidden }));
      return refresh();
    },
    clearSelection: () => {
      assert();
      store.setState((state) => ({
        pane: {
          ...state.pane,
          selectedIds: [],
          selectedIdsByPath: {
            ...state.pane.selectedIdsByPath,
            [state.pane.listing?.path ?? ""]: [],
          },
        },
      }));
    },
    create: (name: string, kind: "file" | "folder") => {
      const path = currentPath(),
        folder = owner(path);
      return perform(() => folder.create({ directory: path, name, kind }));
    },
    rename: (path: string, name: string) => {
      const folder = owner(path);
      return perform(() => folder.rename({ path, newName: name }));
    },
    listArchive: (path: string, format: MistyArchiveFormat, signal?: AbortSignal) =>
      owner(path).listArchive(path, format, signal),
    openExternal: (path: string) => owner(path).openExternal(path),
    saveBytes: (path: string, bytes: ArrayBuffer, copy = false) => {
      const folder = owner(path);
      return perform(() => folder.saveBytes(path, bytes, copy));
    },
    readText: (path: string) => owner(path).readText(path),
    readBytes: (path: string, maxBytes: number) => owner(path).readBytes(path, maxBytes),
    writeText: (path: string, contents: string, lineEnding: "lf" | "crlf" = "lf") => {
      const folder = owner(path);
      return perform(() => folder.writeText(path, contents, lineEnding));
    },
    remove: (path: string, recursive = false) => {
      const folder = owner(path);
      return perform(() => folder.remove(path, recursive));
    },
    copy: (operation: "copy" | "move") => {
      assert();
      const entries = selected();
      clipboard = entries.length ? { folder: owner(entries[0].path), entries, operation } : null;
      store.setState({
        clipboard: clipboard ? { operation, paths: entries.map((entry) => entry.path) } : null,
      });
    },
    paste: async (path = currentPath()) => {
      const source = clipboard;
      if (!source) return [];
      const results = await transfer(
        source.entries.map((entry) => entry.path),
        path,
        source.operation,
      );
      if (source.operation === "move" && clipboard === source) {
        clipboard = null;
        store.setState({ clipboard: null });
      }
      return results;
    },
  };
  return actions;
}
export type SdkFilesStore = ReturnType<typeof createSdkFilesStore>;
