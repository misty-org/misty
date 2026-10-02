import { beforeEach, describe, expect, it } from "vitest";
import { parseBrowserViewState } from "@/features/workspace/model";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

describe("browser profile identity", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("keeps the synced profile and launch website when the webview navigates", () => {
    const tab = useWorkspaceStore.getState().openBrowserView({ url: "https://example.test" });
    useWorkspaceStore.getState().updateBrowserView(tab.id, {
      profileId: "a".repeat(64),
      bookmarkId: "website:one",
      agentOwned: true,
    });
    useWorkspaceStore.getState().updateBrowserView(tab.id, {
      url: "https://example.test/next",
      title: "Next page",
    });
    const current = allLayoutViews(useWorkspaceStore.getState().layout).find(
      (view) => view.id === tab.id,
    )!;
    expect(parseBrowserViewState(current.state)).toMatchObject({
      url: "https://example.test/next",
      profileId: "a".repeat(64),
      bookmarkId: "website:one",
      agentOwned: true,
    });
  });

  it("does not accept malformed profile identifiers from old persisted tab state", () => {
    expect(
      parseBrowserViewState({ profileId: "../other-profile", bookmarkId: "../website" }),
    ).toMatchObject({
      profileId: undefined,
      bookmarkId: undefined,
    });
  });

  it("reads legacy bookmark identities and prefers the current field when both exist", () => {
    expect(parseBrowserViewState({ websiteId: "website:old" }).bookmarkId).toBe("website:old");
    expect(
      parseBrowserViewState({ websiteId: "website:old", bookmarkId: "bookmark:new" }).bookmarkId,
    ).toBe("bookmark:new");
    expect(parseBrowserViewState({ websiteId: "../website" }).bookmarkId).toBeUndefined();
  });
});
