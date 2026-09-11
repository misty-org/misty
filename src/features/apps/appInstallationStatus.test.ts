import { describe, expect, it } from "vitest";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { officialAppNeedsReview } from "./appInstallationStatus";

const app = {
  id: "journal",
  version: "1.1.0",
  permission_version: 2,
} as OfficialApp;

function installation(overrides: Partial<SpaceAppInstallation> = {}): SpaceAppInstallation {
  return {
    app_id: "journal",
    state: "installed",
    space_id: "space-a",
    authority_generation: 1,
    installed_version: "1.1.0",
    permission_version: 2,
    granted_scopes: [],
    pinned: true,
    pin_rank: 1,
    installed_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

describe("officialAppNeedsReview", () => {
  it("requires review for a new package version", () => {
    expect(
      officialAppNeedsReview(
        app,
        installation({ space_id: "space-a", authority_generation: 1, installed_version: "1.0.0" }),
      ),
    ).toBe(true);
  });

  it("requires review when declared permissions change", () => {
    expect(officialAppNeedsReview(app, installation({ permission_version: 1 }))).toBe(true);
  });

  it("does not require review when the accepted release is current", () => {
    expect(officialAppNeedsReview(app, installation())).toBe(false);
  });
});
