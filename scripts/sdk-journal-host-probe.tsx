/** Signed Journal in the actual macOS host UI, using native API/PG/Worker fixtures.
 * Only the account/Space shell bootstrap is seeded; installation/session/RPC use real HTTP. */
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  appsApi,
  type OfficialApp,
  type UserAppInstallation,
  type OfficialAppSession,
} from "../src/api/apps/api";
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
import { GlobalNavigator } from "../src/application/layouts/DesktopLayout/GlobalNavigator";
import { WorkspaceCanvas } from "../src/application/layouts/DesktopLayout/WorkspaceCanvas";
import { TooltipProvider } from "../src/shared/ui";
import { officialDesktopPackageReady } from "../src/features/apps/desktopPackages";

const params = new URLSearchParams(location.search);
const nonce = params.get("nonce")!;
const catalog = await fetch(params.get("catalog")!).then((response) => response.json());
const app: OfficialApp = catalog.apps.find((app: OfficialApp) => app.id === "journal");
if (app?.desktop.runtime !== "downloaded") throw new Error("Journal candidate is unavailable");
const fixture = await fetch("/scripts/sdk-journal-host-fixture.json").then((response) =>
  response.json(),
);
const user = { id: fixture.userId, name: "SDK verification", email: "sdk@example.invalid" };
const space = {
  id: fixture.spaceId,
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
const apiBase = location.origin + "/__sdk-journal-api/v1";
configureOfficialAppRuntimeApiBase(apiBase);
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
async function accountRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${fixture.accountToken}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Native account request ${method} ${path}: ${response.status}`);
  return response.json();
}
appsApi.installations = () => accountRequest<{ apps: UserAppInstallation[] }>("/me/apps");
appsApi.install = async (id, permissionVersion) => {
  apiCalls.push("install");
  return (installation = await accountRequest<UserAppInstallation>(`/me/apps/${id}`, "PUT", {
    permission_version: permissionVersion,
  }));
};
appsApi.uninstall = async (id) => {
  apiCalls.push("uninstall");
  return (installation = await accountRequest<UserAppInstallation>(`/me/apps/${id}`, "DELETE"));
};
appsApi.createSession = (id, spaceId) => {
  apiCalls.push("session");
  return accountRequest<OfficialAppSession>(`/me/apps/${id}/sessions`, "POST", {
    space_id: spaceId,
  });
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
const tabs = () => dockTabs(useWorkspaceStore.getState().layout.root);
const journalTabs = () => tabs().filter((tab) => tab.groupKey === "app:journal");
const components = () => document.querySelectorAll('[data-misty-component-app="journal"]');
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
  await until(() => !!button("Add Journal"), "Discover did not offer Journal installation");
  button("Add Journal")!.click();
  await until(() => !!button("Add to Misty"), "Discover did not show install review");
  button("Add to Misty")!.click();
  await until(
    () => installation?.state === "installed" && !useAppsStore.getState().actionAppId,
    "Install did not complete",
  );
  if (!(await officialDesktopPackageReady(app)))
    throw new Error("Verified package missing after installation");
  button("Cancel", document.querySelector('[role="dialog"]')!)!.click();
  stage = "navbar open";
  const navbar = document.querySelector('nav[aria-label="Primary"]')!;
  await until(() => !!button("Journal", navbar), "Journal missing from navbar");
  if (!navbar.querySelector('[aria-label="Journal destinations"] a'))
    button("Journal", navbar)!.click();
  await until(
    () => !!navbar.querySelector('[aria-label="Journal destinations"] a'),
    "Journal destinations missing",
  );
  (navbar.querySelector('[aria-label="Journal destinations"] a') as HTMLAnchorElement).click();
  await until(
    () => !!button("Open Fixture note"),
    "Downloaded Journal did not load notes through native SDK RPC",
  );
  if (document.querySelector("iframe")) throw new Error("Journal created an iframe");
  button("Open Fixture note")!.click();
  await until(
    () => !!document.querySelector('[aria-label="Note title"]'),
    "Note editor did not open",
  );
  const title = document.querySelector<HTMLInputElement>('[aria-label="Note title"]')!;
  const text = "SDK native host note";
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, text);
  title.dispatchEvent(new Event("input", { bubbles: true }));
  title.dispatchEvent(new Event("change", { bubbles: true }));
  await until(async () => {
    const response = await accountRequest<{ title: string }>(
      `/spaces/${space.id}/notes/${fixture.noteId}`,
    );
    return response.title === text;
  }, "Native Journal editor title did not persist through collaboration");
  stage = "split panel";
  const original = journalTabs()[0];
  const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
    pane.tabs.some((tab) => tab.id === original.id),
  )!;
  const second = useWorkspaceStore.getState().openSurface({
    ...workspaceSurfaceFromRoute(`/apps/journal?space=${space.id}&view=drawings`)!,
    forceNew: true,
  });
  if (!useWorkspaceStore.getState().splitPane(pane.id, "right", second.id))
    throw new Error("Host refused split panel");
  await until(
    () => components().length === 2 && !!button("Open Fixture drawing"),
    "Second Journal panel did not load drawings",
  );
  button("Open Fixture drawing")!.click();
  await until(
    () => !!document.querySelector(".excalidraw canvas"),
    "Downloaded drawing canvas did not render",
  );
  if (document.querySelector("iframe")) throw new Error("Drawing canvas created an iframe");
  stage = "close panels";
  useWorkspaceStore.getState().closeTab(second.id);
  useWorkspaceStore.getState().focusTab(original.id);
  await until(
    () => components().length === 1 && !!document.querySelector('[aria-label="Note title"]'),
    "Closing drawings damaged notes panel",
  );
  useWorkspaceStore.getState().closeTab(original.id);
  useWorkspaceStore.getState().focusTab(discover.id);
  await until(() => components().length === 0, "Closed Journal component remains mounted");
  stage = "Discover remove";
  await until(() => !!button("View Journal details"), "Discover did not return");
  button("View Journal details")!.click();
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
  if (button("Journal", document.querySelector('nav[aria-label="Primary"]')!))
    throw new Error("Removed Journal remains in navbar");
  if (
    !apiCalls.includes("install") ||
    !apiCalls.includes("session") ||
    !apiCalls.includes("uninstall")
  )
    throw new Error("Host skipped the installation/session contracts");
  success = true;
  message =
    "PASS: native macOS Discover download/install, real native account installation/session HTTP contracts, navbar open, signed component import without iframe, SDK note editor with persisted collaboration projection, separate notes/drawings workspace panels, canvas render, tab cleanup, native uninstall and navbar/package removal. Account/Space shell bootstrap is seeded; database, RPC and collaboration are real disposable services.";
} catch (error) {
  message = `${stage}: ${String(error)}`;
} finally {
  root.unmount();
}
document.getElementById("result")!.textContent = message;
await invoke("sdk_probe_complete", { nonce, success, message });
