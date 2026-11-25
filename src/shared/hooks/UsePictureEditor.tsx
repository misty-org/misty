import { useState } from "react";
import { notify, PictureEditorDialog, type PictureEditorResult } from "@misty/ui";
import { decodedPictureUrl, showPicturePreview } from "@/shared/lib/picture_previews";
import { MAX_PICTURE_BYTES, PICTURE_TYPES } from "@/shared/lib/square_png";

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export function usePictureEditor({
  title,
  shape,
  previewKey,
  src,
  outline,
  uploadPicture,
  saveOutline,
  showOutline,
}: {
  title?: string;
  shape?: "circle" | "tile";
  previewKey: string;
  src: string | null;
  outline: string | null;
  uploadPicture: (png: Blob, url: string) => Promise<void>;
  saveOutline: (outline: string | null) => Promise<void>;
  showOutline: (outline: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const save = async ({ picture, outline: next }: PictureEditorResult) => {
    if (picture && picture.size > MAX_PICTURE_BYTES) throw new Error("That image is too large.");
    const url = picture ? await decodedPictureUrl(picture) : null;
    const before = outline;
    const outlineChanged = next !== before;
    if (url) showPicturePreview(previewKey, url);
    if (outlineChanged) showOutline(next);
    void (async () => {
      try {
        if (picture && url) await uploadPicture(picture, url);
        if (outlineChanged) await saveOutline(next);
        await nextFrame();
        if (url) showPicturePreview(previewKey, null);
      } catch (cause) {
        if (url) showPicturePreview(previewKey, null);
        if (outlineChanged) showOutline(before);
        notify({
          message: cause instanceof Error ? cause.message : "The picture wasn't saved. Try again.",
          tone: "error",
        });
      }
    })();
  };
  const dialog = open ? (
    <PictureEditorDialog
      key={previewKey}
      title={title}
      shape={shape}
      src={src}
      outline={outline}
      accept={PICTURE_TYPES}
      onSave={save}
      onClose={() => setOpen(false)}
    />
  ) : null;
  return { open: () => setOpen(true), dialog };
}
