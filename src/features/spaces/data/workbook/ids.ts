const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A short random id for a row, column, sheet or chart. Ids only need to be unique within their
 * workbook; eight characters from 36 make a clash between two people inserting at once vanishingly
 * rare. Ids use letters and digits only, so they sit inside anchored formulas without escaping.
 */
export function newId(length = 8): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

export function newIds(count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) ids.push(newId());
  return ids;
}
