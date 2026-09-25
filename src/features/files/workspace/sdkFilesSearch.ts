import { createSdkFilesIndex } from "./sdkFilesIndex";
import type { FileEntry, SearchResult } from "@/native/contracts";
import type { SdkFilesStore } from "./sdkFilesStore";

/** Search only directories granted to this view; cancellation never publishes stale results. */
export function createSdkFilesSearch(
  files: SdkFilesStore,
  lifetime: AbortSignal,
) {
  const index = createSdkFilesIndex(files, lifetime);
  const assert = (signal?: AbortSignal) => {
    if (lifetime.aborted || signal?.aborted)
      throw new DOMException("File search cancelled.", "AbortError");
  };
  async function walk(
    roots: string[],
    signal: AbortSignal,
    visit: (entry: FileEntry) => boolean,
  ) {
    const pending = [...roots],
      seen = new Set<string>();
    let count = 0;
    while (pending.length) {
      assert(signal);
      const path = pending.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const listing = await files
        .owner(path)
        .list({ path, showHidden: files.store.getState().showHidden });
      assert(signal);
      for (const entry of listing.entries) {
        if (++count > 100_000)
          throw new Error(
            "This search reached 100,000 entries. Search a smaller folder.",
          );
        if (!visit(entry)) return;
        if (entry.kind === "folder") pending.push(entry.path);
      }
    }
  }
  return {
    async query(
      query: string,
      path: string,
      signal: AbortSignal,
    ): Promise<SearchResult[]> {
      const words = query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      if (!words.length) return [];
      const folders = files.store.getState().folders;
      const roots = folders
        .filter((folder) => folder.source && folder.source.kind !== "local")
        .map((folder) => folder.root);
      const results: SearchResult[] = [];
      for (const folder of folders.filter(
        (folder) => !folder.source || folder.source.kind === "local",
      )) {
        assert(signal);
        results.push(...(await index.query(folder.root, query, signal)));
      }
      await walk(roots, signal, (entry) => {
        const value = entry.name.toLocaleLowerCase();
        if (words.every((word) => value.includes(word)))
          results.push({
            entry,
            score: value === query.toLocaleLowerCase() ? 2 : 1,
            sourceKind: entry.location.kind === "remote" ? "remote" : "local",
            indexedAtMs: Date.now(),
            match: { kind: "filename" },
          });
        return results.length < 100;
      });
      return results.sort((a, b) => b.score - a.score).slice(0, 100);
    },
    async rebuild(path: string, signal: AbortSignal) {
      assert(signal);
      const folder = files.owner(path);
      await index.rebuild(folder.root, signal);
    },
    async size(path: string, signal: AbortSignal) {
      let bytes = 0;
      await walk([path], signal, (entry) => {
        if (entry.kind === "file") bytes += entry.sizeBytes ?? 0;
        return true;
      });
      return bytes;
    },
  };
}
