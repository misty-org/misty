import { describe, expect, it } from "vitest";
import { resolveSpacesLandingRoute } from "@/features/spaces/spacesShell/SpacesIndexRedirect";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { defaultSpaceRoute } from "@/stores/spaces/useSpacesTabsStore";

describe("Spaces landing route", () => {
  it("keeps a remembered Space route when the Misty guide Space is unavailable", () => {
    const space = spaceFixture({ id: "team-space" });

    expect(resolveSpacesLandingRoute([space], "/spaces/team-space/planner/tasks/board")).toBe(
      "/spaces/team-space/planner/tasks/board",
    );
  });

  it("opens the first available Space while Misty provisioning catches up", () => {
    const space = spaceFixture({ id: "team-space" });

    expect(resolveSpacesLandingRoute([space], "/spaces/missing/chat")).toBe(
      defaultSpaceRoute("team-space"),
    );
  });

  it("prefers the permanent Misty guide Space when there is no usable memory", () => {
    const teamSpace = spaceFixture({ id: "team-space" });
    const mistySpace = spaceFixture({ id: "misty", kind: "misty" });

    expect(resolveSpacesLandingRoute([teamSpace, mistySpace], "")).toBe(defaultSpaceRoute("misty"));
  });

  it("leaves an empty account on the first-Space screen", () => {
    expect(resolveSpacesLandingRoute([], "")).toBeNull();
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    owner_user_id: "owner",
    name: "Design team",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: true,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    ...patch,
  };
}
