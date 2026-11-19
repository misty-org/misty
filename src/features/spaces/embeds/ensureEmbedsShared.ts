import { confirmAction } from "@/shared/lib/confirmAction";
import * as Y from "yjs";
import { setItemVisibility } from "../api/visibility";
import { readEmbedSource, type EmbedSourceItem } from "./embedSources";
import { embedSourceKind, isEmbedKind, type EmbedReference } from "./embedTypes";
import { embedAllowance, type EmbedHost } from "./embedVisibility";

/**
 * The private items among a host's embeds: what has to be shared before the host can be.
 * Sources that are gone or unreadable are left out; they already show "Removed" or "Private".
 */
export async function privateEmbedSources(
  spaceId: string,
  embeds: readonly EmbedReference[],
): Promise<EmbedSourceItem[]> {
  const sources = new Map<string, { kind: EmbedSourceItem["kind"]; id: string }>();
  for (const embed of embeds) {
    const kind = embedSourceKind(embed.kind);
    sources.set(`${kind}:${embed.item_id}`, { kind, id: embed.item_id });
  }
  const states = await Promise.all(
    [...sources.values()].map((source) => readEmbedSource(spaceId, source.kind, source.id)),
  );
  return states.flatMap((entry) =>
    entry.state === "available" && entry.item.visibility === "private" ? [entry.item] : [],
  );
}

/** Asks, in the system's dialog, whether to share a host's private embeds along with it. */
export function confirmEmbedSharing(items: readonly EmbedSourceItem[]): Promise<boolean> {
  const names = items.map((item) => `“${item.title}”`).join(", ");
  const count = items.length === 1 ? "a private item" : `${items.length} private items`;
  return confirmAction(
    `This embeds ${count}: ${names}. Share ${items.length === 1 ? "it" : "them"} with the Space too? If not, this stays private.`,
    "Share embedded items",
  );
}

/**
 * Called by a host (doc or deck) about to turn shared: when it embeds private items, asks to share
 * those too and shares them. Resolves true when the host may go ahead and false when the person
 * declined, in which case the host stays private.
 */
export async function ensureEmbedsShared(input: {
  spaceId: string;
  embeds: readonly EmbedReference[];
  /** Asked with the private items; defaults to the system dialog. */
  confirm?: (items: readonly EmbedSourceItem[]) => Promise<boolean>;
}): Promise<boolean> {
  const privateItems = await privateEmbedSources(input.spaceId, input.embeds);
  if (privateItems.length === 0) return true;
  const confirm = input.confirm ?? confirmEmbedSharing;
  if (!(await confirm(privateItems))) return false;
  for (const item of privateItems) {
    await setItemVisibility(input.spaceId, item.kind, item.id, "public");
  }
  return true;
}

/**
 * For an agent's write (note.create, note.update, deck.apply): the refusals for embeds whose
 * sources may not go into the host, each with its reason. Empty when every embed may go in.
 */
export async function embedRefusals(input: {
  spaceId: string;
  host: EmbedHost;
  embeds: readonly EmbedReference[];
}): Promise<Array<{ embed: EmbedReference; reason: string }>> {
  const refusals: Array<{ embed: EmbedReference; reason: string }> = [];
  for (const embed of input.embeds) {
    const source = await readEmbedSource(input.spaceId, embedSourceKind(embed.kind), embed.item_id);
    if (source.state === "removed") {
      refusals.push({
        embed,
        reason: `There is no ${embedSourceKind(embed.kind)} ${embed.item_id} in this Space.`,
      });
      continue;
    }
    if (source.state === "private") {
      refusals.push({
        embed,
        reason: "That item is private to someone else, so it can't be embedded.",
      });
      continue;
    }
    const allowance = embedAllowance(input.host, source.item, input.host.creatorId);
    if (!allowance.ok) {
      refusals.push({
        embed,
        reason:
          input.host.visibility === "public"
            ? `“${source.item.title}” is private and this item is shared, so it can't be embedded. ` +
              "Ask its owner to share it first; agents don't change an item's visibility."
            : allowance.reason,
      });
    }
  }
  return refusals;
}

/** The embeds a doc's live content holds (its "tiptap" fragment). */
export function embedsInNoteDoc(doc: Y.Doc): EmbedReference[] {
  const found: EmbedReference[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === "mistyEmbed") {
        const kind = child.getAttribute("kind");
        const itemId = child.getAttribute("itemId");
        const partId = child.getAttribute("partId");
        const title = child.getAttribute("title");
        if (isEmbedKind(kind) && itemId && partId)
          found.push({
            kind,
            item_id: String(itemId),
            part_id: String(partId),
            ...(title ? { title: String(title) } : {}),
          });
        continue;
      }
      walk(child);
    }
  };
  walk(doc.getXmlFragment("tiptap"));
  return found;
}

/** The embeds a deck's slots hold (`deck:slides` › slide › `slots`). */
export function embedsInDeckDoc(doc: Y.Doc): EmbedReference[] {
  const found: EmbedReference[] = [];
  for (const slide of doc.getMap<Y.Map<unknown>>("deck:slides").values()) {
    if (!(slide instanceof Y.Map)) continue;
    const slots = slide.get("slots");
    if (!(slots instanceof Y.Map)) continue;
    for (const slot of slots.values()) {
      if (!(slot instanceof Y.Map)) continue;
      const kind = slot.get("type");
      const itemId = slot.get("item_id");
      const partId = slot.get("part_id");
      const title = slot.get("title");
      if (isEmbedKind(kind) && typeof itemId === "string" && typeof partId === "string")
        found.push({
          kind,
          item_id: itemId,
          part_id: partId,
          ...(typeof title === "string" && title ? { title } : {}),
        });
    }
  }
  return found;
}
