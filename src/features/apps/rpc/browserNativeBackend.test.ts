import { mistyBrowserProviders, type MistyBrowserProvider } from "@misty/sdk";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { createAppRpcScope } from "./session";
import { createAppUiBackend } from "./appUiBackend";
import { popupBrowserProfile } from "@/features/browser/browserProviders";
import { createBrowserRpcBackend, providerOAuthCallback } from "./browserBackend";
import { useAppsStore } from "../useAppsStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { openBrowserPopup } from "@/features/browser/openBrowserPopup";
import { browserRuntimeIdForTabId } from "@/features/browser/browserRuntime";
const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async (command) =>
    command === "browser_webview_reconcile" ? true : undefined,
  ),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  useWorkspaceStore.getState().reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  invoke.mockReset();
  document.body.innerHTML = "";
});
async function fixture(
  appId: "browser" | "chat" | "inbox" | "journal" | "planner" = "browser",
  socialProvider: MistyBrowserProvider["id"] = "instagram",
) {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  invoke.mockImplementation(async (command) =>
    ["browser_webview_reconcile", "browser_profile_persistence"].includes(command)
      ? true
      : undefined,
  );
  const root = document.createElement("div");
  document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 50, 500, 300));
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute(`/apps/${appId === "chat" ? "social" : appId}`)!);
  const scope = createAppRpcScope({
    identity: { appId, accountId: "fixture", instanceId: tab.id },
    scopes: ["browser.navigate", "browser.inspect", "browser.interact"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const backend = createBrowserRpcBackend(scope, root, "https://example.com/api");
  const id = `sdk-${crypto.randomUUID()}`,
    scopeId = crypto.randomUUID();
  const providerId =
    appId === "journal"
      ? "google-docs"
      : appId === "planner"
        ? "jira"
        : appId === "inbox"
          ? socialProvider === "microsoft"
            ? "microsoft"
            : "google"
          : socialProvider;
  await backend.create({
    id,
    scopeId,
    url:
      appId === "browser"
        ? "https://example.com"
        : providerId === "jira"
          ? "https://team.atlassian.net/jira/your-work"
          : mistyBrowserProviders[providerId].url,
    ...(appId === "browser" ? {} : { provider: { id: providerId, accountId: "personal" } }),
    bounds: { x: 0, y: 50, width: 500, height: 300 },
    nativeLiveResize: false,
  });
  cleanups.push(async () => {
    scope.close();
    await backend.close(id);
  });
  return { backend, id, scopeId, scope, root };
}
it.each([
  ["microsoft", "https://login.microsoftonline.com/common/oauth2/authorize"],
  ["microsoft", "https://tenant.identity.example/sign-in"],
  ["instagram", "https://www.facebook.com/login.php"],
  ["x", "https://accounts.google.com/v3/signin/identifier"],
  ["x", "https://appleid.apple.com/auth/authorize"],
] as const)(
  "adopts the original %s authentication popup with the source account: %s",
  async (provider, url) => {
    const source = await fixture(provider === "microsoft" ? "inbox" : "chat", provider);
    const sourceRequest = invoke.mock.calls.find(
      ([command]) => command === "browser_webview_create",
    )![1] as { request: { profileId: string } };
    const popup = openBrowserPopup({
      sourceId: browserRuntimeIdForTabId(source.scope.identity.instanceId)!,
      url,
      popupInstanceKey: "popup-auth-test",
    })!;
    const scope = createAppRpcScope({
      identity: { appId: "browser", accountId: "fixture", instanceId: popup.id },
      scopes: ["browser.navigate"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const backend = createBrowserRpcBackend(scope, source.root, "https://example.com/api");
    await backend.create({
      id: "sdk-popup",
      scopeId: "popup-scope",
      provider: { id: provider, accountId: "personal" },
      url: mistyBrowserProviders[provider].url,
      bounds: { x: 0, y: 50, width: 500, height: 300 },
      nativeLiveResize: false,
    });
    cleanups.push(async () => {
      scope.close();
      await backend.close("sdk-popup");
    });
    expect(invoke).toHaveBeenCalledWith("browser_webview_create", {
      request: expect.objectContaining({
        id: "tab-popup-auth-test",
        url,
        profileId: sourceRequest.request.profileId,
        profileProviderId: provider,
      }),
    });
    await backend.navigate("sdk-popup", "https://tenant.identity.example/continue");
    expect(invoke).toHaveBeenCalledWith("browser_webview_navigate", {
      request: { id: "tab-popup-auth-test", url: "https://tenant.identity.example/continue" },
    });
    expect(popup.groupKey).toBe("app:browser");
  },
);
it.each(["chat", "inbox", "journal", "planner"] as const)(
  "opens an app-owned %s website with Browser absent from the catalog and installations",
  async (appId) => {
    const previous = useAppsStore.getState();
    useAppsStore.setState({ accountId: "fixture", catalog: [], installations: [] });
    try {
      const f = await fixture(appId);
      await expect(f.backend.availability!()).resolves.toMatchObject({
        available: true,
        persistent: true,
      });
      const tabs = dockLeaves(useWorkspaceStore.getState().layout.root).flatMap(
        (pane) => pane.tabs,
      );
      expect(tabs.some((tab) => tab.groupKey === "app:browser")).toBe(false);
      expect(tabs.find((tab) => tab.id === f.scope.identity.instanceId)?.groupKey).toBe(
        `app:${appId}`,
      );
      const created = invoke.mock.calls.find(([command]) => command === "browser_webview_create");
      expect(created).toBeDefined();
      expect(created![1]).toMatchObject({
        request: {
          providerId:
            appId === "chat"
              ? "instagram"
              : appId === "journal"
                ? "google-docs"
                : appId === "planner"
                  ? "jira"
                  : "google",
        },
      });
    } finally {
      useAppsStore.setState({
        accountId: previous.accountId,
        catalog: previous.catalog,
        installations: previous.installations,
      });
    }
  },
);
it("issues private short-lived native grants and revokes them even when inspection fails", async () => {
  const f = await fixture();
  invoke.mockImplementation(async (command) => {
    if (command === "browser_agent_execute") throw new Error("Page unavailable");
    return command === "browser_webview_reconcile" ? true : undefined;
  });
  await expect(f.backend.inspect(f.id)).rejects.toThrow("Page unavailable");
  const grant = (
    invoke.mock.calls.find(([command]) => command === "browser_agent_grant_register")![1] as {
      request: {
        grantId: string;
        scopeId: string;
        id: string;
        capabilities: string[];
        expiresAt: string;
      };
    }
  ).request;
  expect(grant.scopeId).toBe(f.scopeId);
  expect(grant.capabilities).toEqual(["browser.inspect"]);
  expect(Date.parse(grant.expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);
  expect(invoke).toHaveBeenCalledWith("browser_agent_grant_revoke", {
    request: { id: grant.id, grantId: grant.grantId },
  });
});
it("does not execute a native action if the account closes during grant registration", async () => {
  const f = await fixture();
  let finish!: () => void;
  invoke.mockImplementation(async (command) => {
    if (command === "browser_agent_grant_register")
      await new Promise<void>((done) => {
        finish = done;
      });
    return undefined;
  });
  const action = f.backend.click(f.id, "element-1");
  const rejected = expect(action).rejects.toMatchObject({ code: "app_closed" });
  await vi.waitFor(() =>
    expect(invoke.mock.calls.some(([command]) => command === "browser_agent_grant_register")).toBe(
      true,
    ),
  );
  f.scope.close();
  finish();
  await rejected;
  expect(invoke.mock.calls.some(([command]) => command === "browser_agent_execute")).toBe(false);
  expect(invoke.mock.calls.some(([command]) => command === "browser_agent_grant_revoke")).toBe(
    true,
  );
});
it("releases only the closing view's overlay reasons", async () => {
  const a = await fixture(),
    b = await fixture();
  await a.backend.overlay(a.id, "menu", true);
  await b.backend.overlay(b.id, "menu", true);
  await a.backend.close(a.id);
  expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(true);
  await b.backend.close(b.id);
  await vi.waitFor(() =>
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false),
  );
});

it("navigates Inbox consent in its existing native view with an exact deployment callback", async () => {
  const f = await fixture("inbox");
  const callback = "https://example.com/api/oauth/connections/google/callback";
  const url = `https://accounts.google.com/o/oauth2/v2/auth?state=fixture&redirect_uri=${encodeURIComponent(callback)}`;
  await f.backend.navigate(f.id, url);
  expect(invoke).toHaveBeenCalledWith("browser_webview_navigate", {
    request: {
      id: browserRuntimeIdForTabId(f.scope.identity.instanceId),
      url,
      oauthCallback: { url: callback, state: "fixture" },
    },
  });
  await expect(f.backend.navigate(f.id, "https://example.net/")).rejects.toThrow(
    "outside the current provider",
  );
});
it.each([
  "https://elsewhere.example/oauth/connections/google/callback",
  "https://example.com/api/oauth/connections/microsoft/callback",
  "https://example.com/api/unrelated",
  "http://example.com/api/oauth/connections/google/callback",
  "https://example.com/api/oauth/connections/google/callback?redirect=evil",
])("rejects a consent callback outside its exact deployment and provider: %s", (callback) => {
  expect(() =>
    providerOAuthCallback(
      "google",
      `https://accounts.google.com/o/oauth2/v2/auth?state=fixture&redirect_uri=${encodeURIComponent(callback)}`,
      "https://example.com/api",
    ),
  ).toThrow();
});
it.each(["journal", "planner"] as const)(
  "preserves the originating %s account in its authentication popup",
  async (appId) => {
    const source = await fixture(appId);
    const provider = appId === "journal" ? "google-docs" : "jira";
    const url =
      appId === "journal"
        ? "https://accounts.google.com/ServiceLogin"
        : "https://id.atlassian.com/login";
    const popup = openBrowserPopup({
      sourceId: browserRuntimeIdForTabId(source.scope.identity.instanceId)!,
      url,
      popupInstanceKey: "productivity-auth",
    })!;
    expect(popup.groupKey).toBe("app:browser");
    const scope = createAppRpcScope({
      identity: { appId: "browser", accountId: "fixture", instanceId: popup.id },
      scopes: ["browser.navigate"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const backend = createBrowserRpcBackend(scope, source.root, "https://example.com/api");
    await backend.create({
      id: "productivity-popup",
      scopeId: "popup-scope",
      provider: { id: provider, accountId: "personal" },
      url: mistyBrowserProviders[provider].url,
      bounds: { x: 0, y: 50, width: 500, height: 300 },
      nativeLiveResize: false,
    });
    expect(invoke).toHaveBeenCalledWith("browser_webview_create", {
      request: expect.objectContaining({
        id: "tab-productivity-auth",
        url,
        profileProviderId: provider,
      }),
    });
    cleanups.push(async () => {
      scope.close();
      await backend.close("productivity-popup");
    });
  },
);
it("scopes cleanup to an owning app's derived profile and closes its live views", async () => {
  const f = await fixture("journal");
  await expect(
    f.backend.removeAccount!({ id: "google-calendar", accountId: "personal" }),
  ).rejects.toMatchObject({ code: "provider_denied" });
  expect(invoke.mock.calls.some(([command]) => command === "browser_profile_remove")).toBe(false);
  const create = invoke.mock.calls.find(
    ([command]) => command === "browser_webview_create",
  )![1] as { request: { profileId: string } };
  await f.backend.removeAccount!({ id: "google-docs", accountId: "personal" });
  expect(invoke).toHaveBeenCalledWith("browser_profile_remove", {
    profileId: create.request.profileId,
  });
  await expect(f.backend.navigate(f.id, "https://docs.google.com/document/")).rejects.toMatchObject(
    { code: "resource_denied" },
  );
});

it("targets page zoom at the owned native view without changing host layout", async () => {
  const { backend, id } = await fixture();
  invoke.mockClear();
  await backend.setZoom!(id, 1.25);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_webview_set_zoom", {
    request: { id: expect.stringContaining(id), factor: 1.25 },
  });
  await expect(backend.setZoom!("another-view", 1.5)).rejects.toMatchObject({
    code: "resource_denied",
  });
});

it("keeps the Outlook account when its SDK Open in browser action opens a Browser tab", async () => {
  const source = await fixture("inbox", "microsoft");
  await createAppUiBackend(source.scope).openExternal(
    "https://login.microsoftonline.com/common/oauth2/authorize",
  );
  const tabs = dockLeaves(useWorkspaceStore.getState().layout.root).flatMap((pane) => pane.tabs);
  const popup = tabs.find((tab) => tab.groupKey === "app:browser")!;
  expect(popup).toBeDefined();
  expect(popupBrowserProfile(popup.id)).toMatchObject({
    provider: { id: "microsoft", accountId: "personal" },
    ownerAccountId: "fixture",
    url: "https://login.microsoftonline.com/common/oauth2/authorize",
  });
});
