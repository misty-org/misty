import { ApiRequestError } from "@/api/client";
import YProvider from "y-partyserver/provider";
import type * as Y from "yjs";

/**
 * Whether a collaboration ticket was refused because this Misty server runs without live
 * co-editing (503 `collaboration_off`). Notes and drawings then keep working on this
 * device, without other people's cursors; it is not an error to show.
 */
export function isCollaborationOff(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.status === 503 && error.code === "collaboration_off"
  );
}

/**
 * A provider that never connects: the document is edited here only. It reports itself
 * synced at once and keeps its own awareness, so editors that draw cursors still work.
 */
export function createLocalOnlyProvider(
  doc: Y.Doc,
  party: "note-room" | "drawing-room",
): YProvider {
  const provider = new YProvider("localhost", "local-only", doc, {
    party,
    connect: false,
    disableBc: true,
  });
  provider.synced = true;
  return provider;
}
