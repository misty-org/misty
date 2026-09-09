import type { createSdkCodeRuntime } from "./sdkCodeRuntime";
import type { SdkCodeEntry } from "./sdkCodeProject";
import type { SearchMatch, SearchOutcome, WalkedFile } from "./native";

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "target",
  "build",
  ".venv",
  "__pycache__",
  ".DS_Store",
  ".turbo",
  ".pnpm-store",
]);
export interface SdkCodeFileIndex {
  files: WalkedFile[];
  truncated: boolean;
  skippedDirectories: number;
}
export interface SdkCodeSearchOutcome extends SearchOutcome {
  skippedFiles: number;
  skippedDirectories: number;
}

/** Project search over granted SDK entries. Native paths and host caches are never used. */
export function createSdkCodeSearch(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  limits: { files?: number; entries?: number; bytes?: number; matches?: number } = {},
) {
  const maxFiles = limits.files ?? 25_000;
  const maxEntries = limits.entries ?? 100_000;
  const maxBytes = limits.bytes ?? Number.POSITIVE_INFINITY;
  const maxMatches = limits.matches ?? 2_000;
  const indexes = new Map<string, { revision: number; pending: Promise<SdkCodeFileIndex> }>();
  const discovered = new WeakMap<WalkedFile, SdkCodeEntry>();
  let closed = false;
  const assert = (signal?: AbortSignal) => {
    if (closed || signal?.aborted) throw new Error("This Code search was cancelled.");
  };
  async function walk(root: string): Promise<SdkCodeFileIndex> {
    const project = runtime.project(root);
    const files: WalkedFile[] = [];
    const directories: Array<SdkCodeEntry | undefined> = [undefined];
    let visited = 0,
      truncated = false,
      skippedDirectories = 0;
    while (directories.length && !truncated) {
      assert();
      const directory = directories.pop();
      let entries: SdkCodeEntry[];
      try {
        entries = await project.scanDirectory(directory);
      } catch (error) {
        assert();
        runtime.project(root);
        if (!directory) throw error;
        skippedDirectories++;
        continue;
      }
      assert();
      runtime.project(root);
      for (const entry of entries) {
        if (++visited > maxEntries) {
          truncated = true;
          break;
        }
        if (entry.kind === "directory" && !SKIP_DIRECTORIES.has(entry.name))
          directories.push(entry);
        if (entry.kind !== "file") continue;
        if (files.length === maxFiles) {
          truncated = true;
          break;
        }
        const file = {
          path: entry.path,
          name: entry.name,
          relative: entry.path.slice(root.length + 1),
        };
        discovered.set(file, entry);
        files.push(file);
      }
    }
    return { files, truncated, skippedDirectories };
  }
  const loadIndex = (root: string) => {
    assert();
    const revision = runtime.projectRevision(root);
    const cached = indexes.get(root);
    if (cached?.revision === revision) return cached.pending;
    const pending = walk(root).catch((error) => {
      if (indexes.get(root)?.pending === pending) indexes.delete(root);
      throw error;
    });
    indexes.set(root, { revision, pending });
    return pending;
  };
  return {
    loadIndex,
    invalidate(root: string) {
      indexes.delete(root);
    },
    close() {
      closed = true;
      indexes.clear();
    },
    async search(
      root: string,
      query: string,
      caseSensitive = false,
      signal?: AbortSignal,
    ): Promise<SdkCodeSearchOutcome> {
      assert(signal);
      runtime.project(root);
      if (query.length > 4096) throw new Error("Search text is too long.");
      if (!query.trim())
        return {
          matches: [],
          truncated: false,
          usedRipgrep: false,
          skippedFiles: 0,
          skippedDirectories: 0,
        };
      const pattern = new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        caseSensitive ? "u" : "iu",
      );
      const index = await loadIndex(root);
      assert(signal);
      const matches: SearchMatch[] = [];
      let bytes = 0,
        truncated = index.truncated,
        skippedFiles = 0;
      for (let offset = 0; offset < index.files.length; offset += 4) {
        assert(signal);
        if (bytes >= maxBytes || matches.length >= maxMatches) {
          truncated = true;
          break;
        }
        const batch = index.files.slice(offset, offset + 4);
        // The project's four-operation queue bounds each batch to four 5 MiB text files.
        const reads = await Promise.allSettled(
          batch.map((file) => runtime.project(root).readScannedFile(discovered.get(file)!)),
        );
        assert(signal);
        runtime.project(root);
        for (const [position, read] of reads.entries()) {
          if (matches.length >= maxMatches || bytes >= maxBytes) {
            truncated = true;
            break;
          }
          if (read.status === "rejected") {
            skippedFiles++;
            continue;
          }
          bytes += read.value.sizeBytes;
          const file = batch[position];
          const lines = read.value.contents.split(/\r?\n/);
          for (let line = 0; line < lines.length; line++) {
            const match = pattern.exec(lines[line]);
            if (!match) continue;
            if (matches.length === maxMatches) {
              truncated = true;
              break;
            }
            matches.push({
              ...file,
              lineNumber: line + 1,
              column: match.index + 1,
              line:
                lines[line].length <= 800
                  ? lines[line]
                  : [...lines[line]].slice(0, 800).join("") + "…",
            });
          }
        }
      }
      return {
        matches,
        truncated,
        usedRipgrep: false,
        skippedFiles,
        skippedDirectories: index.skippedDirectories,
      };
    },
  };
}
