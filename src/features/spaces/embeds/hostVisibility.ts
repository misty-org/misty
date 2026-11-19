import { setItemVisibility, type ItemVisibility, type VisibilityItemKind } from "../api/visibility";
import { readToolDoc } from "../collab/toolSession";
import { embedsInDeckDoc, embedsInNoteDoc, ensureEmbedsShared } from "./ensureEmbedsShared";

/**
 * Puts an item on a layer. A doc or deck turning shared first shares the private items it embeds
 * (charts, ranges, whiteboard frames), after asking; when the person declines, it stays private
 * and this resolves false. Every other change goes straight through.
 */
export async function setHostVisibility(
  spaceId: string,
  kind: VisibilityItemKind,
  itemId: string,
  visibility: ItemVisibility,
): Promise<boolean> {
  if (visibility === "public" && (kind === "note" || kind === "deck")) {
    const embeds = await readToolDoc(kind, spaceId, itemId, (doc) =>
      kind === "note" ? embedsInNoteDoc(doc) : embedsInDeckDoc(doc),
    );
    if (embeds.length && !(await ensureEmbedsShared({ spaceId, embeds }))) return false;
  }
  await setItemVisibility(spaceId, kind, itemId, visibility);
  return true;
}
