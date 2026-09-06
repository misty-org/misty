import type { Space } from "@/api/spaces/dto/interfaces/types";
import { describe, expect, it } from "vitest";
import {
  canManageSpaceLifecycle,
  preferredDefaultSpace,
  spaceNavigationName,
} from "./defaultSpace";

describe("default Space", () => {
  it("prefers the server-designated default without relying on its name or position", () => {
    const project = spaceFixture({ id: "project", name: "Misty", is_default: false });
    const home = spaceFixture({ id: "home", name: "Personal", is_default: true });
    const sharedDefault = spaceFixture({ id: "shared-home", is_default: true, role: "member" });

    expect(preferredDefaultSpace([project, sharedDefault, home])?.id).toBe("home");
  });

  it("falls back to the first available Space while a default is unavailable", () => {
    expect(preferredDefaultSpace([spaceFixture({ id: "shared" })])?.id).toBe("shared");
    expect(preferredDefaultSpace([])).toBeUndefined();
  });

  it("keeps the default Space renameable but not deletable or transferable", () => {
    const space = spaceFixture({ is_default: true });

    expect(canManageSpaceLifecycle(space, "rename")).toBe(true);
    expect(canManageSpaceLifecycle(space, "invite")).toBe(true);
    expect(canManageSpaceLifecycle(space, "delete")).toBe(false);
    expect(canManageSpaceLifecycle(space, "transfer")).toBe(false);
  });

  it("labels the default only in navigation presentation", () => {
    expect(spaceNavigationName(spaceFixture({ name: "Personal", is_default: true }))).toBe(
      "Personal (default)",
    );
    expect(spaceNavigationName(spaceFixture({ name: "Project", is_default: false }))).toBe(
      "Project",
    );
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    is_default: false,
    owner_user_id: "owner",
    name: "Space",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    permissions: {},
    created_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
    ...patch,
  };
}
