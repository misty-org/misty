import { useCallback, useState } from "react";
import { notify } from "@misty/ui";
import { clearImageEdit, type ImageDocParts } from "./imageDoc";
import type { ImageEdit } from "./imageEdit";
import {
  canvasToBlob,
  loadPhoto,
  renderEdit,
  type PhotoSource,
  type SaveFormat,
} from "./imageRender";
import type { SaveAsChoice } from "./SaveAsDialog";
import type { ImageDocument } from "./useImageDocument";

export type PhotoWork = "save" | "copy" | "export";

/** The file name a download gets: the image's name with the saved format's extension. */
export function filenameFor(name: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const stem = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${stem}.${extension}`;
}

/**
 * Saving the edit: over the original, as a copy, under a new name or format, as a download or
 * onto the clipboard. Save, Save as copy and Download use the format chosen in the Size tab. One
 * piece of work runs at a time; a failure shows in the editor.
 */
export function usePhotoSaving(options: {
  name: string;
  photo: PhotoSource;
  edit: ImageEdit;
  format: SaveFormat;
  readonly: boolean;
  parts: ImageDocParts;
  document: ImageDocument;
  loadOriginal?: () => Promise<Blob>;
  onSave?: (rendered: Blob) => void | string | Promise<void | string>;
  onSaveAsCopy: (rendered: Blob, filename?: string) => void | Promise<void>;
  /** After saving over the original: nothing is picked in the image saved. */
  onSavedOver: () => void;
}) {
  const { name, photo, edit, format, readonly, parts, document, loadOriginal } = options;
  const { onSave, onSaveAsCopy, onSavedOver } = options;
  const [busy, setBusy] = useState<PhotoWork | null>(null);
  const [saveError, setSaveError] = useState("");

  /** The whole edit at full size, from the original when there is one, its stickers loaded. */
  const renderEdited = useCallback(async () => {
    const full = loadOriginal
      ? await loadOriginal()
          .then(loadPhoto)
          .catch(() => photo)
      : photo;
    return renderEdit(full, edit);
  }, [edit, loadOriginal, photo]);
  const encode = useCallback(
    async () => canvasToBlob(await renderEdited(), format.mimeType, format.quality),
    [format.mimeType, format.quality, renderEdited],
  );

  const run = useCallback(
    async (kind: PhotoWork, work: () => Promise<void>) => {
      if (busy) return;
      setBusy(kind);
      setSaveError("");
      try {
        await work();
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : "The image could not be saved.");
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const saveOver = useCallback(
    () =>
      run("save", async () => {
        if (readonly) return;
        const blob = await encode();
        if (!onSave) {
          await onSaveAsCopy(blob);
          notify({ message: "Saved a copy to Media" });
          return;
        }
        const base = await onSave(blob);
        // The edit is in the image now: everyone starts again from the saved image.
        clearImageEdit(parts, typeof base === "string" ? base : "", { image: "saved" });
        document.forget();
        onSavedOver();
      }),
    [document, encode, onSave, onSaveAsCopy, onSavedOver, parts, readonly, run],
  );
  const saveCopy = useCallback(
    () =>
      run("copy", async () => {
        if (readonly) return;
        const blob = await encode();
        await onSaveAsCopy(blob);
        notify({ message: "Saved a copy to Media" });
      }),
    [encode, onSaveAsCopy, readonly, run],
  );
  const saveAs = (choice: SaveAsChoice, done: () => void) =>
    run("copy", async () => {
      const blob = await canvasToBlob(await renderEdited(), choice.mimeType, choice.quality);
      await onSaveAsCopy(blob, choice.filename);
      done();
      notify({ message: `Saved “${choice.filename}” to Media` });
    });
  const download = () =>
    run("export", async () => {
      const blob = await encode();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFor(name, format.mimeType);
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const copyImage = () =>
    run("export", async () => {
      const blob = await canvasToBlob(await renderEdited(), "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify({ message: "Copied the image" });
    });
  /** Saves a copy of the edited image as `filename`, made from it by `make`. */
  const saveMade = (filename: string, make: (rendered: Blob) => Promise<Blob>) =>
    run("copy", async () => {
      if (readonly) return;
      const made = await make(await canvasToBlob(await renderEdited(), "image/png"));
      await onSaveAsCopy(made, filename);
      notify({ message: `Saved “${filename}” to Media` });
    });

  return { busy, saveError, saveOver, saveCopy, saveAs, download, copyImage, saveMade };
}
