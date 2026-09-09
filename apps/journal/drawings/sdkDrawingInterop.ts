import type { MistyAppSDK } from "@misty/sdk";
import { exportSdkJournalFile } from "@/features/journal/sdkJournalExport";

const types: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  json: "application/json",
  excalidraw: "application/vnd.excalidraw+json",
  excalidrawlib: "application/vnd.excalidrawlib+json",
};
const aborted = () => new DOMException("The Journal operation was cancelled.", "AbortError");

/** Adapter for the drawing library's own menu/keyboard actions, owned by one component factory. */
export function createSdkDrawingInterop(misty: MistyAppSDK, signal: AbortSignal) {
  const assert = () => {
    if (signal.aborted) throw aborted();
  };
  return {
    async readSystemClipboard(): Promise<Record<string, string | File>> {
      assert();
      const image = await misty.clipboard.readImage();
      assert();
      if (image) return { "image/png": new File([image], "Clipboard.png", { type: "image/png" }) };
      const text = await misty.clipboard.readText();
      assert();
      return { "text/plain": text };
    },
    async copyTextToSystemClipboard(text: string) {
      assert();
      await misty.clipboard.writeText(text || "");
      assert();
    },
    async copyBlobToClipboardAsPng(pending: Blob | Promise<Blob>) {
      assert();
      const blob = await pending;
      assert();
      await misty.clipboard.writeImage(blob);
      assert();
    },
    async fileOpen(options: { multiple?: boolean; extensions?: string[] } = {}) {
      assert();
      const selected = options.multiple
        ? await misty.files.pickMany()
        : [await misty.files.pick()].filter((file) => file !== null);
      try {
        assert();
        if (!selected.length) throw aborted();
        if (
          selected.length > 16 ||
          selected.reduce((bytes, file) => bytes + file.bytes, 0) > 128 * 1024 * 1024
        )
          throw new Error("Choose up to 16 files totaling 128 MB or smaller.");
        const files: File[] = [];
        for (const picked of selected) {
          assert();
          const extension = picked.name.split(".").pop()?.toLowerCase() ?? "";
          if (
            options.extensions?.length &&
            !options.extensions.some(
              (allowed) =>
                allowed.replace(/^\./, "").toLowerCase() === extension ||
                (allowed === "jpg" && extension === "jpeg"),
            )
          )
            throw new Error("Choose a file format supported by this drawing action.");
          if (
            !Number.isSafeInteger(picked.bytes) ||
            picked.bytes < 0 ||
            picked.bytes > 64 * 1024 * 1024
          )
            throw new Error("Drawing files are limited to 64 MB.");
          const parts: ArrayBuffer[] = [];
          for (let offset = 0; offset < picked.bytes; offset += 64 * 1024) {
            assert();
            const length = Math.min(64 * 1024, picked.bytes - offset);
            const bytes = await misty.files.readBytes(picked.handle, offset, length);
            if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== length)
              throw new Error("The selected file changed while reading.");
            parts.push(bytes);
          }
          assert();
          files.push(
            new File(parts, picked.name, { type: types[extension] ?? "application/octet-stream" }),
          );
        }
        return options.multiple ? files : files[0];
      } finally {
        await Promise.all(
          selected.map((file) => misty.files.release(file.handle).catch(() => undefined)),
        );
      }
    },
    async fileSave(blob: Blob | Promise<Blob>, options: { name: string; extension: string }) {
      assert();
      const file = await blob;
      assert();
      const name = `${options.name}.${options.extension}`;
      if (!(await exportSdkJournalFile(misty, signal, file, name))) throw aborted();
      assert();
      return { name };
    },
  };
}
