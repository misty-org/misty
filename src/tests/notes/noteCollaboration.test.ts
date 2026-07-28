import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequestMock = vi.hoisted(() => vi.fn());
const providerDestroyMock = vi.hoisted(() => vi.fn());

vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  spaceRequest: spaceRequestMock,
}));

vi.mock("y-partyserver/provider", () => ({
  default: class FakeYProvider {
    destroy = providerDestroyMock;
  },
}));

import {
  acquireNoteCollaborationSession,
  closeAllNoteCollaborationSessions,
  noteCollaborationIdleMs,
  releaseNoteCollaborationSession,
} from "@/features/notes/noteCollaboration";

describe("note collaboration session cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spaceRequestMock.mockReset();
    providerDestroyMock.mockReset();
    closeAllNoteCollaborationSessions();
    spaceRequestMock.mockImplementation(async () => ({
      ticket: `ticket-${spaceRequestMock.mock.calls.length}`,
      room: "room-note",
      url: "wss://misty-note-collab-dev.mistysys.workers.dev/parties/note-room/room-note",
      role: "editor",
      expires_at: "2026-07-27T21:00:00.000Z",
    }));
  });

  afterEach(() => {
    closeAllNoteCollaborationSessions();
    vi.useRealTimers();
  });

  it("reuses a joined note session until the idle timeout closes it", async () => {
    const first = await acquireNoteCollaborationSession("space-1", "note-1");
    releaseNoteCollaborationSession("space-1", "note-1");

    await vi.advanceTimersByTimeAsync(noteCollaborationIdleMs - 1);
    const second = await acquireNoteCollaborationSession("space-1", "note-1");
    releaseNoteCollaborationSession("space-1", "note-1");

    expect(second).toBe(first);
    expect(spaceRequestMock).toHaveBeenCalledTimes(1);
    expect(providerDestroyMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(noteCollaborationIdleMs);
    expect(providerDestroyMock).toHaveBeenCalledTimes(1);

    const third = await acquireNoteCollaborationSession("space-1", "note-1");
    expect(third).not.toBe(first);
    expect(spaceRequestMock).toHaveBeenCalledTimes(2);
  });
});
