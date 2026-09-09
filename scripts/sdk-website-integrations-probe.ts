/** Real downloaded components and native WebKit; all accounts are disposable fixtures. */
import { invoke } from "@tauri-apps/api/core";
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
import { createMistyAppSDK, type MistyComponentContext } from "@misty/sdk";
const params = new URLSearchParams(location.search),
  nonce = params.get("nonce")!;
const appId = params.get("app") === "planner" ? "planner" : "journal";
const root = document.getElementById("a")!,
  result = document.getElementById("result")!;
const wait = async (check: () => boolean | Promise<boolean>, message: string) => {
  const deadline = Date.now() + 25000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error(
        message +
          " Visible state: " +
          root.textContent?.slice(0, 2200) +
          " Probe: " +
          result.textContent,
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
async function verify() {
  const catalog = await fetch(params.get("catalog")!).then((response) => response.json());
  const app = catalog.apps.find((item: OfficialApp) => item.id === appId) as OfficialApp;
  const accountId = `website-probe-${nonce}`;
  useAppsStore.setState({
    accountId,
    catalog: catalog.apps,
    ready: true,
    loading: false,
    error: "",
    installations: [
      {
        app_id: app.id,
        state: "installed",
        installed_version: app.version,
        permission_version: app.permission_version,
      } as never,
    ],
  });
  const route = `/apps/${appId}?view=integrations`;
  const tab = useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute(route)!);
  const scope = createAppRpcScope({
    identity: { appId, accountId, instanceId: tab.id },
    scopes: app.scopes,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    isCurrentAccount: () => true,
  });
  const backend = createBrowserRpcBackend(scope, root, location.origin),
    browser = createBrowserRpc(scope, backend);
  const records = new Map<string, unknown>(),
    errors: string[] = [];
  const ui = createAppUiRpc(scope, {
    settings: () => ({ browser: { homeUrl: "about:blank", searchEngineIndex: 0 } }),
    setTitle: () => {},
    subscribeSettings: () => () => {},
    registerShortcut: () => () => {},
    reportError: (error) => errors.push(error),
    openExternal: async () => {},
  });
  let context: MistyComponentContext = {
    instanceId: tab.id,
    route,
    active: true,
    focused: true,
    appearance: { mode: "dark" },
  };
  let created = 0,
    closed = 0;
  let storedOrigin = "";
  const transport = {
    registerSurface: async () => () => {},
    subscribe: (topic: string, listener: (event: unknown) => void) =>
      topic.startsWith("browser:")
        ? browser.subscribe(topic, listener)
        : ui.subscribe(topic, listener),
    async request(message: { method: string; params?: unknown }): Promise<unknown> {
      const input = message.params as { key: string; value?: unknown; route: string };
      if (message.method === "context.get")
        return { appId, platform: "desktop", user: { id: accountId } };
      if (message.method === "navigation.open") {
        context = { ...context, route: input.route };
        mounted.update(context);
        return;
      }
      if (["lifecycle.ready", "navigation.setItems"].includes(message.method)) return;
      if (message.method === "storage.local.keys") return [...records.keys()];
      if (message.method === "storage.local.get") return records.get(input.key) ?? null;
      if (message.method === "storage.local.set") {
        records.set(input.key, input.value);
        return;
      }
      if (message.method === "storage.local.delete") {
        records.delete(input.key);
        return;
      }
      if (message.method.startsWith("browser.")) {
        const value = await browser.request(message);
        if (message.method === "browser.create") created++;
        if (message.method === "browser.close") closed++;
        return value;
      }
      return ui.request(message);
    },
  };
  const mounted = mountAppComponent({
    root,
    context,
    scope,
    definition: await loadDesktopApp(app),
    release: () => {},
    transport,
  });
  const sdk = createMistyAppSDK(transport);
  try {
    await mounted.ready;
    await wait(
      () => root.textContent?.includes("Website integrations stay separate") === true,
      "The integration gallery did not render.",
    );
    const provider = appId === "journal" ? "google-docs" : "google-calendar",
      label = appId === "journal" ? "Google Docs" : "Google Calendar";
    (root.querySelector(`[aria-label="Add ${label}"]`) as HTMLButtonElement).click();
    await wait(
      () => !!root.querySelector('input[placeholder="Personal or Work"]'),
      "Account setup did not open.",
    );
    const accountIdForWebsite = "disposable-account";
    await sdk.storage.local.set(
      `website-integration-v1:account:${accountIdForWebsite}`,
      JSON.stringify({
        id: accountIdForWebsite,
        provider,
        label: "Disposable account",
        websiteUrl:
          provider === "google-docs"
            ? "https://docs.google.com/document/"
            : "https://calendar.google.com/calendar/u/0/r",
      }),
    );
    await sdk.navigation.open(route);
    await wait(
      () => root.textContent?.includes("Website integrations stay separate") === true,
      "The gallery did not reopen.",
    );
    await sdk.navigation.open(`/apps/${appId}?provider=${provider}&account=${accountIdForWebsite}`);
    await wait(() => created === 1, "The native provider view did not open.");
    const count = () => invoke<number>("sdk_probe_browser_count", { nonce });
    await wait(async () => (await count()) === 1, "The provider view was not native.");
    await wait(async () => {
      try {
        const stored = await invoke<{ stored: boolean; origin: string }>(
          "sdk_probe_provider_fixture",
          { nonce, id: browserRuntimeIdForTabId(tab.id), mode: "store" },
        );
        storedOrigin = stored.origin;
        return stored.stored;
      } catch (error) {
        const page = await invoke("sdk_probe_provider_fixture", {
          nonce,
          id: browserRuntimeIdForTabId(tab.id),
          mode: "location",
        }).catch(String);
        result.textContent = `Website storage probe: ${String(error)}; page ${JSON.stringify(page)}`;
        return false;
      }
    }, "The disposable website store did not become available.");
    await sdk.navigation.open(route);
    await wait(() => closed === 1, "Switching to Integrations did not close the website.");
    await wait(async () => (await count()) === 0, "A native website remained over the gallery.");
    const accountKey = [...records.keys()].find((key) =>
      key.startsWith("website-integration-v1:account:"),
    )!;
    const account = JSON.parse(records.get(accountKey) as string);
    await sdk.navigation.open(`/apps/${appId}?provider=${provider}&account=${account.id}`);
    await wait(() => created === 2, "The website did not reopen with its existing account.");
    await sdk.navigation.open(route);
    await wait(() => closed === 2, "The reopened website did not close.");
    await sdk.browser.removeAccount({ id: provider, accountId: account.id });
    await sdk.navigation.open(`/apps/${appId}?provider=${provider}&account=${account.id}`);
    await wait(() => created === 3, "The cleared account did not reopen.");
    await wait(async () => {
      try {
        const state = await invoke<{ marker: string | null; origin: string }>(
          "sdk_probe_provider_fixture",
          { nonce, id: browserRuntimeIdForTabId(tab.id), mode: "state" },
        );
        return state.origin === storedOrigin && state.marker === null;
      } catch {
        return false;
      }
    }, "Native cleanup did not clear the account's persisted website data.");
    await sdk.navigation.open(route);
    await wait(() => closed === 3, "The cleared account view did not close.");
    if (errors.length) throw new Error(errors.join("; "));
    result.textContent = `${appId}: gallery, account setup, native opening, reopening, closure, scoped WebKit cleanup passed. Authenticated provider flows were not exercised.`;
  } finally {
    await mounted.close();
    scope.close();
    await browser.close();
    ui.close();
  }
}
try {
  await verify();
  await invoke("sdk_probe_complete", { nonce, success: true, message: result.textContent });
} catch (error) {
  result.textContent = String(error);
  await invoke("sdk_probe_complete", { nonce, success: false, message: String(error) });
}
