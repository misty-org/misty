import { MISTY_JOURNAL_ASSET_MAX_BYTES, type MistyAppSDK } from "@misty/sdk";

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};
export async function pickSdkJournalImage(
  misty: MistyAppSDK,
  signal: AbortSignal,
): Promise<File | undefined> {
  if (signal.aborted) return;
  const selected = await misty.files.pick();
  if (!selected) return;
  try {
    if (signal.aborted) return;
    const type = imageTypes[selected.name.split(".").pop()?.toLowerCase() ?? ""];
    if (
      !type ||
      !Number.isSafeInteger(selected.bytes) ||
      selected.bytes < 1 ||
      selected.bytes > MISTY_JOURNAL_ASSET_MAX_BYTES
    )
      throw new Error("Choose a supported image of 15 MB or smaller.");
    const parts: ArrayBuffer[] = [];
    for (let offset = 0; offset < selected.bytes; offset += 64 * 1024) {
      if (signal.aborted) return;
      const length = Math.min(64 * 1024, selected.bytes - offset);
      const bytes = await misty.files.readBytes(selected.handle, offset, length);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== length)
        throw new Error("The selected image changed while reading it.");
      parts.push(bytes);
    }
    if (signal.aborted) return;
    return new File(parts, selected.name, { type });
  } finally {
    await misty.files.release(selected.handle).catch(() => undefined);
  }
}

export type JournalImageLease = { url: string; release(): void };
type CacheEntry = { refs: number; bytes: number; url?: string; ready: Promise<string> };

/** Document JSON keeps stable asset IDs. Object URLs exist only in this mounted view. */
export function createSdkJournalAssets(misty: MistyAppSDK, spaceId: string, signal: AbortSignal) {
  const cache = new Map<string, CacheEntry>();
  let liveBytes = 0,
    closed = signal.aborted;
  let queue: Promise<unknown> = Promise.resolve();
  const assert = () => {
    if (closed || signal.aborted) throw new Error("This Journal view is closed.");
  };
  const remove = (key: string, entry: CacheEntry) => {
    if (cache.get(key) !== entry) return;
    cache.delete(key);
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
      liveBytes -= entry.bytes;
      entry.url = undefined;
    }
  };
  const close = () => {
    closed = true;
    for (const [key, entry] of cache) remove(key, entry);
    signal.removeEventListener("abort", close);
  };
  signal.addEventListener("abort", close, { once: true });
  return {
    close,
    async uploadNote(noteId: string, file: File) {
      assert();
      const asset = await misty.journal.assets.upload({
        resource: "note",
        resourceId: noteId,
        filename: file.name,
        file,
      });
      assert();
      return `/spaces/${encodeURIComponent(spaceId)}/notes/${encodeURIComponent(noteId)}/assets/${encodeURIComponent(asset.id)}/download`;
    },
    async resolveNote(reference: string): Promise<JournalImageLease> {
      assert();
      const match = /^\/spaces\/([^/]+)\/notes\/([^/]+)\/assets\/([^/]+)\/download$/.exec(
        reference,
      );
      if (!match) {
        const url = new URL(reference);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
          throw new Error("Unsupported Journal image reference.");
        return { url: url.href, release() {} };
      }
      if (decodeURIComponent(match[1]) !== spaceId)
        throw new Error("This Journal image belongs to another Space.");
      const resourceId = decodeURIComponent(match[2]),
        assetId = decodeURIComponent(match[3]);
      let entry = cache.get(reference);
      if (!entry) {
        if (cache.size >= 32) throw new Error("This view has too many open Journal images.");
        entry = { refs: 0, bytes: 0, ready: undefined as never };
        cache.set(reference, entry);
        const current = entry;
        current.ready = queue
          .then(async () => {
            assert();
            const { file } = await misty.journal.assets.download({
              resource: "note",
              resourceId,
              assetId,
            });
            assert();
            if (cache.get(reference) !== current)
              throw new Error("This Journal image closed while loading.");
            if (liveBytes + file.size > 64 * 1024 * 1024)
              throw new Error("This view has reached its image memory limit.");
            current.bytes = file.size;
            current.url = URL.createObjectURL(file);
            liveBytes += file.size;
            return current.url;
          })
          .catch((error) => {
            remove(reference, current);
            throw error;
          });
        // One verified download at a time leaves the host's other transfer slot for uploads.
        queue = current.ready.catch(() => undefined);
      }
      entry.refs++;
      const current = entry;
      const url = await current.ready;
      assert();
      let released = false;
      return {
        url,
        release() {
          if (released) return;
          released = true;
          current.refs--;
          if (!current.refs) remove(reference, current);
        },
      };
    },
  };
}
