import { ApiRequestError } from "@/api/client";
import { spaceRequest } from "../api/api";
import type { ItemVisibility } from "../api/visibility";
import { readToolDoc } from "../collab/toolSession";
import { drawingsApi } from "../journal/drawings/api/api";
import { listRoomFrames } from "../journal/drawings/drawingFrames";
import { embedSourceKind, type EmbedKind, type EmbedSourceKind } from "./embedTypes";
import { listWorkbookParts } from "./workbookParts";

/** An item an embed can come from, as its list route describes it. */
export interface EmbedSourceItem {
  kind: EmbedSourceKind;
  id: string;
  title: string;
  visibility: ItemVisibility;
  creatorId: string;
}

/** One embeddable part of a source. */
export interface EmbedPart {
  kind: EmbedKind;
  partId: string;
  title: string;
}

/** What reading a source found: the item, or why it can't be shown. */
export type EmbedSourceState =
  { state: "available"; item: EmbedSourceItem } | { state: "private" } | { state: "removed" };

interface ListedItem {
  id: string;
  title: string;
  creator_user_id: string;
  visibility?: ItemVisibility;
  lifecycle_state?: string;
}

const part = encodeURIComponent;

function sourceItem(kind: EmbedSourceKind, item: ListedItem): EmbedSourceItem {
  return {
    kind,
    id: item.id,
    title: item.title?.trim() || (kind === "drawing" ? "Untitled whiteboard" : "Untitled data"),
    visibility: item.visibility ?? "public",
    creatorId: item.creator_user_id,
  };
}

function getWorkbook(spaceId: string, id: string) {
  return spaceRequest<ListedItem>(`/spaces/${part(spaceId)}/workbooks/${part(id)}`);
}

function listWorkbooks(spaceId: string) {
  return spaceRequest<{ workbooks: ListedItem[] }>(`/spaces/${part(spaceId)}/workbooks`).then(
    (result) => result.workbooks ?? [],
  );
}

/** Reads an embed's source item, telling a deleted one from one this person can't read. */
export async function readEmbedSource(
  spaceId: string,
  kind: EmbedSourceKind,
  itemId: string,
): Promise<EmbedSourceState> {
  try {
    const item =
      kind === "drawing"
        ? await drawingsApi.get(spaceId, itemId)
        : await getWorkbook(spaceId, itemId);
    if (item.lifecycle_state && item.lifecycle_state !== "active") return { state: "removed" };
    return { state: "available", item: sourceItem(kind, item) };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return { state: "removed" };
    if (error instanceof ApiRequestError && error.status === 403) return { state: "private" };
    throw error;
  }
}

/** The Space's items that hold parts of the given kinds, newest first. */
export async function listEmbedSources(
  spaceId: string,
  kinds: readonly EmbedKind[],
): Promise<EmbedSourceItem[]> {
  const sources = new Set(kinds.map(embedSourceKind));
  const [workbooks, drawings] = await Promise.all([
    sources.has("workbook") ? listWorkbooks(spaceId) : Promise.resolve([]),
    sources.has("drawing")
      ? drawingsApi.list(spaceId).then((result) => result.drawings)
      : Promise.resolve([]),
  ]);
  return [
    ...workbooks
      .filter((item) => !item.lifecycle_state || item.lifecycle_state === "active")
      .map((item) => sourceItem("workbook", item)),
    ...drawings
      .filter((item) => item.lifecycle_state === "active")
      .map((item) => sourceItem("drawing", item)),
  ];
}

/** The parts of one source of the given kinds, read from its live room. */
export async function listEmbedParts(
  spaceId: string,
  source: Pick<EmbedSourceItem, "kind" | "id">,
  kinds: readonly EmbedKind[],
): Promise<EmbedPart[]> {
  if (source.kind === "drawing") {
    if (!kinds.includes("board-frame")) return [];
    const frames = await readToolDoc("drawing", spaceId, source.id, (doc) =>
      listRoomFrames(doc.getMap("drawing:elements")),
    );
    return frames.map((frame) => ({ kind: "board-frame", partId: frame.id, title: frame.name }));
  }
  const parts = await readToolDoc("workbook", spaceId, source.id, listWorkbookParts);
  return parts.filter((entry) => kinds.includes(entry.kind));
}
