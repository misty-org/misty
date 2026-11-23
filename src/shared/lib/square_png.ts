const MAX_DIMENSION = 512;
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
export const PICTURE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export async function toSquarePng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read. Try a PNG, JPEG or WebP.");
  });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(side, MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That image couldn't be read.");
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("That image couldn't be read."))),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
}
