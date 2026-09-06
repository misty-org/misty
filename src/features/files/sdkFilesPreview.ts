import { useEffect } from "react";
import type { PreviewRuntime } from "./explorer/components/globalPreview/PreviewRuntime";
import { sourceExtension } from "./explorer/components/globalPreview/previewFormat";
import {
  extractDocumentText,
  globalPreviewKindForSource,
} from "./explorer/components/globalPreview/previewDocument";
import {
  audioMimeTypes,
  imageMimeTypes,
  videoMimeTypes,
} from "./explorer/components/globalPreview/previewMediaTables";
import type { SdkFilesStore } from "./sdkFilesStore";

/** The existing preview UI uses only the owning Files view's SDK operations. */
export function createSdkFilesPreviewRuntime(
  files: SdkFilesStore,
  options: { Error: PreviewRuntime["Error"] },
): PreviewRuntime {
  const crlf = new Map<string, boolean>();
  return {
    Error: options.Error,
    async load(source, signal) {
      const extension = sourceExtension(source);
      const mimeType =
        source.mimeType ||
        imageMimeTypes[extension] ||
        videoMimeTypes[extension] ||
        audioMimeTypes[extension] ||
        "application/octet-stream";
      const kind = globalPreviewKindForSource(extension, mimeType);
      if (kind === "archive") {
        const format =
          extension === "zip" || extension === "7z" || extension === "rar" ? extension : "tar";
        const archive = await files.listArchive(source.path, format, signal);
        return {
          kind,
          mimeType: "application/vnd.misty.archive-list",
          archiveEntries: archive.entries,
          archiveFormat: archive.format,
        };
      }
      if (kind === "generic") return { kind, mimeType };
      const bytes = new Uint8Array(await files.readBytes(source.path, 64 * 1024 * 1024));
      if (signal.aborted) throw new Error("This preview is closed.");
      if (kind === "text" || kind === "markdown") {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        crlf.set(source.path, text.includes("\r\n") && !text.replace(/\r\n/g, "").includes("\n"));
        return { kind, text, mimeType };
      }
      crlf.delete(source.path);
      if (kind === "document")
        return { kind, text: await extractDocumentText(extension, bytes), mimeType };
      return {
        kind,
        url: URL.createObjectURL(
          new Blob([bytes], { type: kind === "pdf" ? "application/pdf" : mimeType }),
        ),
        mimeType,
      };
    },
    async save(source, bytes, copy) {
      if (source.remote || (source.readonly && !copy))
        throw new Error("This preview is read-only.");
      if (crlf.get(source.path)) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        bytes = new TextEncoder().encode(text.replace(/\r?\n/g, "\r\n"));
      }
      return files.saveBytes(source.path, Uint8Array.from(bytes).buffer, copy);
    },
    open: (source) => files.openExternal(source.path),
    useSaveShortcut(save, enabled, element) {
      useEffect(() => {
        const root = element.current;
        if (!root || !enabled) return;
        const keydown = (event: KeyboardEvent) => {
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.shiftKey ||
            !(event.metaKey || event.ctrlKey) ||
            event.key.toLowerCase() !== "s"
          )
            return;
          event.preventDefault();
          save();
        };
        root.addEventListener("keydown", keydown);
        return () => root.removeEventListener("keydown", keydown);
      }, [save, enabled, element]);
    },
  };
}
