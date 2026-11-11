import { describe, expect, it } from "vitest";
import { parseBrowserViewState } from "@/features/app-windows/tabs/workspaceViews";

describe("browser profile identity", () => {
  it("does not accept malformed bookmark identities from old persisted tab state", () => {
    expect(parseBrowserViewState({ bookmarkId: "../website" }).bookmarkId).toBeUndefined();
  });

  it("reads legacy bookmark identities and prefers the current field when both exist", () => {
    expect(parseBrowserViewState({ websiteId: "website:old" }).bookmarkId).toBe("website:old");
    expect(
      parseBrowserViewState({ websiteId: "website:old", bookmarkId: "bookmark:new" }).bookmarkId,
    ).toBe("bookmark:new");
    expect(parseBrowserViewState({ websiteId: "../website" }).bookmarkId).toBeUndefined();
  });
});
