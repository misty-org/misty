import { dockLeaves } from "@/features/workspace/dockTree";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { allLayoutViews, activeLayoutView } from "@/features/workspace/layoutTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { openBrowserPopup } from "./openBrowserPopup";
import { registerProviderBrowser, popupBrowserProfile } from "./browserProviders";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
const nativeNavigate = vi.hoisted(() => vi.fn(async () => {}));
const setError = vi.hoisted(() => vi.fn());
const external = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeNavigate }));
vi.mock("@/shared/platform/openExternalLink", () => ({
  openSystemExternalLink: external,
}));
const resolveRuntime = vi.hoisted(() => vi.fn());
const activeRuntime = vi.hoisted(() => vi.fn());
vi.mock("./browserRuntime", () => ({
  browserTabIdForRuntime: resolveRuntime,
  browserRuntimeIdForTabId: activeRuntime,
  useBrowserRuntimeStore: { getState: () => ({ setError }) },
}));
const releases: Array<() => void> = [];
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  nativeNavigate.mockClear();
  external.mockClear();
  setError.mockClear();
});
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  resolveRuntime.mockReset();
  activeRuntime.mockReset().mockReturnValue("native-source");
});
it("opens a downloaded Browser popup beside its source with the active Space route", () => {
  useWorkspaceStore.getState().setScope("space:family");
  const source = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
  resolveRuntime.mockReturnValue(source.id);
  const popup = openBrowserPopup({
    sourceId: "native-source",
    url: "https://example.com/popup",
  });
  expect(popup).toMatchObject({
    surfaceId: "official-app",
    groupKey: "app:browser",
    route: source.route,
  });
  const layout = useWorkspaceStore.getState().layout;
  const views = allLayoutViews(layout);
  expect(views[views.findIndex((tab) => tab.id === source.id) + 1].id).toBe(popup!.id);
  expect(activeLayoutView(layout)?.id).toBe(popup!.id);
});
it("ignores unknown, closed, other-Space and unregistered sources", () => {
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
  activeRuntime.mockReturnValue(undefined);
  expect(openBrowserPopup({ sourceId: "native-source", url: "https://example.com" })).toBeNull();
});
it("accepts an App's registered embedded browser without requiring a provider classification", () => {
  const source = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/apps/journal")!);
  resolveRuntime.mockReturnValue(source.id);
  const popup = openBrowserPopup({
    sourceId: "native-source",
    url: "https://tenant.identity.example/login",
    popupInstanceKey: "real-popup",
  });
  expect(popup?.groupKey).toBe("app:browser");
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

function instagramSource() {
  const source = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/apps/social?provider=instagram")!);
  resolveRuntime.mockReturnValue(source.id);
  releases.push(
    registerProviderBrowser("native-source", {
      ownerAppId: "chat",
      ownerAccountId: "user",
      serverBase: "https://api.example",
      profileId: "a".repeat(64),
      provider: { id: "instagram", accountId: "work" },
    }),
  );
  return source;
}
it.each(["https://example.net/article", "https://www.facebook.com/login.php?next=instagram"])(
  "opens integration links in Browser with the source account: %s",
  (url) => {
    instagramSource();
    const popup = openBrowserPopup({ sourceId: "native-source", url })!;
    expect(popup.groupKey).toBe("app:browser");
    expect(popupBrowserProfile(popup.id)).toMatchObject({
      provider: { id: "instagram", accountId: "work" },
      url,
    });
    expect(nativeNavigate).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  },
);
it.each(["https://www.facebook.com/dialog/oauth", "about:blank"])(
  "adopts a real Instagram sign-in popup into Browser with the originating account: %s",
  (url) => {
    instagramSource();
    const popup = openBrowserPopup({
      sourceId: "native-source",
      url,
      popupInstanceKey: "popup-auth",
    })!;
    expect(popup.groupKey).toBe("app:browser");
    expect(popupBrowserProfile(popup.id)).toMatchObject({
      ownerAppId: "chat",
      provider: { id: "instagram", accountId: "work" },
      popupInstanceKey: "popup-auth",
      url,
    });
    expect(
      dockLeaves(useWorkspaceStore.getState().layout.root)
        .flatMap((pane) => pane.tabs)
        .some((tab) => tab.groupKey === "app:browser"),
    ).toBe(true);
  },
);
it("opens out-of-provider links as ordinary Browser pages without native privileges", () => {
  instagramSource();
  const popup = openBrowserPopup({
    sourceId: "native-source",
    url: "https://example.org/linked-page",
  })!;
  expect(popup.groupKey).toBe("app:browser");
  expect(external).not.toHaveBeenCalled();
  expect(setError).not.toHaveBeenCalled();
  expect(nativeNavigate).not.toHaveBeenCalled();
});

it("ignores blank setup frames instead of passing about:blank to the external URL validator", () => {
  instagramSource();
  expect(openBrowserPopup({ sourceId: "native-source", url: "about:blank" })).toBeNull();
  expect(external).not.toHaveBeenCalled();
  expect(nativeNavigate).not.toHaveBeenCalled();
  expect(setError).not.toHaveBeenCalled();
});
