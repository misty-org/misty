import type { ItemVisibility } from "../api/visibility";

/*
 * An embedded item must be at least as visible as the doc or deck holding it:
 * - a shared item goes into any host;
 * - a private item goes only into a private host of the same creator;
 * - a shared host takes only shared items. The picker offers "Make shared" for the person's own
 *   private items, and inserts once the item is shared.
 * Agents get the same rule and never change an item's visibility themselves.
 */

export interface EmbedHost {
  visibility: ItemVisibility;
  /** Who made the host. A private host opens only for its creator, so it is the viewer's. */
  creatorId?: string;
}

export interface EmbedSourceAccess {
  visibility: ItemVisibility;
  creatorId?: string;
}

export type EmbedAllowance =
  | { ok: true }
  | {
      ok: false;
      /** "make-shared" when the viewer owns the item and can share it to insert it. */
      fix: "make-shared" | null;
      reason: string;
    };

/** Whether `source` may go into `host`, seen by `viewerId` (who would insert it). */
export function embedAllowance(
  host: EmbedHost,
  source: EmbedSourceAccess,
  viewerId?: string,
): EmbedAllowance {
  if (source.visibility !== "private") return { ok: true };
  const owner = viewerId !== undefined && source.creatorId === viewerId;
  if (host.visibility === "private") {
    const hostCreator = host.creatorId ?? viewerId;
    if (hostCreator !== undefined && source.creatorId === hostCreator) return { ok: true };
    return {
      ok: false,
      fix: null,
      reason: "A private item can only go into a private doc or deck of the same person.",
    };
  }
  return {
    ok: false,
    fix: owner ? "make-shared" : null,
    reason: "This item is private. A shared doc or deck only takes shared items.",
  };
}

/**
 * The refusal an agent's embed gets, or null when it may go in. Agents never change visibility,
 * so the words say who can.
 */
export function embedRefusalReason(
  host: EmbedHost & { label?: string },
  source: EmbedSourceAccess & { title?: string },
): string | null {
  const allowance = embedAllowance(host, source, host.creatorId);
  if (allowance.ok) return null;
  const item = source.title ? `“${source.title}”` : "The item";
  const where =
    host.label ?? (host.visibility === "private" ? "this private item" : "this shared item");
  if (host.visibility === "private") {
    return `${item} is private to someone else, so it can't be embedded in ${where}.`;
  }
  return `${item} is private, and ${where} is shared, so it can't be embedded. Ask its owner to share it first; agents don't change an item's visibility.`;
}

/**
 * What an existing embed shows: live, or "Private" when its source is now private and the host
 * may not show it (or the person can't read it).
 */
export function embedShowsPrivate(host: EmbedHost, source: EmbedSourceAccess, viewerId?: string) {
  return !embedAllowance(host, source, viewerId).ok;
}
