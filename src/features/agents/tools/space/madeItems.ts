import { invoke } from "@tauri-apps/api/core";
import { spacesGateway, type SpaceItemTools } from "../../spaces-gateway/spacesGateway";
import type { LocalToolRequest } from "../host";
import { loadRunEntry } from "../runContexts";
import { readRoute, refuse, segment, spacePath } from "./api";

/**
 * What decks, workbooks and whiteboards share in agent tools: reaching their live rooms, bringing
 * a picture in, and the rule that an embedded item is at least as visible as what shows it.
 */

const UNAVAILABLE = "Docs, decks and workbooks can't be reached from here.";

export async function itemTools(): Promise<SpaceItemTools> {
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  return gateway.itemTools();
}

export type Visibility = "public" | "private";

export interface MadeItem {
  id: string;
  title: string;
  creator_user_id: string;
  collaboration_revision?: number;
  visibility?: Visibility;
  plain_text?: string;
  updated_at?: string;
}

export const madePath = (spaceId: string, part: "decks" | "workbooks", id = "") =>
  spacePath(spaceId, `/${part}${id ? `/${segment(id)}` : ""}`);

/** An object argument, or a refusal saying which. */
export function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw refuse(`${what} must be an object`);
  return value as Record<string, unknown>;
}

/** A list argument of at most `max` objects. */
export function objects(value: unknown, what: string, max: number): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw refuse(`${what} must be a list`);
  if (value.length > max) throw refuse(`${what} can have at most ${max} entries`);
  return value.map((entry, index) => object(entry, `${what}[${index}]`));
}

/** Refuses a change made from an older read, when the call says which one it read. */
export function checkRevision(item: MadeItem, input: Record<string, unknown>) {
  const base = input.base_revision;
  if (base === undefined) return;
  if (typeof base !== "number") throw refuse("base_revision must be a number");
  if (item.collaboration_revision !== undefined && item.collaboration_revision !== base)
    throw refuse("it changed since you read it; read it again and apply your change to that");
}

/**
 * A picture for a slide: an asset already in the deck, a web address, or a file in the chat's
 * folder. Web pictures are fetched here; the file comes from the chat's folder like `file.upload`.
 */
export async function slideImage(
  request: LocalToolRequest,
  spaceId: string,
  deckId: string,
  source: string,
  tools: SpaceItemTools,
): Promise<string> {
  if (/^[A-Za-z0-9_-]{1,128}$/.test(source) && !source.includes("."))
    return source; // already an asset id
  let file: File;
  if (/^https?:\/\//i.test(source)) {
    try {
      file = await tools.fetchPicture(source, request.signal);
    } catch (error) {
      throw refuse(error instanceof Error ? error.message : "that picture couldn't be fetched");
    }
  } else {
    const run = await loadRunEntry(request.runId).catch(() => null);
    if (!run?.conversationId)
      throw refuse("only a chat's agent can use a picture from its folder", "not_allowed");
    let bytes: ArrayBuffer;
    try {
      bytes = await invoke<ArrayBuffer>("chat_media_load", {
        account: run.account,
        conversation: run.conversationId,
        path: source,
      });
    } catch (error) {
      throw refuse(typeof error === "string" ? error : "that picture can't be read");
    }
    const name = source.split(/[\\/]/).pop() || "picture";
    file = new File([bytes], name, { type: pictureType(name) });
    if (!file.type) throw refuse("that file isn't a picture Slides can show");
  }
  return tools.uploadDeckImage(spaceId, deckId, file);
}

function pictureType(name: string): string {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return types[extension] ?? "";
}

export type EmbedKind = "data_chart" | "data_range" | "board_frame";
const embedSource: Record<EmbedKind, string> = {
  data_chart: "workbooks",
  data_range: "workbooks",
  board_frame: "drawings",
};

/**
 * An embedded chart, range or whiteboard frame must be at least as visible as the deck or doc
 * showing it: a shared host takes only shared items, and a private one only its creator's own.
 * Agents never change an item's visibility, so a private source is refused with the reason.
 */
export async function checkEmbed(
  request: LocalToolRequest,
  spaceId: string,
  host: { visibility?: Visibility; creator_user_id: string },
  kind: EmbedKind,
  itemId: string,
) {
  const source = await readRoute<MadeItem>(
    request,
    spacePath(spaceId, `/${embedSource[kind]}/${segment(itemId)}`),
  ).catch(() => {
    throw refuse(`no ${kind === "board_frame" ? "whiteboard" : "workbook"} ${itemId} to embed`);
  });
  if (source.visibility !== "private") return source;
  if (host.visibility !== "private")
    throw refuse(
      `"${source.title}" is private, so it can't go into a shared item. Ask the person to share it first.`,
    );
  if (source.creator_user_id !== host.creator_user_id)
    throw refuse(`"${source.title}" is someone else's private item, so it can't be embedded here.`);
  return source;
}
