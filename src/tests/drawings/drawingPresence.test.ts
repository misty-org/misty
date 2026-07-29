import type {
  Collaborator,
  OnUserFollowedPayload,
  SocketId,
  UserToFollow,
} from "@excalidraw/excalidraw/types";
import { describe, expect, it } from "vitest";
import {
  collaboratorsFromAwareness,
  DrawingFollowTracker,
} from "@/features/drawings/collaboration/drawingPresence";

describe("drawing presence", () => {
  it("keeps the same Excalidraw collaborator key after a Yjs client reconnects", () => {
    const first = collaboratorsFromAwareness(
      awareness([[101, { user: { id: "user-7", name: "Sam" } }]]),
      1,
    );
    const rejoined = collaboratorsFromAwareness(
      awareness([[902, { user: { id: "user-7", name: "Sam" } }]]),
      1,
    );

    expect([...first.keys()]).toEqual(["user:user-7"]);
    expect([...rejoined.keys()]).toEqual([...first.keys()]);
    expect(rejoined.get([...first.keys()][0])?.username).toBe("Sam");
  });

  it("falls back to the Yjs identity when authenticated identity is unavailable", () => {
    const collaborators = collaboratorsFromAwareness(
      awareness([
        [10, { user: { name: "Guest" } }],
        [11, { user: { name: "Guest" } }],
      ]),
      1,
    );

    expect([...collaborators.keys()]).toEqual(["yjs:10", "yjs:11"]);
  });

  it("restores an interrupted follow when the same user rejoins", () => {
    const tracker = new DrawingFollowTracker();
    const socketId = "user:user-7" as SocketId;
    const followed: UserToFollow = { socketId, username: "Sam" };
    tracker.record(followEvent("FOLLOW", followed), collaborators([[socketId, "Sam"]]));
    tracker.record(followEvent("UNFOLLOW", followed), collaborators([]));

    const restored = tracker.followToRestore(collaborators([[socketId, "Sam Lee"]]), null);

    expect(restored).toEqual({ socketId, username: "Sam Lee" });
  });

  it("does not restore a follow the local user deliberately stopped", () => {
    const tracker = new DrawingFollowTracker();
    const socketId = "user:user-7" as SocketId;
    const followed: UserToFollow = { socketId, username: "Sam" };
    const present = collaborators([[socketId, "Sam"]]);
    tracker.record(followEvent("FOLLOW", followed), present);
    tracker.record(followEvent("UNFOLLOW", followed), present);

    expect(tracker.followToRestore(present, null)).toBeNull();
  });
});

function awareness(states: Array<[number, Record<string, unknown>]>) {
  return { getStates: () => new Map(states) };
}

function collaborators(entries: Array<[SocketId, string]>): Map<SocketId, Collaborator> {
  return new Map(entries.map(([socketId, username]) => [socketId, { id: socketId, username }]));
}

function followEvent(
  action: OnUserFollowedPayload["action"],
  userToFollow: UserToFollow,
): OnUserFollowedPayload {
  return { action, userToFollow };
}
