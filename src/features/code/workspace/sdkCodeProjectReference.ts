/** Saved native folder identity; the ID grants no access outside its owning App/account/Space. */
export interface SdkCodeProjectReference {
  root: string;
  bookmarkId: string;
  write: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseSdkCodeProjectReference(value: unknown): SdkCodeProjectReference {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved Code project.");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some((key) => !["root", "bookmarkId", "write"].includes(key)) ||
    typeof item.root !== "string" ||
    !item.root.startsWith("/misty-project/") ||
    !uuid.test(item.root.slice("/misty-project/".length)) ||
    typeof item.bookmarkId !== "string" ||
    !uuid.test(item.bookmarkId) ||
    typeof item.write !== "boolean"
  )
    throw new Error("Invalid saved Code project.");
  return { root: item.root, bookmarkId: item.bookmarkId, write: item.write };
}
