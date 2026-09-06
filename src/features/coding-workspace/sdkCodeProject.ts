import {
  parseSdkCodeProjectReference,
  type SdkCodeProjectReference,
} from "./sdkCodeProjectReference";
import { parseSdkCodeProjectHandoff, type SdkCodeProjectHandoff } from "./sdkCodeProjectHandoff";
import type { MistyAppSDK, MistyArchiveFormat } from "@misty/sdk";
import type { MistyDirectoryEntry } from "@misty/contracts";
import { observeSdkDirectory } from "./sdkDirectoryObserver";
import { runSdkFileTransfer } from "./sdkFileTransfer";
import type { MistyFileTransferStatus } from "@misty/contracts";

export interface SdkCodeEntry {
  path: string;
  name: string;
  kind: MistyDirectoryEntry["kind"];
  bytes?: number;
}
interface TransferAccess {
  files: MistyAppSDK["files"];
  signal: AbortSignal;
  writable: boolean;
  source<T>(path: string, action: (directory: string, entry: string) => Promise<T>): Promise<T>;
  destination<T>(path: string, action: (directory: string) => Promise<T>): Promise<T>;
}
const transferAccess = new WeakMap<object, TransferAccess>();

export async function transferSdkCodeEntry(
  source: Awaited<ReturnType<typeof openSdkCodeProject>>,
  destination: Awaited<ReturnType<typeof openSdkCodeProject>>,
  path: string,
  destinationDirectory: string,
  operation: "copy" | "move",
  options: { signal?: AbortSignal; onProgress?(status: MistyFileTransferStatus): void } = {},
) {
  const from = source && transferAccess.get(source),
    to = destination && transferAccess.get(destination);
  if (!from || !to || from.files !== to.files)
    throw new Error("Transfers require two open projects belonging to this Code app.");
  if (!to.writable || (operation === "move" && !from.writable))
    throw new Error("Choose writable folders for the transfer.");
  return from.source(path, (sourceDirectory, entry) =>
    to.destination(destinationDirectory, async (destinationHandle) => {
      const result = await runSdkFileTransfer(
        from.files,
        {
          sourceDirectory,
          entry,
          destinationDirectory: destinationHandle,
          operation,
          conflict: "rename",
        },
        {
          signals: [from.signal, to.signal, ...(options.signal ? [options.signal] : [])],
          onProgress: options.onProgress,
        },
      );
      return { ...result, path: `${destinationDirectory}/${result.name}` };
    }),
  );
}
/** One chosen project, owned by one Code mount. Paths here are editor identifiers,
 * not native paths; only the SDK's opaque handles cross the file boundary. */
