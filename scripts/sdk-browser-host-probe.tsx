/** Native signed-package + actual host UI check. Account/installation API replies are fixtures. */
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { appsApi, type OfficialApp, type UserAppInstallation } from "../src/api/apps/api";
import { spacesApi } from "../src/api/spaces/api";
import {
  configureOfficialAppRuntimeApiBase,
  deploymentStorageKey,
} from "../src/api/deployment/api";
import { OfficialAppAuthProvider } from "../src/features/auth/AuthContext";
import { useAppsStore } from "../src/features/apps/useAppsStore";
import { useSpacesStore } from "../src/features/spaces/core";
import { useWorkspaceStore } from "../src/features/workspace/useWorkspaceStore";
import { dockLeaves, dockTabs } from "../src/features/workspace/dockTree";
import { workspaceSurfaceFromRoute } from "../src/features/workspace/routeSurface";
import { configureBrowserHomeUrl } from "../src/features/workspace/browserHome";
import { GlobalNavigator } from "../src/application/layouts/DesktopLayout/GlobalNavigator";
import { WorkspaceCanvas } from "../src/application/layouts/DesktopLayout/WorkspaceCanvas";
import { BrowserRuntimeBridge } from "../src/features/browser/BrowserRuntimeBridge";
import { TooltipProvider } from "../src/shared/ui";
import { officialDesktopPackageReady } from "../src/features/apps/desktopPackages";

