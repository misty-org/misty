import { ApiRequestError } from "@/api/client";
import YProvider from "y-partyserver/provider";
import type * as Y from "yjs";

export { collaborationOffMessage } from "./collaborationOff";

/**
 * Whether a collaboration ticket was refused because this Misty server runs without live
 * co-editing (503 `collaboration_off`). The server then has no way to save note or drawing
 * content, so both open read-only with `collaborationOffMessage` beside them.
 */
export function isCollaborationOff(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.status === 503 && error.code === "collaboration_off"
  );
}

/**
 * A provider that never connects, for a read-only view. It reports itself synced at once
 * and keeps its own awareness, so views that draw cursors still work.
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
