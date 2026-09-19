import type { CompareDialogRuntime } from "./explorer/workspace/ExplorerCompareDialogView";
import { buildCompareTextDiff } from "./explorer/workspace/compareDialog/compareDiff";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  CompareFilesResult,
  CompareFoldersResult,
} from "@/native/contracts";
import type { SdkFilesStore } from "./sdkFilesStore";

/** Hashing and inventory traversal are package code; the host only reads through
 * a directory capability. Large files never need a full in-memory preview. */
export function createSdkFilesCompare(
  files: SdkFilesStore,
  signal: AbortSignal,
) {
  const check = () => signal.throwIfAborted();
  const checksum = async (path: string) => {
    check();
    const hash = sha256.create();
    try {
      const bytes = await files.owner(path).readChunks(path, (chunk) => {
        check();
        hash.update(chunk);
      });
      check();
      return {
        bytes,
        hex: Array.from(hash.digest(), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      };
    } finally {
      hash.destroy();
    }
  };
  const inventory = async (root: string) => {
    const result = new Map<string, number>();
    const pending = [root];
    const seen = new Set<string>();
    while (pending.length) {
      check();
      const path = pending.pop()!;
      if (seen.has(path))
        throw new Error("The folder listing contains a cycle.");
      seen.add(path);
      const listing = await files.owner(path).list({ path, showHidden: true });
      check();
      for (const entry of listing.entries) {
        if (!entry.path.startsWith(root + "/"))
          throw new Error("An entry is outside the selected folder.");
        if (entry.kind === "folder") pending.push(entry.path);
        else if (entry.kind === "file") {
          if (
            entry.sizeBytes === null ||
            !Number.isSafeInteger(entry.sizeBytes)
          )
            throw new Error(
              "A file size is unavailable. Refresh and try again.",
            );
          result.set(entry.path.slice(root.length + 1), entry.sizeBytes);
        }
      }
    }
    return result;
  };
  return {
    checksum,
    async compareFiles({
      leftPath,
      rightPath,
    }: {
      leftPath: string;
      rightPath: string;
    }): Promise<CompareFilesResult> {
      const left = await checksum(leftPath),
        right = await checksum(rightPath);
      check();
      const same = left.bytes === right.bytes && left.hex === right.hex;
      return {
        leftPath,
        rightPath,
        leftSha256: left.hex,
        rightSha256: right.hex,
        same,
        kind: "binary",
        message: same ? "Files match." : "Files differ.",
      };
    },
    async compareFolders({
      leftPath,
      rightPath,
    }: {
      leftPath: string;
      rightPath: string;
    }): Promise<CompareFoldersResult> {
      const left = await inventory(leftPath),
        right = await inventory(rightPath);
      check();
      const rows = [...new Set([...left.keys(), ...right.keys()])]
        .sort()
        .map((relativePath) => {
          const leftSize = left.get(relativePath),
            rightSize = right.get(relativePath);
          const disposition =
            leftSize === undefined
              ? "right_only"
              : rightSize === undefined
                ? "left_only"
                : leftSize === rightSize
                  ? "same"
                  : "different";
          return { relativePath, leftSize, rightSize, disposition };
        });
      return {
        leftPath,
        rightPath,
        rows,
        message: `Compared ${rows.length} folder item${rows.length === 1 ? "" : "s"}.`,
      };
    },
  };
}

export function createSdkFilesCompareRuntime(
  files: SdkFilesStore,
  signal: AbortSignal,
  presentation: Pick<CompareDialogRuntime, "Error" | "notify">,
): CompareDialogRuntime {
  const image = async (path: string) => {
    signal.throwIfAborted();
    const bytes = new Uint8Array(
      await files.owner(path).previewImage(path, 2048),
    );
    signal.throwIfAborted();
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return {
      src: `data:image/png;base64,${btoa(binary)}`,
      mimeType: "image/png",
      byteLength: bytes.length,
    };
  };
  return {
    ...createSdkFilesCompare(files, signal),
    ...presentation,
    async textDiff(left, right) {
      try {
        const a = await files.readText(left),
          b = await files.readText(right);
        signal.throwIfAborted();
        if (a.contents.includes("\0") || b.contents.includes("\0")) return null;
        return buildCompareTextDiff(a.contents, b.contents);
      } catch (error) {
        signal.throwIfAborted();
        return null;
      }
    },
    async images(left, right) {
      try {
        return { left: await image(left), right: await image(right) };
      } catch (error) {
        signal.throwIfAborted();
        return null;
      }
    },
    merge: async (text, target) => {
      signal.throwIfAborted();
      const current = await files.readText(target);
      signal.throwIfAborted();
      return files.writeText(target, text, current.lineEnding);
    },
    copy: (source, destination) => {
      signal.throwIfAborted();
      return files.transfer([source], destination, "copy");
    },
    trash: (path) => {
      signal.throwIfAborted();
      return files.trashPath(path);
    },
  };
}
