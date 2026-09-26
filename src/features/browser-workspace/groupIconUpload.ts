const maxIconLength = 32_768;

export function isGroupIconImage(value: string): boolean {
  return (
    value.length <= maxIconLength && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

/** Store a small, static PNG in the group's synced icon field. */
export async function readGroupIcon(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPG, or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This image could not be opened. Try another file."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context || !image.naturalWidth || !image.naturalHeight)
      throw new Error("This image could not be opened. Try another file.");
    const scale = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
    const icon = canvas.toDataURL("image/png");
    if (!isGroupIconImage(icon))
      throw new Error("This image could not be saved. Try another file.");
    return icon;
  } finally {
    URL.revokeObjectURL(url);
  }
}
