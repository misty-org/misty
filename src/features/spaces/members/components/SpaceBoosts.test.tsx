import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../api/api", () => ({ spaceRequest: request }));

import { SpaceBoosts, spaceLevelLine } from "./SpaceBoosts";

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe("SpaceBoosts", () => {
  it("shows the level and a Boost button on a server with Space levels", async () => {
    request.mockResolvedValue({
      enabled: true,
      level: { level: 1, boosts: 3, next_level_boosts: 7 },
    });
    render(<SpaceBoosts spaceId="space_team" />);
    expect(await screen.findByText("Level 1 · 3 Boosts · 4 more for Level 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Boost" })).toBeTruthy();
    expect(request).toHaveBeenCalledWith("/spaces/space_team/boosts");
  });

  it("shows nothing on a self-hosted server, or when the server can't say", async () => {
    request.mockResolvedValue({ enabled: false });
    const { container } = render(<SpaceBoosts spaceId="space_self" />);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    cleanup();
    request.mockRejectedValue(new Error("offline"));
    const failed = render(<SpaceBoosts spaceId="space_self" />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(failed.container.innerHTML).toBe("");
  });

  it("words the top level without a next one", () => {
    expect(spaceLevelLine({ level: 3, boosts: 15, next_level_boosts: 0 })).toBe(
      "Level 3 · 15 Boosts",
    );
    expect(spaceLevelLine({ level: 0, boosts: 1, next_level_boosts: 2 })).toBe(
      "Base level · 1 Boost · 1 more for Level 1",
    );
  });
});
