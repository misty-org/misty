import { ApiRequestError } from "@/api/client";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createLocalOnlyProvider, isCollaborationOff } from "./localOnly";

describe("collaboration off", () => {
  it("recognizes only the server's collaboration_off answer", () => {
    expect(isCollaborationOff(new ApiRequestError("off", 503, "collaboration_off"))).toBe(true);
    expect(isCollaborationOff(new ApiRequestError("down", 503))).toBe(false);
    expect(isCollaborationOff(new Error("collaboration_off"))).toBe(false);
  });

  it("gives a synced provider that never connects", () => {
    const doc = new Y.Doc();
    const provider = createLocalOnlyProvider(doc, "note-room");
    expect(provider.synced).toBe(true);
    expect(provider.wsconnected).toBe(false);
    expect(provider.awareness.clientID).toBe(doc.clientID);
    provider.destroy();
    doc.destroy();
  });
});
