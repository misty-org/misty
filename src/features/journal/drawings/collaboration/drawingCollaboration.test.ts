import { ApiRequestError } from "@/api/client";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ collaborationTicket: vi.fn() }));
vi.mock("@/api/drawings/api", () => ({ drawingsApi: api }));
vi.mock("@/features/auth", () => ({ accountScopeResetEvent: "misty:test-account-reset" }));

import { acquireDrawingSession, closeDrawingCollaborationSession } from "./drawingCollaboration";

afterEach(() => closeDrawingCollaborationSession("space-1", "drawing-1"));

it("opens a read-only drawing when the server has collaboration off", async () => {
  api.collaborationTicket.mockRejectedValueOnce(
    new ApiRequestError("off", 503, "collaboration_off"),
  );
  const session = await acquireDrawingSession("space-1", "drawing-1");
  expect(session.localOnly).toBe(true);
  expect(session.role).toBe("viewer");
  expect(session.provider.synced).toBe(true);
  expect(session.provider.wsconnected).toBe(false);
});
