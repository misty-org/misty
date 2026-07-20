import type { ClipboardPngImage } from "@/models/interfaces/features/explorer/utils/clipboardImage";
export type { ClipboardPngImage } from "@/models/interfaces/features/explorer/utils/clipboardImage";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";

export async function clipboardImagePng(): Promise<ClipboardPngImage | null> {
  const image = await readImage().catch(() => null);
  if (!image) return null;
  const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
  if (size.width <= 0 || size.height <= 0 || rgba.length === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: size.width,
    height: size.height,
  };
}
