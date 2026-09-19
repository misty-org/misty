import type {
  DuplicateCandidate,
  DuplicateGroup,
  DuplicateScanResult,
} from "@/native/contracts";
import type { DuplicateFinderRuntime } from "./explorer/workspace/ExplorerDuplicateFinderDialogView";
import type { SdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesCompare } from "./sdkFilesCompare";

export function createSdkFilesDuplicates(
  files: SdkFilesStore,
  lifetime: AbortSignal,
  ErrorComponent: DuplicateFinderRuntime["Error"],
): DuplicateFinderRuntime {
  type Scan = {
    id: string;
    controller: AbortController;
    items: DuplicateCandidate[];
    groups: DuplicateGroup[];
    count: number;
    hashAll: boolean;
    approved: boolean;
    busy: boolean;
  };
  let current: Scan | undefined;
  const check = (scan: Scan) => {
    lifetime.throwIfAborted();
    scan.controller.signal.throwIfAborted();
    if (current !== scan) throw new Error("This duplicate scan was replaced.");
  };
  const cancel = async (id?: string) => {
    if (!id || current?.id === id) current?.controller.abort();
  };
  lifetime.addEventListener(
    "abort",
    () => {
      void cancel();
    },
    { once: true },
  );
  async function group(scan: Scan): Promise<DuplicateScanResult> {
    check(scan);
    if (scan.busy) throw new Error("The duplicate scan is busy.");
    scan.busy = true;
    try {
      const engine = createSdkFilesCompare(files, scan.controller.signal);
      if (scan.hashAll || scan.approved) {
        for (const item of scan.items) {
          check(scan);
          if (item.sha256 || (item.remote && !scan.approved)) continue;
          const result = await engine.checksum(item.path);
          check(scan);
          if (result.bytes !== item.sizeBytes)
            throw new Error("A candidate changed. Run the scan again.");
          item.sha256 = result.hex;
        }
      }
      const groups = new Map<string, DuplicateGroup>();
      for (const item of scan.items) {
        const key = `${item.sizeBytes}:${item.sha256 ?? "unhashed"}`;
        const value = groups.get(key) ?? {
          key,
          sizeBytes: item.sizeBytes,
          items: [],
        };
        value.items.push({ ...item });
        groups.set(key, value);
      }
      scan.groups = [...groups.values()].filter(
        (group) => group.items.length > 1,
      );
      return {
        scanId: scan.id,
        groups: scan.groups,
        scannedCount: scan.count,
        hashedCount: scan.items.filter((item) => item.sha256).length,
        remoteCandidateCount: scan.items.filter((item) => item.remote).length,
        remoteHashingApproved: scan.approved,
        canceled: false,
        message: `Found ${scan.groups.length} duplicate candidate groups.`,
      };
    } finally {
      scan.busy = false;
    }
  }
  return {
    Error: ErrorComponent,
    cancel,
    async scan({ roots, hashAll }) {
      await cancel();
      lifetime.throwIfAborted();
      const scan: Scan = {
        id: crypto.randomUUID(),
        controller: new AbortController(),
        items: [],
        groups: [],
        count: 0,
        hashAll,
        approved: false,
        busy: false,
      };
      current = scan;
      const pending = [...new Set(roots)],
        seen = new Set<string>();
      const sizes = new Map<number, DuplicateCandidate[]>();
      while (pending.length) {
        check(scan);
        const path = pending.pop()!;
        if (seen.has(path)) continue;
        seen.add(path);
        const owner = files.owner(path);
        const listing = await owner.list({ path, showHidden: true });
        check(scan);
        for (const entry of listing.entries) {
          if (entry.kind === "folder") {
            pending.push(entry.path);
            continue;
          }
          if (entry.kind !== "file" || seen.has(entry.path)) continue;
          seen.add(entry.path);
          scan.count++;
          if (
            entry.sizeBytes === null ||
            !Number.isSafeInteger(entry.sizeBytes) ||
            entry.sizeBytes < 0
          )
            throw new Error("A candidate file size is unavailable.");
          const items = sizes.get(entry.sizeBytes) ?? [];
          items.push({
            path: entry.path,
            sizeBytes: entry.sizeBytes,
            modifiedMs: entry.modifiedMs ?? 0,
            remote: !!owner.source && owner.source.kind !== "local",
          });
          sizes.set(entry.sizeBytes, items);
        }
      }
      scan.items = [...sizes.values()]
        .filter((items) => items.length > 1)
        .flat();
      for (const item of scan.items) {
        check(scan);
        if (item.remote) continue;
        const metadata = await files.owner(item.path).stat(item.path);
        check(scan);
        if (metadata.bytes !== item.sizeBytes) throw new Error("A candidate changed. Run the scan again.");
        item.modifiedMs = metadata.modifiedMs ?? 0;
      }
      return group(scan);
    },
    async hashRemote(id) {
      const scan = current;
      if (!scan || scan.id !== id)
        throw new Error("Run a fresh duplicate scan.");
      check(scan);
      scan.approved = true;
      return group(scan);
    },
    async cleanup(paths, mode, destination) {
      const scan = current;
      if (!scan) throw new Error("Run a duplicate scan before cleanup.");
      check(scan);
      if (scan.busy) throw new Error("The duplicate scan is busy.");
      scan.busy = true;
      try {
        const selected = new Set(paths);
        if (selected.size !== paths.length || !paths.length)
          throw new Error("Invalid cleanup selection.");
        const eligible = new Set<string>();
        const verify = new Map<string, DuplicateCandidate>();
        for (const group of scan.groups) {
          const chosen = group.items.filter((item) => selected.has(item.path));
          if (!chosen.length) continue;
          if (chosen.length === group.items.length)
            throw new Error("Keep at least one file in each group.");
          for (const item of group.items) verify.set(item.path, item);
          for (const item of chosen) eligible.add(item.path);
        }
        if (paths.some((path) => !eligible.has(path)))
          throw new Error("The cleanup selection is outside this scan.");
        const engine = createSdkFilesCompare(files, scan.controller.signal);
        for (const item of verify.values()) {
          check(scan);
          if (item.remote && !item.sha256)
            throw new Error("Approve remote hashing before verifying these candidates for cleanup.");
          if (item.sha256) {
            const current = await engine.checksum(item.path);
            if (current.bytes !== item.sizeBytes || current.hex !== item.sha256)
              throw new Error(
                "A duplicate changed. Run the scan again before cleanup.",
              );
          } else {
            const current = await files.owner(item.path).stat(item.path);
            if (
              current.bytes !== item.sizeBytes ||
              (current.modifiedMs ?? 0) !== item.modifiedMs
            )
              throw new Error(
                "A candidate changed. Run the scan again before cleanup.",
              );
          }
        }
        check(scan);
        if (mode === "move") await files.transfer(paths, destination, "move");
        else
          for (const path of paths) {
            check(scan);
            await files.trashPath(path);
          }
        scan.controller.abort();
      } finally {
        scan.busy = false;
      }
    },
  };
}
