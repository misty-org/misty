import { spacesApi } from "../../api/api";
import { MAX_JOURNAL_ASSET_BYTES, uploadJournalAsset } from "../../journal/api/assets";

const imageExtensions: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const deckImageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

/** Uploads an image as one of the deck's assets and returns its id. */
export async function uploadDeckImage(
  spaceId: string,
  deckId: string,
  file: File,
): Promise<string> {
  const type = (file.type || guessType(file.name)).toLowerCase();
  if (!imageExtensions[type])
    throw new Error("Slides take PNG, JPEG, WebP, GIF, BMP or AVIF images.");
  if (file.size > MAX_JOURNAL_ASSET_BYTES) throw new Error("Images must be 15 MB or smaller.");
  const named = file.type ? file : new File([file], file.name, { type });
  const asset = await uploadJournalAsset({
    kind: "deck",
    spaceId,
    resourceId: deckId,
    file: named,
  });
  return asset.id;
}

/** Copies an image from the Space's media into the deck's assets and returns its id. */
export async function libraryImageToDeck(
  spaceId: string,
  deckId: string,
  itemId: string,
): Promise<string> {
  const blob = await spacesApi.libraryContent(spaceId, itemId);
  const type = blob.type.toLowerCase();
  const extension = imageExtensions[type];
  if (!extension) throw new Error("Pick an image: slides can't show this kind of file.");
  return uploadDeckImage(spaceId, deckId, new File([blob], `image.${extension}`, { type }));
}

function guessType(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return Object.entries(imageExtensions).find(([, value]) => value === extension)?.[0] ?? "";
}
