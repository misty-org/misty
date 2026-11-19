import { httpBlob } from "@/api/client/http";
import { resolveNoteAssetUrl } from "../noteAssets";

/** An image ready to be placed in an exported file: PNG bytes and its size in pixels. */
export interface ExportImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export type ResolveExportImage = (src: string) => Promise<ExportImage | null>;

/**
 * Reads a doc's image for export: its Space asset through a signed link, re-encoded as PNG so
 * every format (WebP and AVIF too) goes into Word and PDF files. Null when it can't be read; the
 * export then leaves the image's alt text in its place.
 */
export const resolveDocImage: ResolveExportImage = async (src) => {
  try {
    const url = await resolveNoteAssetUrl(src);
    if (!/^(https?:|data:image\/|blob:)/i.test(url)) return null;
    const blob = await httpBlob(url);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return {
      data: new Uint8Array(await png.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
};
