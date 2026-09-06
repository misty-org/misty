import {
  isMistyFileHostMethod,
  mistyFileHostContracts,
  mistyDirectoryContracts,
  mistyFileTransferContracts,
  type MistyFileSource,
  type MistyFileDropEvent,
} from "@misty/sdk";
import type { DirectoryListing, FileEntry, ExplorerOperationResult } from "@/native/contracts";
import { AppRpcError, rpcRecord, rpcString, type AppRpcScope } from "./session";

export interface FilesHostSource extends MistyFileSource {
  path: string;
}
export interface FilesSourceBookmark {
  sourceId: string;
  relative: string[];
  name: string;
  writable: boolean;
}
export interface FilesHostBackend {
  close?(): void;
  subscribeDrop(listener: (event: MistyFileDropEvent) => void): Promise<() => void>;
  importDrop(tokens: string[], path: string, operation: "copy" | "move"): Promise<void>;
  sources(): Promise<FilesHostSource[]>;
  invoke<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  native(method: string, params?: unknown): Promise<unknown>;
  file<T>(operation: string, params: Record<string, unknown>): Promise<T>;
  manage(kind: "remote" | "device"): Promise<void>;
  preview(handle: string, dimension: number): Promise<ArrayBuffer>;
  drag(handles: string[], mode: "copy" | "move"): Promise<{ dropped: boolean }>;
  bookmarks(): Record<string, FilesSourceBookmark>;
  saveBookmarks(records: Record<string, FilesSourceBookmark>): void;
}
interface Folder {
  source: FilesHostSource;
  path: string;
  relative: string[];
  writable: boolean;
  entries: Map<string, FileEntry>;
  page?: FileEntry[];
}
const token = (name: string) =>
  "u:" +
  btoa(String.fromCharCode(...new TextEncoder().encode(name)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const childName = (name: unknown) => {
  const value = rpcString(name, 1024);
  if ([".", ".."].includes(value) || /[/\0]/.test(value))
    throw new AppRpcError("invalid_entry", "Invalid file name.");
  return value;
};
const shares = new Map<
  string,
  { owner: string; folder: Folder; expires: number; sourceAlive: () => boolean }
>();

/** Connected folders use the same typed file operations as local grants. Paths stay inside the Host. */
export function createFilesHostRpc(scope: AppRpcScope, backend: FilesHostBackend) {
  const folders = new Map<string, Folder>();
  const sourceFiles = new Map<string, { folder: Folder; entry: FileEntry }>();
  const watchers = new Map<string, { directory: string; signature: string; revision: number }>();
  const transfers = new Map<string, string[]>();
  const sourceShares = new Set<string>();
  const owner = JSON.stringify(scope.identity);
  const shareOwner = JSON.stringify([
    scope.identity.appId,
    scope.identity.accountId,
    scope.identity.spaceId,
  ]);
  const prefix = `source-${crypto.randomUUID()}-`;
  let closed = false;
  const assert = (write = false) => {
    scope.assert(write ? "files.write" : "files.read");
    if (closed) throw new AppRpcError("app_closed", "Files has closed.");
  };
  const folder = (value: unknown, write = false) => {
    assert(write);
    const result = folders.get(rpcString(value, 256));
    if (!result)
      throw new AppRpcError(
        "foreign_folder",
        "This connected folder belongs to another view or has closed.",
      );
    if (write && !result.writable)
      throw new AppRpcError("read_only", "This connected folder is read-only.");
    return result;
  };
  const grant = (value: Folder) => {
    assert();
    if (folders.size >= 64)
      throw new AppRpcError("too_many_folders", "Close a Files tab before opening more folders.");
    const handle = `${prefix}${crypto.randomUUID()}`;
    folders.set(handle, value);
    return {
      handle,
      name: value.relative.slice(-1)[0] ?? value.source.name,
      writable: value.writable,
    };
  };
  const source = async (id: string) => {
    const candidates = await backend.sources();
    assert();
    const result = candidates.find((item) => item.id === id);
    if (!result?.online)
      throw new AppRpcError("source_unavailable", "This source is offline or no longer connected.");
    return result;
  };
  async function listing(value: Folder, force = false) {
    assert();
    const result = await backend.invoke<DirectoryListing>("explorer_list_directory", {
      request: { path: value.path, showHidden: true, forceRemoteRefresh: force },
    });
    assert();
    const entries = result.entries.filter((entry) => {
      childName(entry.name);
      if (entry.path !== `${value.path.replace(/\/$/, "")}/${entry.name}`)
        throw new AppRpcError(
          "invalid_entry",
          "A connected source returned an entry outside its folder.",
        );
      return true;
    });
    value.entries = new Map(entries.map((entry) => [token(entry.name), entry]));
    value.page = entries;
    return entries;
  }
  const entry = async (value: Folder, key: unknown) => {
    const id = rpcString(key, 4098);
    if (!value.entries.has(id)) await listing(value);
    const result = value.entries.get(id);
    if (!result || !["file", "folder"].includes(result.kind))
      throw new AppRpcError("invalid_entry", "This file moved, changed, or is not accessible.");
    return result;
  };
  function remember(value: Folder, write: boolean) {
    assert(write);
    if (write && !value.writable)
      throw new AppRpcError("read_only", "This source was opened read-only.");
    const records = backend.bookmarks();
    const record: FilesSourceBookmark = {
      sourceId: value.source.id,
      relative: value.relative,
      name: value.relative.slice(-1)[0] ?? value.source.name,
      writable: write,
    };
    const id =
      Object.keys(records).find((key) => JSON.stringify(records[key]) === JSON.stringify(record)) ??
      crypto.randomUUID();
    if (!records[id] && Object.keys(records).length >= 32)
      throw new AppRpcError(
        "bookmark_limit",
        "Remove a saved connected folder before adding another.",
      );
    backend.saveBookmarks({ ...records, [id]: record });
    return { bookmarkId: id, name: record.name, writable: record.writable };
  }
  async function restore(record: FilesSourceBookmark, write: boolean) {
    assert(write);
    if (write && !record.writable)
      throw new AppRpcError("read_only", "This folder was saved read-only.");
    const root = await source(record.sourceId);
    if (write && !root.writable) throw new AppRpcError("read_only", "This source is read-only.");
    let current: Folder = {
      source: root,
      path: root.path,
      relative: [],
      writable: write,
      entries: new Map(),
    };
    for (const name of record.relative) {
      childName(name);
      const next = await entry(current, token(name));
      if (next.kind !== "folder")
        throw new AppRpcError("missing_folder", "The saved folder moved or was removed.");
      current = {
        ...current,
        path: next.path,
        relative: [...current.relative, name],
        entries: new Map(),
      };
    }
    return grant(current);
  }
  async function request(message: {
    method: string;
    params?: unknown;
  }): Promise<{ handled: false } | { handled: true; value: unknown }> {
    if (!message.method.startsWith("files.")) return { handled: false };
    const method = message.method,
      p = rpcRecord(message.params ?? {});
    const connected = Object.values(p).some(
      (value) => typeof value === "string" && value.startsWith("source-"),
    );
    const file = typeof p.handle === "string" ? sourceFiles.get(p.handle) : undefined;
    const records = [
      "files.reopenDirectory",
      "files.forgetDirectory",
      "files.listSavedDirectories",
    ].includes(method)
      ? backend.bookmarks()
      : {};
    const record = typeof p.bookmarkId === "string" ? records[p.bookmarkId] : undefined;
    const shared = typeof p.ticket === "string" ? shares.get(p.ticket) : undefined;
    if (
      !isMistyFileHostMethod(method) &&
      !connected &&
      !file &&
      !record &&
      !shared &&
      !(method === "files.listSavedDirectories" && Object.keys(records).length)
    )
      return { handled: false };
    assert();
    let value: unknown;
    if (isMistyFileHostMethod(method)) mistyFileHostContracts[method].params.parse(p);
    switch (method) {
      case "files.sources.list":
        value = (await backend.sources()).map(({ path: _path, ...item }) => item);
        break;
      case "files.sources.open": {
        const write = p.write === true;
        assert(write);
        await backend.native("files.sources.open", p);
        assert(write);
        const selected = await source(rpcString(p.sourceId, 256));
        if (write && !selected.writable)
          throw new AppRpcError("read_only", "This source is read-only.");
        if (selected.kind === "local") {
          value = await backend.file("adoptDirectory", {
            path: selected.path,
            name: selected.name,
            write,
          });
          break;
        }
        value = grant({
          source: selected,
          path: selected.path,
          relative: [],
          writable: write,
          entries: new Map(),
        });
        break;
      }
      case "files.sources.unmount": {
        assert(true);
        const selected = await source(rpcString(p.sourceId, 256));
        if (selected.kind !== "local" || selected.providerType !== "volume" || !selected.removable)
          throw new AppRpcError("not_removable", "This source cannot be ejected.");
        await backend.invoke("devices_unmount", {
          request: { volumeId: selected.id.slice("volume:".length), mountPath: selected.path },
        });
        break;
      }
      case "files.drop.import": {
        assert(true);
        const target = folders.has(p.directory as string)
          ? folder(p.directory, true).path
          : (await backend.file<{ path: string }>("resolve", { handle: p.directory, write: true }))
              .path;
        await backend.importDrop(
          p.tokens as string[],
          target,
          p.operation === "move" ? "move" : "copy",
        );
        break;
      }
      case "files.sources.manage":
        await backend.manage(p.kind as "remote" | "device");
        break;
      case "files.previewImage":
        value = await backend.preview(rpcString(p.handle, 256), Number(p.maxDimension ?? 1024));
        break;
      case "files.drag.start": {
        const mode = p.mode === "move" ? "move" : "copy";
        if (mode === "move") assert(true);
        const handles = p.handles as string[],
          preparedHandles: string[] = [];
        const sessionId = crypto.randomUUID();
        try {
          const dragHandles: string[] = [];
          for (const handle of handles) {
            const connectedFolder = folders.get(handle);
            if (!connectedFolder) {
              dragHandles.push(handle);
              continue;
            }
            if (mode === "move")
              throw new AppRpcError(
                "copy_connected_drag",
                "Copy connected folders when dragging to another app.",
              );
            const prepared = await backend.invoke<{ items: Array<{ localPath: string }> }>(
              "explorer_prepare_drag_items",
              {
                request: {
                  sessionId,
                  items: [
                    {
                      path: connectedFolder.path,
                      isDirectory: true,
                      sizeBytes: null,
                      remoteModified: null,
                    },
                  ],
                },
              },
            );
            assert();
            if (prepared.items.length !== 1)
              throw new AppRpcError(
                "drag_unavailable",
                "This folder could not be prepared for dragging.",
              );
            const owned = await backend.file<{ handle: string }>("adoptDirectory", {
              path: prepared.items[0].localPath,
              name: connectedFolder.source.name,
              write: false,
            });
            preparedHandles.push(owned.handle);
            dragHandles.push(owned.handle);
          }
          value = await backend.drag(dragHandles, mode);
        } finally {
          await Promise.all(
            preparedHandles.map((handle) =>
              backend.native("files.release", { handle }).catch(() => undefined),
            ),
          );
          if (preparedHandles.length)
            await backend
              .invoke("explorer_cancel_drag_preparation", { sessionId })
              .catch(() => undefined);
        }
        break;
      }
      case "files.listDirectory": {
        const input = mistyDirectoryContracts[method].params.parse(p),
          current = folder(input.directory);
        const entries = input.offset === 0 || !current.page ? await listing(current) : current.page;
        value = {
          entries: entries
            .slice(input.offset, input.offset + input.limit)
            .map((item) => ({
              entry: token(item.name),
              name: item.name,
              kind: item.kind === "folder" ? "directory" : item.kind,
              ...(item.sizeBytes !== null ? { bytes: item.sizeBytes } : {}),
            })),
          nextOffset:
            input.offset + input.limit < entries.length ? input.offset + input.limit : null,
        };
        break;
      }
      case "files.openEntry": {
        const input = mistyDirectoryContracts[method].params.parse(p),
          current = folder(input.directory, input.write),
          item = await entry(current, input.entry);
        if (item.kind === "folder") {
          const opened = grant({
            ...current,
            path: item.path,
            relative: [...current.relative, item.name],
            writable: input.write,
            entries: new Map(),
          });
          value = { handle: opened.handle, name: opened.name, kind: "directory" };
        } else {
          if (input.write)
            throw new AppRpcError(
              "read_only_preview",
              "Download this connected file to a chosen folder before editing it.",
            );
          const prepared = await backend.invoke<{ localPath: string }>(
            "explorer_prepare_open_item",
            {
              request: {
                path: item.path,
                sizeBytes: item.sizeBytes,
                remoteModified: item.remoteModified,
              },
            },
          );
          assert();
          const result = await backend.file<{ handle: string; bytes: number }>("adoptPrepared", {
            path: prepared.localPath,
          });
          try {
            assert();
          } catch (error) {
            await backend.native("files.release", { handle: result.handle });
            throw error;
          }
          sourceFiles.set(result.handle, { folder: current, entry: item });
          value = { ...result, name: item.name, kind: "file" };
        }
        break;
      }
      case "files.stat": {
        if (file) value = await backend.native(method, p);
        else {
          const current = folder(p.handle);
          value = {
            kind: "directory",
            bytes: 0,
            modifiedMs: null,
            createdMs: null,
            readOnly: !current.writable,
            writeGranted: current.writable,
          };
        }
        break;
      }
      case "files.release": {
        const handle = rpcString(p.handle, 256);
        folders.delete(handle);
        sourceFiles.delete(handle);
        for (const [id, dependencies] of transfers)
          if (dependencies.includes(handle)) {
            await backend.native("files.transferCancel", { jobId: id }).catch(() => undefined);
            transfers.delete(id);
          }
        if (file) value = await backend.native(method, p);
        break;
      }
      case "files.rememberDirectory": {
        const input = mistyDirectoryContracts[method].params.parse(p);
        value = remember(folder(input.directory), input.write);
        break;
      }
      case "files.reopenDirectory": {
        const input = mistyDirectoryContracts[method].params.parse(p);
        if (!record) throw new AppRpcError("missing_bookmark", "This saved folder is unavailable.");
        value = await restore(record, input.write);
        break;
      }
      case "files.forgetDirectory":
        backend.saveBookmarks(
          Object.fromEntries(Object.entries(records).filter(([key]) => key !== p.bookmarkId)),
        );
        value = null;
        break;
      case "files.listSavedDirectories":
        value = [
          ...((await backend.native(method, {})) as unknown[]),
          ...Object.entries(records).map(([bookmarkId, record]) => ({
            bookmarkId,
            name: record.name,
            writable: record.writable,
          })),
        ];
        break;
      case "files.shareDirectory": {
        const input = mistyDirectoryContracts[method].params.parse(p),
          current = folder(input.directory, input.write);
        const ticket = crypto.randomUUID();
        shares.set(ticket, {
          owner: shareOwner,
          folder: { ...current, writable: input.write },
          expires: Date.now() + 60_000,
          sourceAlive: () => !closed && folders.has(input.directory) && !scope.signal.aborted,
        });
        sourceShares.add(ticket);
        value = { ticket, expiresInMs: 60_000 };
        break;
      }
      case "files.adoptDirectory": {
        if (
          !shared ||
          shared.owner !== shareOwner ||
          shared.expires <= Date.now() ||
          !shared.sourceAlive()
        )
          throw new AppRpcError(
            "invalid_handoff",
            "This folder handoff expired or belongs to another account or Space.",
          );
        const write = p.write === true;
        assert(write);
        if (write && !shared.folder.writable)
          throw new AppRpcError("read_only", "The handoff is read-only.");
        shares.delete(p.ticket as string);
        value = grant({ ...shared.folder, writable: write, entries: new Map() });
        break;
      }
      case "files.cancelDirectoryShare":
        if (!sourceShares.has(p.ticket as string))
          throw new AppRpcError("foreign_handoff", "This handoff belongs to another view.");
        shares.delete(p.ticket as string);
        sourceShares.delete(p.ticket as string);
        value = null;
        break;
      case "files.watchDirectory": {
        const directory = rpcString(p.directory, 256),
          current = folder(directory);
        const watcher = `${prefix}watch-${crypto.randomUUID()}`;
        watchers.set(watcher, {
          directory,
          signature: JSON.stringify(await listing(current)),
          revision: 0,
        });
        value = { watcher };
        break;
      }
      case "files.watchStatus": {
        const watch = watchers.get(rpcString(p.watcher, 256));
        if (!watch) throw new AppRpcError("foreign_watch", "This watcher belongs to another view.");
        const current = folders.get(watch.directory);
        if (!current) value = { revision: watch.revision, active: false, reason: "root_changed" };
        else {
          const signature = JSON.stringify(await listing(current, true));
          if (signature !== watch.signature) {
            watch.signature = signature;
            watch.revision++;
          }
          value = { revision: watch.revision, active: true, reason: null };
        }
        break;
      }
      case "files.watchClose":
        watchers.delete(rpcString(p.watcher, 256));
        break;
      case "files.createEntry": {
        const current = folder(p.directory, true),
          name = childName(p.name);
        if ((await listing(current, true)).some((item) => item.name === name))
          throw new AppRpcError("conflict", "An item with this name already exists.");
        const result = await backend.invoke<ExplorerOperationResult>("explorer_create_item", {
          request: {
            directory: current.path,
            name,
            kind: p.kind === "directory" ? "folder" : "file",
          },
        });
        assert(true);
        if (!result.affectedPaths.includes(`${current.path}/${name}`))
          throw new AppRpcError(
            "invalid_result",
            "The source returned an unexpected created item.",
          );
        await listing(current, true);
        value = { entry: token(name), name, kind: p.kind };
        break;
      }
      case "files.renameEntry": {
        const current = folder(p.directory, true),
          item = await entry(current, p.entry),
          name = childName(p.name);
        if ((await listing(current, true)).some((other) => other.name === name))
          throw new AppRpcError("conflict", "An item with this name already exists.");
        await backend.invoke("explorer_rename_item", {
          request: { path: item.path, newName: name, sourceIsDirectory: item.kind === "folder" },
        });
        assert(true);
        await listing(current, true);
        value = { entry: token(name), name };
        break;
      }
      case "files.removeEntry": {
        const current = folder(p.directory, true),
          item = await entry(current, p.entry);
        if (item.kind === "folder" && p.recursive !== true) {
          if (
            (
              await backend.invoke<DirectoryListing>("explorer_list_directory", {
                request: { path: item.path, showHidden: true, forceRemoteRefresh: true },
              })
            ).entries.length
          )
            throw new AppRpcError("not_empty", "This folder is not empty.");
        }
        assert(true);
        await backend.invoke("explorer_delete_items", {
          request: { paths: [item.path], permanent: true },
        });
        assert(true);
        await listing(current, true);
        break;
      }
      case "files.transferStart": {
        const input = mistyFileTransferContracts[method].params.parse(p);
        assert(true);
        const sourceFolder = folders.get(input.sourceDirectory),
          destination = folders.get(input.destinationDirectory);
        let item: {
          path: string;
          name: string;
          kind: string;
          sizeBytes: number | null;
          remoteModified: string | null;
        };
        let release: string | undefined;
        if (sourceFolder) {
          folder(input.sourceDirectory, input.operation === "move");
          item = await entry(sourceFolder, input.entry);
        } else {
          const opened = (await backend.native("files.openEntry", {
            directory: input.sourceDirectory,
            entry: input.entry,
            write: input.operation === "move",
          })) as { handle: string; name: string; kind: string; bytes?: number };
          release = opened.handle;
          const location = await backend.file<{ path: string }>("resolve", {
            handle: opened.handle,
            write: input.operation === "move",
          });
          item = {
            path: location.path,
            name: opened.name,
            kind: opened.kind === "directory" ? "folder" : opened.kind,
            sizeBytes: opened.bytes ?? null,
            remoteModified: null,
          };
        }
        try {
          const path = destination
            ? folder(input.destinationDirectory, true).path
            : (
                await backend.file<{ path: string }>("resolve", {
                  handle: input.destinationDirectory,
                  write: true,
                })
              ).path;
          const existing = new Set(
            (
              await backend.invoke<DirectoryListing>("explorer_list_directory", {
                request: { path, showHidden: true, forceRemoteRefresh: true },
              })
            ).entries.map((item) => item.name),
          );
          let name = item.name;
          if (existing.has(name) && input.conflict === "error")
            throw new AppRpcError("conflict", "The destination already contains this item.");
          const dot = name.lastIndexOf("."),
            stem = dot > 0 ? name.slice(0, dot) : name,
            extension = dot > 0 ? name.slice(dot) : "";
          for (let count = 2; existing.has(name); count++) name = `${stem} (${count})${extension}`;
          assert(true);
          value = await backend.file<{ jobId: string }>("startTransfer", {
            request: {
              sources: [
                {
                  path: item.path,
                  isDirectory: item.kind === "folder",
                  sizeBytes: item.sizeBytes,
                  remoteModified: item.remoteModified,
                },
              ],
              destinationDirectory: path,
              operation: input.operation,
              targetName: name,
            },
          });
          transfers.set((value as { jobId: string }).jobId, [
            input.sourceDirectory,
            input.destinationDirectory,
          ]);
        } finally {
          if (release)
            await backend.native("files.release", { handle: release }).catch(() => undefined);
        }
        break;
      }
      default:
        if (file) value = await backend.native(method, p);
        else
          throw new AppRpcError(
            "unsupported_connected_operation",
            "This connected file operation is not available.",
          );
    }
    assert();
    if (isMistyFileHostMethod(method)) value = mistyFileHostContracts[method].result.parse(value);
    return { handled: true, value };
  }
  function close() {
    if (closed) return;
    closed = true;
    backend.close?.();
    sourceShares.forEach((ticket) => shares.delete(ticket));
    sourceShares.clear();
    transfers.forEach((_handles, jobId) => {
      void backend.native("files.transferClose", { jobId }).catch(() => undefined);
    });
    transfers.clear();
    sourceFiles.forEach((_file, handle) => {
      void backend.native("files.release", { handle }).catch(() => undefined);
    });
    sourceFiles.clear();
    folders.clear();
    watchers.clear();
    scope.signal.removeEventListener("abort", close);
  }
  scope.signal.addEventListener("abort", close, { once: true });
  return { request, close, owner, subscribeDrop: backend.subscribeDrop };
}
