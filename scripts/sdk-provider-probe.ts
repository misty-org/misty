/** Signed app + native provider lifecycle. Synthetic content is confined to disposable test profiles.
 * Public provider page/login compatibility is deliberately NOT inferred from this fixture.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import type { OfficialApp } from "../src/api/apps/api";
import { loadDesktopApp } from "../src/features/apps/desktopAppLoader";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createBrowserRpc } from "../src/features/apps/rpc/browser";
import { createBrowserRpcBackend } from "../src/features/apps/rpc/browserBackend";
import { createAppUiRpc } from "../src/features/apps/rpc/appUi";
import { mountAppComponent } from "../src/features/apps/rpc/component";
import { useAppsStore } from "../src/features/apps/useAppsStore";
import { useWorkspaceStore } from "../src/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "../src/features/workspace/routeSurface";
import { browserRuntimeIdForTabId } from "@/features/browser/browserRuntime";
import type { MistyBrowserInspection } from "@misty/sdk";
const params = new URLSearchParams(location.search),
  nonce = params.get("nonce")!;
const appId = params.get("app") === "inbox" ? "inbox" : "chat";
document.getElementById("result")!.dataset.stage = "catalog";
const catalogUrl = params.get("catalog");
if (!catalogUrl) throw new Error("Missing catalog URL in provider probe");
const directoryFirst = new URL(catalogUrl).searchParams.get("directory") === "1";
const publicWebsite = new URL(catalogUrl).searchParams.get("website");
const selectedProvider =
  publicWebsite ||
  new URL(catalogUrl).searchParams.get("provider") ||
  (appId === "chat" ? "instagram" : "google");
const catalogResponse = await fetch(catalogUrl);
const catalogText = await catalogResponse.text();
if (!catalogResponse.ok || !catalogText.trimStart().startsWith("{")) {
  throw new Error(
    `Catalog ${catalogResponse.status} at ${catalogResponse.url}: ${catalogText.slice(0, 200)}`,
  );
}
const catalog = JSON.parse(catalogText);
const apps = catalog.apps as OfficialApp[],
  app = apps.find((app) => app.id === appId)!;
const accountId = `provider-probe-${nonce}`;
for (const candidate of apps.filter((app) => [appId, "browser"].includes(app.id))) {
  document.getElementById("result")!.dataset.stage = `load ${candidate.id}`;
  await loadDesktopApp(candidate);
}
useAppsStore.setState({
  accountId,
  catalog: apps,
  ready: true,
  loading: false,
  error: "",
  installations: apps
    .filter((app) => [appId, "browser"].includes(app.id))
    .map((app) => ({
      app_id: app.id,
      state: "installed",
      installed_version: app.version,
      permission_version: app.permission_version,
      granted_scopes: app.scopes,
      pinned: true,
      pin_rank: 0,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
});
const root = document.getElementById("a")!;
const route = `/apps/${appId === "chat" ? "social" : "inbox"}?provider=${selectedProvider}`;
const tab = useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute(route)!);
const scope = createAppRpcScope({
  identity: { appId, accountId, instanceId: tab.id },
  scopes: app.scopes,
  expiresAt: new Date(Date.now() + 120000).toISOString(),
  isCurrentAccount: () => true,
});
const browser = createBrowserRpc(scope, createBrowserRpcBackend(scope, root, location.origin));
const errors: string[] = [],
  records = new Map<string, unknown>();
const ui = createAppUiRpc(scope, {
  settings: () => ({ browser: { homeUrl: "about:blank", searchEngineIndex: 0 } }),
  setTitle: () => {},
  subscribeSettings: () => () => {},
  registerShortcut: () => () => {},
  reportError: (error) => errors.push(error),
  openExternal: async () => {
    throw new Error("External system opening is not part of this fixture");
  },
});
let handle = "";
let lastBrowserRequest = "none";
const browserRequests = new Map<string, number>();
let lastVisibility: boolean | undefined;
const popupDestinations: string[] = [];
const context = {
  instanceId: tab.id,
  route: directoryFirst ? `/apps/${appId === "chat" ? "social" : "inbox"}` : route,
  active: true,
  focused: true,
  appearance: { mode: "dark" as const },
};
document.getElementById("result")!.dataset.stage = "mount";
const mounted = mountAppComponent({
  root,
  context,
  scope,
  definition: await loadDesktopApp(app),
  release: () => {
    ui.close();
    void browser.close();
  },
  transport: {
    registerSurface: async () => () => {},
    subscribe: (topic, listener) =>
      topic.startsWith("browser:")
        ? browser.subscribe(topic, listener)
        : ui.subscribe(topic, listener),
    async request(message) {
      const input = message.params as { key: string; value?: unknown } | undefined;
      if (message.method === "context.get")
        return { appId, platform: "desktop", user: { id: accountId } };
      if (message.method === "navigation.open" && directoryFirst) {
        context.route = (message.params as { route: string }).route;
        mounted.update({ ...context });
        return;
      }
      if (["lifecycle.ready", "navigation.setItems", "navigation.open"].includes(message.method))
        return;
      if (message.method === "mail.accounts.list") return { accounts: [] };
      if (message.method === "storage.local.keys") return [...records.keys()];
      if (message.method === "storage.local.get") return records.get(input!.key) ?? null;
      if (message.method === "storage.local.set") {
        records.set(input!.key, input!.value);
        return;
      }
      if (message.method.startsWith("browser.")) {
        lastBrowserRequest = `${message.method} started`;
        const result = await browser.request(message);
        lastBrowserRequest = `${message.method} finished`;
        browserRequests.set(message.method, (browserRequests.get(message.method) ?? 0) + 1);
        if (message.method === "browser.layout")
          lastVisibility = (message.params as { visible: boolean }).visible;
        if (message.method === "browser.create") handle = (result as { handle: string }).handle;
        return result;
      }
      return ui.request(message);
    },
  },
});
void mounted.ready.catch(() => undefined);
async function until(check: () => boolean | Promise<boolean>, reason: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (errors.length) throw new Error(errors.join("; "));
    if (Date.now() > deadline)
      throw new Error(
        reason +
          " | " +
          JSON.stringify({
            lastBrowserRequest,
            popupDestinations,
            visibility: document.visibilityState,
            online: navigator.onLine,
            geometry: [
              ...root.querySelectorAll(
                "section, [data-browser-page-stage], [data-browser-page-host]",
              ),
            ].map((element) => ({
              className: element.className,
              rect: element.getBoundingClientRect().toJSON(),
            })),
          }) +
          " | " +
          root.textContent?.slice(-600),
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
const fixture = (mode: string, tabId = tab.id) =>
  invoke<{ marker: string | null; opener: boolean; draft: string; origin: string }>(
    "sdk_probe_provider_fixture",
    { nonce, id: browserRuntimeIdForTabId(tabId), mode },
  );
const inspect = () =>
  browser.request({
    method: "browser.inspect",
    params: { handle },
  }) as Promise<MistyBrowserInspection>;
const unlisten = await listen<{ sourceId: string; url: string; popupInstanceKey?: string }>(
  "misty://browser-popup",
  ({ payload }) => {
    const target = new URL(payload.url);
    popupDestinations.push(target.origin + target.pathname);
  },
);
let success = false,
  message = "",
  stage = "signed provider mount";
document.getElementById("result")!.dataset.stage = stage;
try {
  await mounted.ready;
  if (directoryFirst) {
    stage = "integration directory";
    await getCurrentWindow().setSize(new LogicalSize(1100, 800));
    await until(
      () => !!root.querySelector(`[data-integration="${selectedProvider}"] button`),
      "Integration directory did not render",
    );
    if (handle)
      throw new Error("Landing directory created a browser before choosing an integration");
    document.getElementById("result")!.textContent =
      "Integration directory: ready for visual inspection";
    await new Promise((resolve) => setTimeout(resolve, 45000));
    await getCurrentWindow().setSize(new LogicalSize(480, 800));
    await new Promise((resolve) => setTimeout(resolve, 45000));
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      `[data-integration="${selectedProvider}"] button`,
    );
    buttons[buttons.length - 1].click();
  }
  await until(() => !!handle, "Provider app did not create its shared native Browser");
  if (!root.querySelector(`[data-provider="${selectedProvider}"]`) || root.querySelector("iframe"))
    throw new Error("Expected the app-owned provider view and native webview");
  if (publicWebsite) {
    document.getElementById("result")!.dataset.stage = stage = "public website rendering";
    let websitePage: MistyBrowserInspection | undefined;
    await until(
      async () => {
        try {
          websitePage = await inspect();
          return websitePage.url.startsWith("https:") && websitePage.text.length > 100;
        } catch {
          // A navigation replaces the document and cancels an in-flight inspection.
          return false;
        }
      },
      "Public provider page did not render inspectable content",
      90000,
    );
    const rendered = `Public ${selectedProvider} page at ${new URL(websitePage!.url).origin}${new URL(websitePage!.url).pathname}: ${websitePage!.text.slice(0, 500)}`;
    document.getElementById("result")!.textContent = rendered;
    // Leave the real page visible for computer-use inspection. Never insert fixtures in this mode.
    await new Promise((resolve) => setTimeout(resolve, 45000));
    if (popupDestinations.length)
      throw new Error(
        `Opening the provider page unexpectedly opened ${popupDestinations.length} additional destinations`,
      );
    success = true;
    message = `${rendered}\nRendering observed only. Sign-in, authenticated functionality and restart persistence remain unverified.`;
  } else {
    document.getElementById("result")!.dataset.stage = stage = "controlled native account fixture";
    let fixtureError = "";
    await until(async () => {
      try {
        return (await fixture("install")).origin.startsWith("https:");
      } catch (error) {
        fixtureError = String(error);
        document.getElementById("result")!.textContent = fixtureError;
        return false;
      }
    }, "Provider origin did not initialize");
    await fixture("store");
    await fixture("blocked-frame");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (popupDestinations.length) throw new Error("A blocked provider subframe opened a new tab");
    const page = await inspect(),
      reply = page.interactive.find((control) => control.name === "Reply");
    if (!reply) throw new Error("Native reply control not inspected");
    await browser.request({
      method: "browser.type",
      params: {
        handle,
        documentId: page.documentId,
        elementRef: reply.ref,
        text: "Prepared, not sent",
      },
    });
    if ((await fixture("state")).draft !== "Prepared, not sent")
      throw new Error("Native draft was not retained");
    document.getElementById("result")!.dataset.stage = stage =
      "retaining live page across tab switches";
    const retainedHandle = handle;
    const lifecycleCounts = () =>
      JSON.stringify(
        ["browser.create", "browser.close", "browser.navigate", "browser.reload"].map(
          (method) => browserRequests.get(method) ?? 0,
        ),
      );
    const beforeSwitch = lifecycleCounts();
    for (let cycle = 0; cycle < 3; cycle++) {
      mounted.update({ ...context, active: false, focused: false });
      root.style.display = "none";
      await until(() => lastVisibility === false, "Inactive provider page was not hidden");
      root.style.display = "";
      mounted.update(context);
      await until(() => lastVisibility === true, "Provider page was not revealed");
      if (handle !== retainedHandle || lifecycleCounts() !== beforeSwitch)
        throw new Error("Tab switching recreated or navigated the provider view");
      if ((await fixture("state")).draft !== "Prepared, not sent")
        throw new Error("Tab switching lost the live draft");
    }
    document.getElementById("result")!.dataset.stage = stage = "attached authentication popup";
    const current = await inspect(),
      button = current.interactive.find(
        (control) => control.name === "Open authentication fixture",
      );
    await browser.request({
      method: "browser.click",
      params: { handle, documentId: current.documentId, elementRef: button!.ref },
    });
    await until(
      async () => !!(await fixture("popup-state")),
      "Native authentication window did not open",
    );
    if (popupDestinations.length) throw new Error("Provider authentication escaped into Browser");
    const attached = await fixture("popup-state");
    if (!attached.opener || attached.marker !== "account-one")
      throw new Error("Authentication popup lost its opener or isolated account storage");
    await fixture("popup-close");
    document.getElementById("result")!.dataset.stage = stage = "account switching";
    const buttonNamed = (name: string) =>
      [...root.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === name,
      )!;
    buttonNamed("Add account").click();
    await until(() => !!buttonNamed("Add and open sign-in"), "Add account did not open");
    const originalHandle = handle;
    buttonNamed("Add and open sign-in").click();
    await until(() => handle !== originalHandle, "Switching accounts did not create a new view");
    await until(async () => {
      try {
        return (await fixture("install")).origin.startsWith("https:");
      } catch {
        return false;
      }
    }, "Second account did not initialize");
    if ((await fixture("state")).marker !== null)
      throw new Error("Website accounts shared storage");
    const select = root.querySelector<HTMLSelectElement>('select[aria-label$=" account"]')!;
    select.value = `default-${selectedProvider}`;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const secondHandle = handle;
    await until(() => handle !== secondHandle, "Original account did not reopen");
    await until(async () => {
      try {
        return (await fixture("state")).marker === "account-one";
      } catch {
        return false;
      }
    }, "Original account storage did not persist across view recreation");
    success = true;
    message = `PASS ${appId}: signed installable provider app, native shared view, three tab hide/reveal cycles without recreation/navigation/reload or loss of draft, device-local inspected draft, native popup attached to its integration with opener, account storage and working window.close, separate website accounts and persistence across view recreation. Synthetic disposable content only; real login, full process restart and provider API compatibility remain unverified.`;
  }
} catch (error) {
  message = `${stage}: ${String(error)}`;
} finally {
  unlisten();
  await mounted.close();
  await browser.close();
}
document.getElementById("result")!.textContent = message;
await invoke("sdk_probe_complete", { nonce, success, message });
