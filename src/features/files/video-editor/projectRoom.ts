import type * as Y from "yjs";
import { parseVideoProject, type VideoProjectDocument } from "./projectDocumentTypes";

/**
 * A video project's live room: the project's latest document, shared by everyone with it open
 * and by agents editing it, so a change made anywhere shows in every open editor at once. The
 * Space's file is kept too; the room is how a change gets to the editors already open.
 */
const MAP = "video";
const KEY = "document";
/** Marks this window's own writes, which its editor already shows. */
const LOCAL = Symbol("this-window");

export function readRoomProject(room: Y.Doc): VideoProjectDocument | null {
  const text = room.getMap<string>(MAP).get(KEY);
  if (typeof text !== "string") return null;
  try {
    return parseVideoProject(text);
  } catch {
    return null;
  }
}

export function writeRoomProject(room: Y.Doc, document: VideoProjectDocument): void {
  room.transact(() => room.getMap<string>(MAP).set(KEY, JSON.stringify(document)), LOCAL);
}

/** Calls back with each document someone else puts in the room. */
export function watchRoomProject(
  room: Y.Doc,
  onChange: (document: VideoProjectDocument) => void,
): () => void {
  const map = room.getMap<string>(MAP);
  const observer = (event: Y.YMapEvent<string>) => {
    if (event.transaction.origin === LOCAL || !event.keysChanged.has(KEY)) return;
    const document = readRoomProject(room);
    if (document) onChange(document);
  };
  map.observe(observer);
  return () => map.unobserve(observer);
}

/** When a document was last changed, by its project's own clock; 0 for an empty project. */
export function projectUpdatedAt(document: VideoProjectDocument): number {
  const metadata = (document.project as { metadata?: { updatedAt?: string } } | null)?.metadata;
  const time = metadata?.updatedAt ? Date.parse(metadata.updatedAt) : 0;
  return Number.isFinite(time) ? time : 0;
}

/** The newer of the kept file and the room's document. */
export function newerProject(
  kept: VideoProjectDocument,
  room: VideoProjectDocument | null,
): VideoProjectDocument {
  return room && projectUpdatedAt(room) > projectUpdatedAt(kept) ? room : kept;
}
