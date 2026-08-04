import { describe, expect, it } from "vitest";
import { resolveSpacesLandingRoute } from "@/features/spaces/spacesShell/SpacesIndexRedirect";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { defaultSpaceRoute } from "@/stores/spaces/useSpacesTabsStore";

describe("Spaces landing route", () => {
  it("opens Misty instead of a previously remembered Space", () => {
    const teamSpace = spaceFixture({ id: "team-space", name: "Family" });
    const mistySpace = spaceFixture({ id: "misty-space", name: "Misty" });

    expect(resolveSpacesLandingRoute([teamSpace, mistySpace])).toBe(
      defaultSpaceRoute("misty-space"),
    );
  });

  it("opens the first available Space while Misty provisioning catches up", () => {
    const space = spaceFixture({ id: "team-space" });

    expect(resolveSpacesLandingRoute([space])).toBe(defaultSpaceRoute("team-space"));
  });

  it("uses Misty when there is no active or remembered Space", () => {
    const teamSpace = spaceFixture({ id: "team-space" });
    const mistySpace = spaceFixture({ id: "misty", kind: "standard" });

    expect(resolveSpacesLandingRoute([teamSpace, mistySpace])).toBe(defaultSpaceRoute("misty"));
  });

  it("recognizes the Misty home Space even when its id is server-generated", () => {
    const teamSpace = spaceFixture({ id: "team-space", name: "Family" });
    const mistySpace = spaceFixture({ id: "space-home", name: "Misty" });

    expect(resolveSpacesLandingRoute([teamSpace, mistySpace])).toBe(
      defaultSpaceRoute("space-home"),
    );
  });

  it("leaves an empty account on the first-Space screen", () => {
    expect(resolveSpacesLandingRoute([])).toBeNull();
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
