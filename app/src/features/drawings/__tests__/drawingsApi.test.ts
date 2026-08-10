import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spaceRequest: vi.fn(),
}));

vi.mock("@/services/spaces/api", () => ({
  spaceRequest: mocks.spaceRequest,
}));

import { drawingsApi } from "../api/drawingsApi";

describe("drawingsApi", () => {
  beforeEach(() => mocks.spaceRequest.mockReset());

  it("addresses drawing resources beneath their Space", async () => {
    mocks.spaceRequest.mockResolvedValue({ drawings: [] });
    await drawingsApi.list("space/a");
    expect(mocks.spaceRequest).toHaveBeenCalledWith("/spaces/space%2Fa/drawings");

    mocks.spaceRequest.mockResolvedValue({ id: "drawing/1" });
    await drawingsApi.rename("space/a", "drawing/1", "Architecture");
    expect(mocks.spaceRequest).toHaveBeenLastCalledWith("/spaces/space%2Fa/drawings/drawing%2F1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Architecture" }),
    });
  });

  it("requests a fresh collaboration ticket for each connection", async () => {
    mocks.spaceRequest.mockResolvedValue({ ticket: "signed" });
    await drawingsApi.collaborationTicket("space-1", "drawing-1");
    expect(mocks.spaceRequest).toHaveBeenCalledWith(
      "/spaces/space-1/drawings/drawing-1/collaboration-ticket",
      { method: "POST" },
    );
  });
});
