import { beforeEach, describe, expect, it } from "vitest";
import { parseBrowserTabState } from "@/features/workspace/model";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

describe("browser profile identity", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("keeps the synced profile and launch website when the webview navigates", () => {
    const tab = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.test" });
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      profileId: "a".repeat(64),
      websiteId: "website:one",
      agentOwned: true,
    });
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      url: "https://example.test/next",
      title: "Next page",
    });
    const current = allLayoutViews(useWorkspaceStore.getState().layout).find(
      (view) => view.id === tab.id,
    )!;
    expect(parseBrowserTabState(current.state)).toMatchObject({
      url: "https://example.test/next",
      profileId: "a".repeat(64),
      websiteId: "website:one",
      agentOwned: true,
    });
  });

  it("does not accept malformed profile identifiers from old persisted tab state", () => {
    expect(
      parseBrowserTabState({ profileId: "../other-profile", websiteId: "../website" }),
    ).toMatchObject({
      profileId: undefined,
      websiteId: undefined,
    });
  });
});
