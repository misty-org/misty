export interface LibraryMediaKind {
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
}

/**
 * Classifies a Library item from its MIME type, falling back to dimensions.
 *
 * Some uploads arrive with a generic or missing MIME type, so anything that is
 * not video but reports a width and height is treated as an image.
 */
export function libraryMediaKind(
  mimeType: string,
  metadata: Record<string, unknown>,
): LibraryMediaKind {
  return {
    isImage:
      mimeType.startsWith("image/") ||
      (!mimeType.startsWith("video/") &&
        Number(metadata.width ?? 0) > 0 &&
        Number(metadata.height ?? 0) > 0),
    isVideo: /^video\//.test(mimeType),
    isAudio: /^audio\//.test(mimeType),
  };
}

export function editedImageFilename(displayName: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const base = (displayName || "image").replace(/\.[^./\\]+$/, "");
  return `${base}.${extension}`;
}

export function editedImageMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "image/jpeg";
  if (mimeType === "image/webp") return "image/webp";
  return "image/png";
}