const params = new URLSearchParams(location.search);
const nonce = params.get("nonce")!;
const catalog = await fetch(params.get("catalog")!).then((response) => response.json());
const app: OfficialApp = catalog.apps.find((app: OfficialApp) => app.id === "browser");
if (app?.desktop.runtime !== "downloaded") throw new Error("Browser candidate is unavailable");
const user = { id: `sdk-host-${nonce}`, name: "SDK verification", email: "sdk@example.invalid" };
const space = {
  id: "sdk-space",
  name: "SDK verification",
  owner_user_id: user.id,
  role: "owner" as const,
  member_count: 1,
  pending_count: 0,
  is_shared: false,
  is_default: true,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
};
configureOfficialAppRuntimeApiBase(location.origin);
configureBrowserHomeUrl(location.origin + "/scripts/sdk-browser-page.html");
localStorage.setItem(
  deploymentStorageKey("misty:account-sessions"),
  JSON.stringify([{ ...user, lastUsedAt: new Date().toISOString() }]),
);
localStorage.setItem(deploymentStorageKey("misty:active-account-id"), user.id);
let installation: UserAppInstallation | null = null;
const apiCalls: string[] = [];
spacesApi.snapshot = async () => ({
  spaces: [space],
  invitations: [],
  entitlements: { space_limit: 1, unlimited_spaces: false, unlimited_collaborators: false },
  owner_storage: {
    used_bytes: 0,
    reserved_bytes: 0,
    limit_bytes: 1000000,
    remaining_bytes: 1000000,
    spaces: [],
  },
});
appsApi.catalog = async () => catalog;
appsApi.installations = async () => ({ apps: installation ? [installation] : [] });
appsApi.install = async (id, permissionVersion) => {
  if (id !== app.id || permissionVersion !== app.permission_version)
    throw new Error("Invalid install contract");
  apiCalls.push("install");
  return (installation = {
    app_id: id,
    state: "installed",
    installed_version: app.version,
    permission_version: permissionVersion,
    granted_scopes: app.scopes,
    pinned: true,
    pin_rank: 0,
    installed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
};
appsApi.uninstall = async (id) => {
  if (id !== app.id || !installation) throw new Error("Invalid uninstall contract");
  apiCalls.push("uninstall");
  return (installation = {
    ...installation,
    state: "recoverable",
    pinned: false,
    uninstalled_at: new Date().toISOString(),
  });
};
appsApi.createSession = async (id, spaceId) => {
  if (id !== app.id || installation?.state !== "installed" || spaceId !== space.id)
    throw new Error(
      "Invalid session contract: " +
        JSON.stringify({
          id,
          spaceId,
          state: installation?.state,
          spaces: useSpacesStore.getState().spaces.map((item) => item.id),
        }),
    );
  apiCalls.push("session");
  return {
    app_id: id,
    space_id: spaceId,
    token: "disposable-sdk-session",
    scopes: app.scopes,
    expires_at: new Date(Date.now() + 120000).toISOString(),
    sdk_base_url: location.origin,
  };
};
useAppsStore.setState({
  accountId: user.id,
  catalog: [app],
  installations: [],
  ready: true,
  loading: false,
  error: "",
});
useSpacesStore.setState({ spaces: [space], snapshotReady: true, loading: false, error: null });
useWorkspaceStore.getState().reset();
useWorkspaceStore.getState().setScope(`space:${space.id}`);
const discover = useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/discover")!);
function Host() {
  const route = useLocation();
  const profileRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const request = workspaceSurfaceFromRoute(`${route.pathname}${route.search}${route.hash}`);
    if (request) useWorkspaceStore.getState().openSurface(request);
  }, [route.pathname, route.search, route.hash]);
  return (
    <TooltipProvider>
      <BrowserRuntimeBridge />
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        <aside style={{ width: 230, flexShrink: 0 }}>
          <GlobalNavigator
            profileAnchorRef={profileRef}
            profileOpen={false}
            settingsOpen={false}
            onProfileClick={() => {}}
            onSettingsClick={() => {}}
          />
        </aside>
        <main style={{ flex: 1, minWidth: 0, height: "100%" }}>
          <WorkspaceCanvas />
        </main>
      </div>
    </TooltipProvider>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <MemoryRouter initialEntries={["/discover"]}>
    <OfficialAppAuthProvider user={user}>
      <Host />
    </OfficialAppAuthProvider>
  </MemoryRouter>,
);
const count = () => invoke<number>("sdk_probe_browser_count", { nonce });
const tabs = () => dockTabs(useWorkspaceStore.getState().layout.root);
const browserTabs = () => tabs().filter((tab) => tab.groupKey === "app:browser");
const until = async (check: () => boolean | Promise<boolean>, reason: string) => {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    const error = useAppsStore.getState().error;
    if (error) throw new Error(error);
    if (Date.now() > deadline)
      throw new Error(reason + " | " + document.body.textContent?.slice(-1400));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
function button(name: string, parent: ParentNode = document) {
  return [...parent.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name,
  );
}
let stage = "Discover install",
  success = false,
  message = "";
try {
  await until(() => !!button("Add Browser"), "Discover did not offer Browser installation");
  button("Add Browser")!.click();
  await until(() => !!button("Add to Misty"), "Discover did not show its install review");
  button("Add to Misty")!.click();
  await until(
    () => installation?.state === "installed" && !useAppsStore.getState().actionAppId,
    "Discover installation did not finish",
  );
  if (!(await officialDesktopPackageReady(app)))
    throw new Error("Discover did not install a verified package");
  await until(
    () => !!document.querySelector('nav[aria-label="Primary"] a[href^="/apps/browser"]'),
    "Installed Browser did not appear in the navbar",
  );
  button("Cancel", document.querySelector('[role="dialog"]')!)!.click();
  stage = "navbar open";
  document
    .querySelector<HTMLAnchorElement>('nav[aria-label="Primary"] a[href^="/apps/browser"]')!
    .click();
  await until(
    async () =>
      (await count()) === 1 && browserTabs().some((tab) => tab.title === "SDK browser fixture"),
    "Navbar did not open the downloaded component through the host",
  );
  stage = "split panel";
  const original = browserTabs()[0];
  const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
    pane.tabs.some((tab) => tab.id === original.id),
  )!;
  const second = useWorkspaceStore
    .getState()
    .openBrowserTab({
      url: location.origin + "/scripts/sdk-browser-page.html?panel=1",
      sourceTabId: original.id,
    });
  if (!useWorkspaceStore.getState().splitPane(pane.id, "right", second.id))
    throw new Error("Host refused a second panel");
  await until(
    async () =>
      dockLeaves(useWorkspaceStore.getState().layout.root).length === 2 &&
      (await count()) === 2 &&
      browserTabs().every((tab) => tab.title === "SDK browser fixture"),
    "Two downloaded Browser panels did not render",
  );
  stage = "close panels";
  useWorkspaceStore.getState().closeTab(second.id);
  useWorkspaceStore.getState().focusTab(original.id);
  await until(async () => (await count()) === 1, "Closing a panel left its native child");
  useWorkspaceStore.getState().closeTab(original.id);
  useWorkspaceStore.getState().focusTab(discover.id);
  await until(async () => (await count()) === 0, "Closing Browser left a native child");
  stage = "Discover remove";
  await until(() => !!button("View Browser details"), "Discover did not return");
  button("View Browser details")!.click();
  await until(() => !!button("Remove app"), "Discover details did not offer removal");
  button("Remove app")!.click();
  await until(
    () => !!document.querySelector('[role="alertdialog"]'),
    "Removal confirmation did not open",
  );
  const dialog = document.querySelector('[role="alertdialog"]')!;
  const confirm = button("Remove App", dialog) ?? button("Remove", dialog);
  if (!confirm) throw new Error("Removal confirmation action missing");
  confirm.click();
  await until(
    () => installation?.state === "recoverable" && !useAppsStore.getState().actionAppId,
    "Discover removal did not finish",
  );
  if (await officialDesktopPackageReady(app)) throw new Error("Uninstall left a verified package");
  if (document.querySelector('nav[aria-label="Primary"] a[href^="/apps/browser"]'))
    throw new Error("Removed Browser remains in navbar");
  if (
    !apiCalls.includes("install") ||
    !apiCalls.includes("session") ||
    !apiCalls.includes("uninstall")
  )
    throw new Error("Host skipped the installation/session contracts");
  success = true;
  message =
    "PASS: actual Discover install, verified native package, navbar appearance/open, normal OfficialAppRuntimePage/DownloadedAppSurface, two workspace panels with native Browser children, panel/tab cleanup, Discover confirmed removal and navbar/package cleanup. Account and installation API replies are fixtures; no real account was changed.";
} catch (error) {
  message = `${stage}: ${String(error)}`;
} finally {
  root.unmount();
}
document.getElementById("result")!.textContent = message;
await invoke("sdk_probe_complete", { nonce, success, message });