export async function openSdkCodeProject(
  misty: Pick<MistyAppSDK, "files">,
  options: {
    write?: boolean;
    signal?: AbortSignal;
    handoff?: SdkCodeProjectHandoff;
    reference?: SdkCodeProjectReference;
    /** Transfer an already-owned SDK folder grant into this directory lifetime. */
    directoryGrant?: { handle: string; name: string; writable: boolean };
  } = {},
) {
  if (options.signal?.aborted) throw new Error("This Code project is closed.");
  if ([options.handoff, options.reference, options.directoryGrant].filter(Boolean).length > 1)
    throw new Error("Choose one Code project restoration method.");
  let reference = options.reference ? parseSdkCodeProjectReference(options.reference) : undefined;
  const handoff = options.handoff ? parseSdkCodeProjectHandoff(options.handoff) : undefined;
  const writable =
    reference?.write ?? handoff?.write ?? options.directoryGrant?.writable ?? options.write ?? true;
  const selected = reference
    ? await misty.files.reopenDirectory(reference.bookmarkId, { write: writable })
    : handoff
      ? await misty.files.adoptDirectory(handoff.ticket, { write: writable })
      : (options.directoryGrant ?? (await misty.files.pickDirectory({ write: writable })));
  if (!selected) return null;
  const root = reference?.root ?? handoff?.root ?? `/misty-project/${crypto.randomUUID()}`;
  const shares = new Map<string, number>();
  const handles = new Set([selected.handle]);
  const outputs = new Set<string>();
  const lifetime = new AbortController();
  const observers = new Set<() => Promise<void>>();
  let closed = false;
  let active = 0;
  const queued: Array<{ start(): void; reject(error: Error): void }> = [];
  const schedule = <T>(task: () => Promise<T>): Promise<T> => {
    try {
      assert();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        active++;
        void Promise.resolve()
          .then(() => {
            assert();
            return task();
          })
          .then(resolve, reject)
          .finally(() => {
            active--;
            queued.shift()?.start();
          });
      };
      if (active < 4) start();
      else if (queued.length >= 64) reject(new Error("Too many pending Code project operations."));
      else queued.push({ start, reject });
    });
  };
  const assert = () => {
    if (closed || options.signal?.aborted) throw new Error("This Code project is closed.");
  };
  const release = async (handle: string) => {
    if (handles.delete(handle)) await misty.files.release(handle).catch(() => undefined);
  };
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    if (closed) return Promise.resolve();
    closed = true;
    lifetime.abort();
    queued.splice(0).forEach((item) => item.reject(new Error("This Code project is closed.")));
    options.signal?.removeEventListener("abort", abort);
    closing = (async () => {
      await Promise.all([...observers].map((stop) => stop()));
      observers.clear();
      await Promise.all(
        [...shares.keys()].map((ticket) =>
          misty.files.cancelDirectoryShare(ticket).catch(() => undefined),
        ),
      );
      shares.clear();
      await Promise.all(
        [...outputs].map((handle) => misty.files.discardCopy(handle).catch(() => undefined)),
      );
      outputs.clear();
      await Promise.all([...handles].map(release));
    })();
    return closing;
  };
  const abort = () => {
    void close();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const adopt = async (handle: string) => {
    if (closed || options.signal?.aborted) {
      await misty.files.release(handle).catch(() => undefined);
      assert();
    }
    handles.add(handle);
    return handle;
  };
  const ownedCall = async <T>(call: () => Promise<T>) => {
    assert();
    const result = await call();
    assert();
    return result;
  };
  const parts = (path: string): string[] => {
    assert();
    if (path === root) return [];
    if (!path.startsWith(`${root}/`)) throw new Error("That file is outside this Code project.");
    const parts = path.slice(root.length + 1).split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0")))
      throw new Error("Invalid Code project path.");
    return parts;
  };
  async function entries(directory: string) {
    const result: MistyDirectoryEntry[] = [];
    let offset = 0;
    while (offset <= 1000000) {
      const page = await ownedCall(() =>
        misty.files.listDirectory(directory, { offset, limit: 200 }),
      );
      result.push(...page.entries);
      if (result.length > 25000) throw new Error("This folder exceeds the Code listing limit.");
      if (page.nextOffset === null) return result;
      if (page.nextOffset <= offset) throw new Error("The folder listing did not advance.");
      offset = page.nextOffset;
    }
    throw new Error("This folder exceeds the Code listing range.");
  }
  async function child(directory: string, name: string) {
    const matches = (await entries(directory)).filter((entry) => entry.name === name);
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? "This filename is ambiguous in the editor."
          : "The project entry no longer exists.",
      );
    return matches[0];
  }
  async function inDirectory<T>(segments: string[], action: (handle: string) => Promise<T>) {
    let directory = selected!.handle;
    try {
      for (const segment of segments) {
        const entry = await child(directory, segment);
        if (entry.kind !== "directory") throw new Error("Only project folders can be traversed.");
        const opened = await misty.files.openEntry(directory, entry.entry, {
          write: writable,
        });
        await adopt(opened.handle);
        if (opened.kind !== "directory") {
          await release(opened.handle);
          throw new Error("The project folder changed.");
        }
        const previous = directory;
        directory = opened.handle;
        if (previous !== selected!.handle) await release(previous);
        assert();
      }
      return await action(directory);
    } finally {
      if (directory !== selected!.handle) await release(directory);
    }
  }
  async function inParent<T>(
    path: string,
    action: (directory: string, name: string) => Promise<T>,
  ) {
    const segments = parts(path),
      name = segments.pop();
    if (!name) throw new Error("Choose a project entry, not its root.");
    return inDirectory(segments, (directory) => action(directory, name));
  }
  async function withFile<T>(path: string, write: boolean, action: (handle: string) => Promise<T>) {
    if (write && !writable) throw new Error("This Code project was opened read-only.");
    return inParent(path, async (directory, name) => {
      const entry = await child(directory, name);
      if (entry.kind !== "file") throw new Error("Only regular project files can be edited.");
      const opened = await misty.files.openEntry(directory, entry.entry, { write });
      await adopt(opened.handle);
      try {
        if (opened.kind !== "file") throw new Error("The project file changed.");
        return await action(opened.handle);
      } finally {
        await release(opened.handle);
      }
    });
  }
  try {
    assert();
  } catch (error) {
    await close();
    throw error;
  }
  async function readTextHandle(handle: string) {
    const before = await ownedCall(() => misty.files.stat(handle));
    const contents = await ownedCall(() => misty.files.readText(handle));
    if (contents.includes("\0")) throw new Error("File contains binary data.");
    const metadata = await ownedCall(() => misty.files.stat(handle));
    if (before.bytes !== metadata.bytes || before.modifiedMs !== metadata.modifiedMs)
      throw new Error("This file changed while it was being read. Try again.");
    return {
      // CodeMirror buffers use LF; retain the disk convention separately for saves.
      contents: contents.replace(/\r\n/g, "\n"),
      sizeBytes: new TextEncoder().encode(contents).byteLength,
      modifiedMs: metadata.modifiedMs,
      readonly: !writable || metadata.readOnly,
      lineEnding: contents.includes("\r\n") ? ("crlf" as const) : ("lf" as const),
    };
  }
  // Discovered entries retain only opaque relative tokens, never native handles.
  // Native openEntry still rechecks every component at use time. Weak ownership
  // prevents forged/cross-project entries without retaining old search indexes.
  interface Location {
    parent?: Location;
    token: string;
    kind: MistyDirectoryEntry["kind"];
    path: string;
  }
  const discovered = new WeakMap<SdkCodeEntry, Location>();
  function location(entry: SdkCodeEntry) {
    assert();
    const result = discovered.get(entry);
    if (!result) throw new Error("This entry was not discovered unambiguously in this project.");
    return result;
  }
  async function withDiscovered<T>(
    target: Location | undefined,
    action: (handle: string) => Promise<T>,
  ) {
    const chain: Location[] = [];
    for (let part = target; part; part = part.parent) chain.push(part);
    let handle = selected!.handle;
    try {
      for (const part of chain.reverse()) {
        const opened = await misty.files.openEntry(handle, part.token, { write: false });
        await adopt(opened.handle);
        const previous = handle;
        handle = opened.handle;
        if (previous !== selected!.handle) await release(previous);
        if (opened.kind !== part.kind) throw new Error("The discovered project entry changed.");
        assert();
      }
      return await action(handle);
    } finally {
      if (handle !== selected!.handle) await release(handle);
    }
  }
  async function scanDirectory(entry?: SdkCodeEntry): Promise<SdkCodeEntry[]> {
    const parent = entry ? location(entry) : undefined;
    if (parent && parent.kind !== "directory")
      throw new Error("Choose a discovered project directory.");
    return withDiscovered(parent, async (handle) => {
      const listed = await entries(handle);
      const names = new Map<string, number>();
      for (const item of listed) names.set(item.name, (names.get(item.name) ?? 0) + 1);
      return listed.map((item) => {
        const path = `${parent?.path ?? root}/${item.name}`;
        const result = Object.freeze({ path, name: item.name, kind: item.kind, bytes: item.bytes });
        // Lossy/ambiguous display names cannot be opened faithfully by the editor.
        if (names.get(item.name) === 1)
          discovered.set(result, { parent, token: item.entry, kind: item.kind, path });
        return result;
      });
    });
  }
  async function readScannedFile(entry: SdkCodeEntry) {
    const target = location(entry);
    if (target.kind !== "file") throw new Error("Choose a discovered regular file.");
    return withDiscovered(target, readTextHandle);
  }
  const project = {
    root,
    name: selected.name,
    writable,
    close,
    async watch(onChange: () => void, onError: (error: unknown) => void) {
      assert();
      const stop = await observeSdkDirectory(misty.files, selected.handle, {
        signal: lifetime.signal,
        onChange,
        onError,
      });
      if (closed) {
        await stop();
        assert();
      }
      observers.add(stop);
      return async () => {
        observers.delete(stop);
        await stop();
      };
    },
    async stat(path: string) {
      const segments = parts(path);
      if (!segments.length) return ownedCall(() => misty.files.stat(selected.handle));
      return inParent(path, async (directory, name) => {
        const entry = await child(directory, name);
        const opened = await misty.files.openEntry(directory, entry.entry);
        await adopt(opened.handle);
        try {
          return await ownedCall(() => misty.files.stat(opened.handle));
        } finally {
          await release(opened.handle);
        }
      });
    },
    async list(path = root): Promise<SdkCodeEntry[]> {
      return inDirectory(parts(path), async (directory) =>
        (await entries(directory)).map((entry) => ({
          path: `${path}/${entry.name}`,
          name: entry.name,
          kind: entry.kind,
          bytes: entry.bytes,
        })),
      );
    },
    async readText(path: string) {
      return withFile(path, false, readTextHandle);
    },
    async readBytes(path: string, maxBytes: number) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024)
        throw new Error("Choose a preview limit of 64 MiB or smaller.");
      return withFile(path, false, async (handle) => {
        const before = await ownedCall(() => misty.files.stat(handle));
        if (before.bytes > maxBytes) throw new Error("This file is too large for this preview.");
        const bytes = new Uint8Array(before.bytes);
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const length = Math.min(64 * 1024, bytes.length - offset);
          const chunk = await ownedCall(() => misty.files.readBytes(handle, offset, length));
          if (chunk.byteLength !== length)
            throw new Error("This file changed while it was being read. Try again.");
          bytes.set(new Uint8Array(chunk), offset);
        }
        const after = await ownedCall(() => misty.files.stat(handle));
        if (before.bytes !== after.bytes || before.modifiedMs !== after.modifiedMs)
          throw new Error("This file changed while it was being read. Try again.");
        return bytes.buffer;
      });
    },
    async listArchive(path: string, format: MistyArchiveFormat, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("This preview is closed.");
      return withFile(path, false, async (handle) => {
        const abort = () => {
          void release(handle);
        };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          if (signal?.aborted) {
            abort();
            throw new Error("This preview is closed.");
          }
          const result = await ownedCall(() => misty.files.listArchive(handle, format));
          if (signal?.aborted) throw new Error("This preview is closed.");
          return result;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      });
    },
    async previewImage(path: string, dimension: number) {
      return withFile(path, false, (handle) =>
        ownedCall(() => misty.files.previewImage(handle, dimension)),
      );
    },
    async withDragHandle<T>(
      path: string,
      mode: "copy" | "move",
      action: (handle: string) => Promise<T>,
    ) {
      if (mode === "move" && !writable) throw new Error("This folder is read-only.");
      if (path === root) return action(selected!.handle);
      return inParent(path, async (directory, name) => {
        const item = await child(directory, name);
        const opened = await misty.files.openEntry(directory, item.entry, {
          write: mode === "move",
        });
        await adopt(opened.handle);
        try {
          return await action(opened.handle);
        } finally {
          await release(opened.handle);
        }
      });
    },
    async startDrag(path: string, mode: "copy" | "move") {
      return project.withDragHandle(path, mode, (handle) =>
        ownedCall(() => misty.files.startDrag([handle], mode)),
      );
    },
    async importDrop(tokens: string[], path: string, operation: "copy" | "move") {
      if (!writable) throw new Error("This folder is read-only.");
      return inDirectory(parts(path), (directory) =>
        ownedCall(() => misty.files.importDrop(tokens, directory, operation)),
      );
    },
    async openExternal(path: string) {
      return withFile(path, false, (handle) => ownedCall(() => misty.files.openExternal(handle)));
    },
    async saveBytes(path: string, buffer: ArrayBuffer, copy = false) {
      if (!writable) throw new Error("This folder was opened read-only.");
      if (buffer.byteLength > 64 * 1024 * 1024)
        throw new Error("Edited files are limited to 64 MiB.");
      const bytes = buffer.slice(0);
      return inParent(path, async (directory, name) => {
        const stage = async (target?: string) => {
          const draft = await misty.files.createCopy(directory, copy ? name : "misty-edit");
          outputs.add(draft.handle);
          try {
            assert();
            for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024)
              await ownedCall(() =>
                misty.files.appendCopy(draft.handle, bytes.slice(offset, offset + 64 * 1024)),
              );
            if (target) {
              await ownedCall(() => misty.files.replaceCopy(draft.handle, target));
              return path;
            }
            const result = await ownedCall(() => misty.files.commitCopy(draft.handle));
            return `${path.slice(0, path.lastIndexOf("/"))}/${result.name}`;
          } finally {
            if (outputs.delete(draft.handle))
              await misty.files.discardCopy(draft.handle).catch(() => undefined);
          }
        };
        return copy ? stage() : withFile(path, true, stage);
      });
    },
    async writeText(path: string, contents: string, lineEnding: "lf" | "crlf" = "lf") {
      const normalized = contents.replace(/\r\n/g, "\n");
      return withFile(path, true, async (handle) => {
        await ownedCall(() =>
          misty.files.writeText(
            handle,
            lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized,
          ),
        );
        const metadata = await ownedCall(() => misty.files.stat(handle));
        return { sizeBytes: metadata.bytes, modifiedMs: metadata.modifiedMs };
      });
    },
    async create(path: string, kind: "file" | "directory") {
      if (!writable) throw new Error("This Code project was opened read-only.");
      return inParent(path, async (directory, name) => {
        const result = await ownedCall(() => misty.files.createEntry(directory, name, kind));
        return { path, name: result.name, kind: result.kind };
      });
    },
    async rename(path: string, name: string) {
      if (!writable) throw new Error("This Code project was opened read-only.");
      return inParent(path, async (directory, oldName) => {
        const entry = await child(directory, oldName);
        const result = await ownedCall(() => misty.files.renameEntry(directory, entry.entry, name));
        return {
          path: `${path.slice(0, path.lastIndexOf("/"))}/${result.name}`,
          name: result.name,
          kind: entry.kind,
        };
      });
    },
    async remove(path: string, options: { recursive?: boolean } = {}) {
      if (!writable) throw new Error("This Code project was opened read-only.");
      await inParent(path, async (directory, name) => {
        const entry = await child(directory, name);
        await ownedCall(() => misty.files.removeEntry(directory, entry.entry, options));
      });
    },
  };
  const exposed = {
    ...project,
    reference: () => (reference ? { ...reference } : undefined),
    invalidateReference(bookmarkId: string) {
      if (reference?.bookmarkId === bookmarkId) reference = undefined;
    },
    remember: () =>
      schedule(async (): Promise<SdkCodeProjectReference> => {
        if (reference) return { ...reference };
        const result = await misty.files.rememberDirectory(selected.handle, { write: writable });
        if (closed || options.signal?.aborted) {
          await misty.files.forgetDirectory(result.bookmarkId).catch(() => undefined);
          assert();
        }
        reference = { root, bookmarkId: result.bookmarkId, write: writable };
        return { ...reference };
      }),
    forget: () =>
      schedule(async () => {
        if (!reference) return;
        await misty.files.forgetDirectory(reference.bookmarkId);
        reference = undefined;
      }),
    share: () =>
      schedule(async (): Promise<SdkCodeProjectHandoff> => {
        for (const [ticket, expires] of shares) if (expires <= Date.now()) shares.delete(ticket);
        const result = await misty.files.shareDirectory(selected.handle, { write: writable });
        if (closed || options.signal?.aborted) {
          await misty.files.cancelDirectoryShare(result.ticket).catch(() => undefined);
          assert();
        }
        shares.set(result.ticket, Date.now() + result.expiresInMs);
        return { root, ticket: result.ticket, write: writable };
      }),
    async cancelShare(ticket: string) {
      if (shares.delete(ticket)) await misty.files.cancelDirectoryShare(ticket);
    },
    scanDirectory: (entry?: SdkCodeEntry) => schedule(() => scanDirectory(entry)),
    readScannedFile: (entry: SdkCodeEntry) => schedule(() => readScannedFile(entry)),
    list: (path?: string) => schedule(() => project.list(path)),
    stat: (path: string) => schedule(() => project.stat(path)),
    readText: (path: string) => schedule(() => project.readText(path)),
    readBytes: (path: string, maxBytes: number) =>
      schedule(() => project.readBytes(path, maxBytes)),
    listArchive: (path: string, format: MistyArchiveFormat, signal?: AbortSignal) =>
      schedule(() => project.listArchive(path, format, signal)),
    previewImage: (path: string, dimension: number) =>
      schedule(() => project.previewImage(path, dimension)),
    withDragHandle: project.withDragHandle,
    importDrop: (tokens: string[], path: string, operation: "copy" | "move") =>
      schedule(() => project.importDrop(tokens, path, operation)),
    startDrag: (path: string, mode: "copy" | "move") =>
      schedule(() => project.startDrag(path, mode)),
    openExternal: (path: string) => schedule(() => project.openExternal(path)),
    saveBytes: (path: string, bytes: ArrayBuffer, copy?: boolean) =>
      schedule(() => project.saveBytes(path, bytes, copy)),
    writeText: (path: string, contents: string, lineEnding?: "lf" | "crlf") =>
      schedule(() => project.writeText(path, contents, lineEnding)),
    create: (path: string, kind: "file" | "directory") =>
      schedule(() => project.create(path, kind)),
    rename: (path: string, name: string) => schedule(() => project.rename(path, name)),
    remove: (path: string, options?: { recursive?: boolean }) =>
      schedule(() => project.remove(path, options)),
  };
  transferAccess.set(exposed, {
    files: misty.files,
    signal: lifetime.signal,
    writable,
    source: (path, action) =>
      schedule(() =>
        inParent(path, async (directory, name) => {
          const entry = await child(directory, name);
          return action(directory, entry.entry);
        }),
      ),
    // The source owns the queue slot; nesting a second queue can deadlock
    // simultaneous transfers between two projects. Native jobs enforce their own limit.
    destination: (path, action) => inDirectory(parts(path), action),
  });
  return exposed;
}
