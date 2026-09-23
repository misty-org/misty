import { beforeEach, describe, expect, it } from "vitest";
import { allLayoutViews, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import {
  addWebsite,
  createWebsiteGroup,
  openSavedWebsite,
  reorderWebsiteGroups,
  websiteAddress,
} from "./navigation";
import { workspaceChanges } from "./changes";
import { recordChanges } from "./recordChanges";
import {
  partialWorkspaceStore,
  migrateWorkspaceStore,
} from "@/features/workspace/workspaceStorePersistence";
const state = () => useWorkspaceStore.getState();
beforeEach(() => state().reset());
describe("website groups in a browser workspace", () => {
  it("accepts arbitrary website placement and keeps the launch URL after browsing", () => {
    const group = state().websiteGroups.find((group) => group.fields.label === "Social")!;
    const id = addWebsite(group.id, "Drive", "https://drive.google.com/");
    const opened = openSavedWebsite(id);
    expect(opened.surfaceId).toBe("browser");
    expect(parseBrowserTabState(opened.state).websiteId).toBe(id);
    state().updateBrowserTab(opened.id, { url: "https://drive.google.com/drive/folders/example" });
    const resumed = openSavedWebsite(id);
    expect(resumed.id).toBe(opened.id);
    expect(parseBrowserTabState(resumed.state).url).toContain("/folders/example");
    expect(state().savedWebsites.find((website) => website.id === id)?.fields.url).toBe(
      "https://drive.google.com/",
    );
    expect(openSavedWebsite(id, true).id).not.toBe(opened.id);
  });
  it("resumes within the current virtual window and opens a separate view in another", () => {
    const id = addWebsite(state().websiteGroups[0].id, "Example", "example.com");
    const first = openSavedWebsite(id);
    const firstWindow = state().activeVirtualWindowId;
    state().createVirtualWindow();
    const second = openSavedWebsite(id);
    expect(second.id).not.toBe(first.id);
    state().switchVirtualWindow(firstWindow);
    expect(openSavedWebsite(id).id).toBe(first.id);
  });
  it("captures the site identity with the tab creation, without a follow-up mutation", () => {
    const id = addWebsite(state().websiteGroups[0].id, "Example", "example.com");
    const before = state().virtualWindowsByScope.global!;
    const tab = openSavedWebsite(id);
    const changes = workspaceChanges(
      before,
      state().virtualWindowsByScope.global!,
      "a".repeat(64),
    ).changes;
    expect(changes).toContainEqual(
      expect.objectContaining({
        action: "create",
        kind: "tab",
        id: tab.id,
        fields: expect.objectContaining({
          website_id: id,
          surface: "browser",
          url: "https://example.com/",
        }),
      }),
    );
  });
  it("persists custom groups, pins, and local selection while excluding local focus from shared deltas", () => {
    const id = createWebsiteGroup("Research");
    addWebsite(id, "Papers", "papers.example");
    const before = [...state().websiteGroups, ...state().savedWebsites];
    useWorkspaceStore.setState({
      expandedWebsiteGroups: { [id]: false },
      selectedWebsiteByGroup: { [id]: "local-only" },
    });
    expect(recordChanges(before, [...state().websiteGroups, ...state().savedWebsites])).toEqual([]);
    const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(state())));
    const restored = migrateWorkspaceStore(saved, 13);
    expect(restored.websiteGroups).toEqual(state().websiteGroups);
    expect(restored.savedWebsites).toEqual(state().savedWebsites);
    expect(restored.expandedWebsiteGroups[id]).toBe(false);
    state().reset();
    expect(state().savedWebsites).toEqual([]);
  });
  it("rejects partial reorder lists rather than losing groups", () => {
    const before = state().websiteGroups;
    expect(() => reorderWebsiteGroups([before[0].id])).toThrow("changed");
    expect(state().websiteGroups).toBe(before);
    reorderWebsiteGroups([...before].reverse().map((group) => group.id));
    expect(state().websiteGroups[0].id).toBe(before[before.length - 1].id);
  });
  it("does not treat saved sites as scripts, search queries, or embedded credentials", () => {
    expect(websiteAddress("localhost:3000")).toBe("http://localhost:3000/");
    for (const value of [
      "javascript:alert(1)",
      "not a website",
      "https://user:password@example.com",
      "about:blank",
    ])
      expect(() => websiteAddress(value)).toThrow();
  });
  it("opens in a requested split pane without replacing its sibling or creating another layout", () => {
    const left = state().openBrowserTab({ url: "https://left.example" });
    const layout = state().layout.activeLayoutTabId;
    const rightPane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const right = state().openBrowserTab({ url: "https://right.example", paneId: rightPane });
    expect(state().layout.activeLayoutTabId).toBe(layout);
    expect(allLayoutViews(state().layout).map((tab) => tab.id)).toContain(left.id);
    expect(allLayoutViews(state().layout).map((tab) => tab.id)).toContain(right.id);
    expect(state().layout.root.type).toBe("split");
  });
});
