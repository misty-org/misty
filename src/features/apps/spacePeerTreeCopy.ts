import type { DirectoryListing, FileEntry } from "@/native/contracts";

export type PeerTreeListing = DirectoryListing & { revision: string; links?: FileEntry[] };
export interface PeerTreeCopyBackend {
  list(path: string): Promise<PeerTreeListing>;
  begin(destination: string, name: string, conflict: "error" | "rename"): Promise<string>;
  directory(draft: string, names: string[]): Promise<string>;
  copy(entry: FileEntry, destination: string): Promise<{ jobId: string; close(): Promise<void> }>;
  link(entry: FileEntry, draft: string, destination: string): Promise<void>;
  status(job: string): Promise<{ status: string; bytes: number; message: string }>;
  release(directory: string): Promise<void>;
  commit(draft: string): Promise<unknown>;
  discard(draft: string): Promise<void>;
}
/** Traversal is outside the native transport: only owned staging capabilities
 * and signed, snapshot-checked peer files enter the host's copy primitives. */
export async function copySpacePeerTree(
  backend: PeerTreeCopyBackend,
  options: {
    path: string;
    destination: string;
    name: string;
    conflict: "error" | "rename";
    signal: AbortSignal;
    assert(): void;
    progress?(bytes: number, files: number): void;
  },
) {
  const check = () => {
    options.signal.throwIfAborted();
    options.assert();
  };
  const pause = () =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(options.signal.reason ?? new Error("Copy cancelled."));
      };
      const timer = setTimeout(() => {
        options.signal.removeEventListener("abort", abort);
        resolve();
      }, 100);
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    });
  check();
  const draft = await backend.begin(options.destination, options.name, options.conflict);
  let committed = false,
    bytes = 0,
    files = 0,
    entries = 0;
  const receipts = new Map<string, string>();
  const pending = [{ path: options.path, names: [] as string[] }];
  try {
    while (pending.length) {
      check();
      const next = pending.pop()!;
      if (next.names.length > 256 || receipts.has(next.path))
        throw new Error("The source tree is recursive or too deep.");
      const listing = await backend.list(next.path);
      check();
      entries += listing.entries.length + (listing.links?.length ?? 0);
      if (entries > 100_000 || receipts.size >= 100_000)
        throw new Error("Copy fewer than 100,000 entries at once.");
      receipts.set(next.path, listing.revision);
      const destination = await backend.directory(draft, next.names);
      try {
        check();
        for (const entry of listing.links ?? []) {
          check();
          await backend.link(entry, draft, destination);
          check();
          files++;
          options.progress?.(bytes, files);
        }
        for (const entry of listing.entries) {
          check();
          if (entry.kind === "folder") {
            pending.push({ path: entry.path, names: [...next.names, entry.name] });
            continue;
          }
          if (entry.kind !== "file")
            throw new Error("This source contains an unsupported file type.");
          const copy = await backend.copy(entry, destination);
          try {
            for (;;) {
              check();
              const state = await backend.status(copy.jobId);
              check();
              options.progress?.(bytes + state.bytes, files);
              if (state.status === "completed") {
                bytes += state.bytes;
                files++;
                break;
              }
              if (state.status !== "running" && state.status !== "queued")
                throw new Error(state.message || "A file could not be copied.");
              await pause();
            }
          } finally {
            await copy.close();
          }
        }
      } finally {
        await backend.release(destination).catch(() => undefined);
      }
    }
    // Validate the complete recorded tree again before publishing its staging root.
    for (const [path, revision] of receipts) {
      check();
      const current = await backend.list(path);
      check();
      if (current.revision !== revision)
        throw new Error("The source tree changed while copying. Refresh it and try again.");
    }
    check();
    const result = await backend.commit(draft);
    committed = true;
    return { result, bytes, files };
  } finally {
    if (!committed) await backend.discard(draft).catch(() => undefined);
  }
}
