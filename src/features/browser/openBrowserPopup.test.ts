import { beforeEach, expect, it, vi } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { openBrowserPopup } from "./openBrowserPopup";
const resolveRuntime = vi.hoisted(() => vi.fn());
const activeRuntime = vi.hoisted(() => vi.fn());
vi.mock("./browserRuntime", () => ({
  browserTabIdForRuntime: resolveRuntime,
  browserRuntimeIdForTabId: activeRuntime,
}));
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  resolveRuntime.mockReset();
  activeRuntime.mockReset().mockReturnValue("native-source");
});
it("opens a downloaded Browser popup beside its source with the active Space route", () => {
  useWorkspaceStore.getState().setScope("space:family");
  const source = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
  resolveRuntime.mockReturnValue(source.id);
  const popup = openBrowserPopup({ sourceId: "native-source", url: "https://example.com/popup" });
  expect(popup).toMatchObject({
    surfaceId: "official-app",
    groupKey: "app:browser",
    route: source.route,
  });
  const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
    pane.tabs.some((tab) => tab.id === source.id),
  )!;
  expect(pane.tabs[pane.tabs.findIndex((tab) => tab.id === source.id) + 1].id).toBe(popup!.id);
  expect(pane.activeTabId).toBe(popup!.id);
});
it("ignores unknown, closed, other-Space and non-Browser sources", () => {
  expect(openBrowserPopup({ sourceId: "unknown", url: "https://example.com" })).toBeNull();
  const source = useWorkspaceStore.getState().openBrowserTab();
  resolveRuntime.mockReturnValue(source.id);
  useWorkspaceStore.getState().closeTab(source.id);
  expect(openBrowserPopup({ sourceId: "native-source", url: "https://example.com" })).toBeNull();
  const other = useWorkspaceStore.getState().openBrowserTab();
  resolveRuntime.mockReturnValue(other.id);
  useWorkspaceStore.getState().setScope("space:other");
  expect(openBrowserPopup({ sourceId: "native-source", url: "https://example.com" })).toBeNull();
  const home = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs[0];
  resolveRuntime.mockReturnValue(home.id);
  expect(openBrowserPopup({ sourceId: "native-source", url: "https://example.com" })).toBeNull();
});
it("rejects popup URLs that cannot be hosted by Browser", () => {
  resolveRuntime.mockReturnValue(useWorkspaceStore.getState().openBrowserTab().id);
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "misty-extension://localhost/app.js",
  ])
    expect(openBrowserPopup({ sourceId: "native-source", url })).toBeNull();
});

it("rejects an old native view after the same workspace tab replaces it", () => {
  resolveRuntime.mockReturnValue(useWorkspaceStore.getState().openBrowserTab().id);
  activeRuntime.mockReturnValue("replacement-native-view");
  expect(openBrowserPopup({ sourceId: "native-source", url: "https://example.com" })).toBeNull();
});
