import { spaceRequest } from "../api/api";

/** The kinds with version history, as their routes name them. */
export type HistoryKind = "notes" | "drawings" | "decks" | "workbooks";

/** One kept snapshot of an item. */
export interface HistoryVersion {
  id: string;
  created_at: string;
  content_bytes: number;
}

const part = encodeURIComponent;
const historyPath = (spaceId: string, kind: HistoryKind, itemId: string) =>
  `/spaces/${part(spaceId)}/${kind}/${part(itemId)}/history`;

/** Base64 (a version's full Yjs state as the server sends it) to bytes. */
export function decodeHistoryUpdate(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * An item's version history (plan F5): the Worker keeps a snapshot every 10 minutes of activity,
 * then hourly after a day and daily after a week, for as long as the Space's level keeps history.
 */
export const historyApi = {
  /** The kept versions, newest first. */
  list: (spaceId: string, kind: HistoryKind, itemId: string) =>
    spaceRequest<{ versions: HistoryVersion[] }>(historyPath(spaceId, kind, itemId)).then(
      (result) =>
        [...(result.versions ?? [])].sort(
          (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
        ),
    ),
  /** One version's full Yjs state. */
  get: (spaceId: string, kind: HistoryKind, itemId: string, versionId: string) =>
    spaceRequest<{ update: string }>(
      `${historyPath(spaceId, kind, itemId)}/${part(versionId)}`,
    ).then((result) => decodeHistoryUpdate(result.update)),
  /** Puts the item back to that version as a new revision everyone connected sees. */
  restore: (spaceId: string, kind: HistoryKind, itemId: string, versionId: string) =>
    spaceRequest(`${historyPath(spaceId, kind, itemId)}/${part(versionId)}/restore`, {
      method: "POST",
    }),
};
