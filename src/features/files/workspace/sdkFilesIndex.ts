import type { MistyFileIndexDocument } from "@misty/sdk";
import type { SearchResult } from "@/native/contracts";
import type { SdkFilesStore } from "./sdkFilesStore";

/** Files owns scan scheduling, traversal and metadata updates. The installed
 * worker owns the index; no host-wide filesystem scanner is called. */
export function createSdkFilesIndex(
  files: SdkFilesStore,
  lifetime: AbortSignal,
) {
  const initializing = new Map<string, Promise<void>>();
  const check = (signal: AbortSignal) => {
    lifetime.throwIfAborted();
    signal.throwIfAborted();
  };
  async function rebuild(root: string, signal: AbortSignal) {
    check(signal);
    const folder = files.owner(root);
    if (folder.root !== root)
      throw new Error("Rebuild the selected folder's index.");
    const stale = new Set<string>();
    let offset = 0;
    for (;;) {
      const page = await folder.index({ operation: "dump", offset });
      check(signal);
      if (!page.docs || typeof page.done !== "boolean")
        throw new Error("Invalid index inventory.");
      page.docs.forEach((doc) => stale.add(doc.path));
      if (page.done) break;
      if (!page.next || page.next <= offset)
        throw new Error("The index inventory stopped progressing.");
      offset = page.next;
    }
    const pending = [{ path: root, hidden: false }],
      seen = new Set<string>();
    let batch: MistyFileIndexDocument[] = [];
    const flush = async () => {
      if (!batch.length) return;
      check(signal);
      await folder.index({ operation: "apply", documents: batch });
      check(signal);
      batch = [];
    };
    while (pending.length) {
      check(signal);
      const next = pending.pop()!;
      if (seen.has(next.path)) continue;
      seen.add(next.path);
      const listing = await folder.list({ path: next.path, showHidden: true });
      check(signal);
      for (const entry of listing.entries) {
        if (!entry.path.startsWith(root + "/"))
          throw new Error("An indexed entry is outside its folder.");
        const hidden = next.hidden || entry.hidden;
        if (entry.kind === "folder") pending.push({ path: entry.path, hidden });
        if (entry.kind !== "folder" && entry.kind !== "file") continue;
        const path = entry.path.slice(root.length + 1);
        stale.delete(path);
        batch.push({
          path,
          name: entry.name,
          extension: entry.extension ?? "",
          directory: entry.kind === "folder",
          bytes: entry.sizeBytes ?? 0,
          modifiedMs: Math.max(0, entry.modifiedMs ?? 0),
          hidden,
        });
        if (batch.length === 1000) await flush();
      }
    }
    await flush();
    // Only remove stale records after the full granted tree was read successfully.
    const removed = [...stale];
    for (let offset = 0; offset < removed.length; offset += 1000) {
      check(signal);
      await folder.index({
        operation: "apply",
        deletes: removed.slice(offset, offset + 1000),
      });
    }
    check(signal);
  }
  const ready = (root: string, signal: AbortSignal) => {
    let operation = initializing.get(root);
    if (!operation) {
      operation = (async () => {
        const status = await files.owner(root).index({ operation: "init" });
        check(signal);
        if (status.count === undefined)
          throw new Error("The index status is unavailable.");
        if (!status.count) await rebuild(root, signal);
      })().catch((error) => {
        initializing.delete(root);
        throw error;
      });
      initializing.set(root, operation);
    }
    return operation;
  };
  return {
    rebuild,
    async query(
      root: string,
      query: string,
      signal: AbortSignal,
    ): Promise<SearchResult[]> {
      check(signal);
      await ready(root, signal);
      check(signal);
      const folder = files.owner(root);
      const result = await folder.index({ operation: "query", query });
      check(signal);
      if (!result.docs)
        throw new Error("The search worker returned an invalid result.");
      const parents = new Map<
        string,
        Awaited<ReturnType<typeof folder.list>>
      >();
      const matches: SearchResult[] = [];
      for (const doc of result.docs) {
        check(signal);
        if (doc.hidden && !files.store.getState().showHidden) continue;
        const path = root + "/" + doc.path;
        const parent = path.slice(0, path.lastIndexOf("/"));
        let listing = parents.get(parent);
        if (!listing) {
          try {
            listing = await folder.list({ path: parent, showHidden: true });
          } catch {
            check(signal);
            await folder.stat(root); // A revoked root must fail, rather than hide an authorization error.
            check(signal);
            continue;
          }
          check(signal);
          parents.set(parent, listing);
        }
        const entry = listing.entries.find((entry) => entry.path === path);
        if (!entry) continue;
        matches.push({
          entry,
          score:
            doc.name.toLocaleLowerCase() === query.toLocaleLowerCase() ? 2 : 1,
          sourceKind: "local",
          indexedAtMs: Date.now(),
          match: { kind: "filename" },
        });
        if (matches.length === 100) break;
      }
      return matches;
    },
  };
}
