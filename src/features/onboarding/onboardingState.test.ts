import { beforeEach, describe, expect, it } from "vitest";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  accountNeedsOnboarding,
  clearAccountCreating,
  isAccountCreating,
  markAccountCreating,
  onboardingSpaceRoute,
} from "./onboardingState";

describe("onboarding state", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("only requires onboarding when the user is creating an account", () => {
    expect(accountNeedsOnboarding("account-1", true, [])).toBe(false);

    markAccountCreating("account-1");
    expect(isAccountCreating("account-1")).toBe(true);
    expect(accountNeedsOnboarding("account-1", true, [])).toBe(true);

    clearAccountCreating("account-1");
    expect(isAccountCreating("account-1")).toBe(false);
    expect(accountNeedsOnboarding("account-1", true, [])).toBe(false);
  });

  it("requires an owned server-designated default before entering the app shell when creating", () => {
    markAccountCreating("account-1");
    const sharedDefault = spaceFixture({
      id: "shared-default",
      is_default: true,
      owner_user_id: "someone-else",
      role: "member",
    });
    const ownDefault = spaceFixture({ id: "own-default", is_default: true });

    expect(accountNeedsOnboarding("account-1", false, [])).toBe(false);
    expect(accountNeedsOnboarding("account-1", true, [])).toBe(true);
    expect(accountNeedsOnboarding("account-1", true, [sharedDefault])).toBe(true);
    expect(accountNeedsOnboarding("account-1", true, [sharedDefault, ownDefault])).toBe(false);
  });

  it("opens the new Space and safely encodes its id", () => {
    expect(onboardingSpaceRoute("space / one")).toBe("/spaces/space%20%2F%20one");
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    is_default: false,
    owner_user_id: "account-1",
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
