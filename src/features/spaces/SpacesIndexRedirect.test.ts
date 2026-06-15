import type { Space } from "@/api/spaces/dto/interfaces/types";
import { describe, expect, it } from "vitest";
import { resolveSpacesLandingRoute } from "./spacesShell/SpacesIndexRedirect";
import { defaultSpaceRoute } from "./store/useSpacesTabsStore";

describe("Spaces landing route", () => {
  it("opens the designated default instead of the first listed Space", () => {
    const teamSpace = spaceFixture({ id: "team-space", name: "Family" });
    const homeSpace = spaceFixture({ id: "home-space", name: "Personal", is_default: true });

    expect(resolveSpacesLandingRoute([teamSpace, homeSpace])).toBe(defaultSpaceRoute("home-space"));
  });

  it("opens the first available Space while onboarding is finishing", () => {
    const space = spaceFixture({ id: "team-space" });

    expect(resolveSpacesLandingRoute([space])).toBe(defaultSpaceRoute("team-space"));
  });

  it("leaves an empty account on the first-Space screen", () => {
    expect(resolveSpacesLandingRoute([])).toBeNull();
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    is_default: false,
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
