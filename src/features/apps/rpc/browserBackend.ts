import type { MistyBrowserBounds, MistyBrowserEvent, MistyBrowserInspection } from "@misty/sdk";
import { MistyBrowserEventSchema, MistyBrowserUrlSchema } from "@misty/sdk";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { parseBrowserTabState, type WorkspaceTab } from "@/features/workspace/model";
import { useAppThemeStore } from "@/features/settings/store/useAppThemeStore";
import { getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import {
  browserRuntimeId,
  browserRuntimeResumeEvent,
  closeBrowserRuntime,
  hideBrowserWebview,
  registerSdkBrowserContext,
  browserOverlayReady,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
  syncBrowserWebview,
} from "@/features/browser/browserRuntime";
import { nativeRpcBackend } from "./nativeBackend";
import { AppRpcError, type AppRpcScope } from "./session";
import type { BrowserRpcBackend } from "./browser";

/** Derive a profile without disclosing server/account identifiers to package code. */
export async function browserProfileId(
  serverBase: string,
  accountId: string,
  appId = "browser",
): Promise<string> {
  const base = new URL(serverBase);
  base.search = "";
  base.hash = "";
  const bytes = new TextEncoder().encode(
    JSON.stringify(["misty-sdk-browser-v1", base.href.replace(/\/+$/, ""), accountId, appId]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function constrainBrowserBounds(
  bounds: MistyBrowserBounds,
  root: HTMLElement,
): MistyBrowserBounds {
  if (!root.isConnected || document.visibilityState === "hidden")
    throw new AppRpcError("view_hidden", "The App view is not visible.");
  const rect = root.getBoundingClientRect();
  const x = Math.max(0, bounds.x, rect.left),
    y = Math.max(0, bounds.y, rect.top);
  const right = Math.min(window.innerWidth, rect.right, bounds.x + bounds.width);
  const bottom = Math.min(window.innerHeight, rect.bottom, bounds.y + bounds.height);
  if (right - x < 1 || bottom - y < 1)
    throw new AppRpcError("view_hidden", "The browser viewport is outside this App view.");
  return { x, y, width: right - x, height: bottom - y };
}
export function createBrowserRpcBackend(
  scope: AppRpcScope,
  root: HTMLElement,
  serverBase: string,
): BrowserRpcBackend {
  const records = new Map<
    string,
    { tab: WorkspaceTab; url: string; profileId: string; scopeId: string; release: () => void }
  >();
  const ownedTab = () => {
    scope.assert();
    const tab = dockLeaves(useWorkspaceStore.getState().layout.root)
      .flatMap((pane) => pane.tabs)
      .find(
        (tab) =>
          tab.id === scope.identity.instanceId && tab.groupKey === `app:${scope.identity.appId}`,
      );
    if (!tab) throw new AppRpcError("view_closed", "The App's workspace view is no longer open.");
    return tab;
  };
  const record = (id: string) => {
    const item = records.get(id);
    if (!item) throw new AppRpcError("resource_denied", "The native browser view is unavailable.");
    return item;
  };
  const nativeId = (id: string) =>
    browserRuntimeId({ id: scope.identity.instanceId, instanceKey: id });
  const nativeBounds = (bounds: MistyBrowserBounds) => {
    const zoom = getAppliedAppZoom();
    return Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [key, Math.round(value * zoom * 2) / 2]),
    ) as MistyBrowserBounds;
  };
  let profile: Promise<string> | undefined;
  const overlays = new Map<string, Set<string>>();
  const performInspectionAction = async (
    id: string,
    operation: "browser.inspect" | "browser.click",
    input: Record<string, unknown>,
  ) => {
    const item = record(id);
    scope.assert(operation === "browser.inspect" ? "browser.inspect" : "browser.interact");
    const grantId = `sdk-action-${crypto.randomUUID()}`;
    const agentId = `sdk-app-${scope.identity.appId}`;
    try {
      await nativeRpcBackend.invoke("browser_agent_grant_register", {
        request: {
          id: nativeId(id),
          scopeId: item.scopeId,
          grantId,
          agentId,
          capabilities: [operation],
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        },
      });
      scope.assert(operation === "browser.inspect" ? "browser.inspect" : "browser.interact");
      return await nativeRpcBackend.invoke("browser_agent_execute", {
        request: {
          scopeId: item.scopeId,
          grantId,
          agentId,
          operation,
          input,
        },
      });
    } finally {
      await nativeRpcBackend
        .invoke("browser_agent_grant_revoke", { request: { id: nativeId(id), grantId } })
        .catch(() => undefined);
    }
  };
  return {
    initialUrl: () => parseBrowserTabState(ownedTab().state).url,
    constrainBounds: (bounds) => {
      ownedTab();
      return constrainBrowserBounds(bounds, root);
    },
    async create(input) {
      const tab = { ...ownedTab(), instanceKey: input.id };
      const profileId = await (profile ??= browserProfileId(
        serverBase,
        scope.identity.accountId,
        scope.identity.appId,
      ));
      scope.assert();
      const release = registerSdkBrowserContext(tab.id, nativeId(input.id), input.scopeId);
      records.set(input.id, { tab, url: input.url, profileId, scopeId: input.scopeId, release });
      useBrowserRuntimeStore.getState().ensureHistory(tab.id, input.url);
      await syncBrowserWebview({
        tab,
        url: input.url,
        profileId,
        scopeId: input.scopeId,
        bounds: nativeBounds(constrainBrowserBounds(input.bounds, root)),
        theme: useAppThemeStore.getState().resolvedTheme,
        nativeLiveResize: input.nativeLiveResize,
      });
    },
    async layout(input) {
      const item = record(input.id);
      if (!input.visible) return hideBrowserWebview(item.tab);
      await syncBrowserWebview({
        ...item,
        bounds: nativeBounds(constrainBrowserBounds(input.bounds, root)),
        theme: useAppThemeStore.getState().resolvedTheme,
        nativeLiveResize: input.nativeLiveResize,
      });
    },
    async navigate(id, url) {
      const item = record(id);
      item.url = url;
      await nativeRpcBackend.invoke("browser_webview_navigate", {
        request: { id: nativeId(id), url },
      });
    },
    back: (id) =>
      nativeRpcBackend.invoke("browser_webview_back", { request: { id: nativeId(id) } }),
    forward: (id) =>
      nativeRpcBackend.invoke("browser_webview_forward", { request: { id: nativeId(id) } }),
    reload: (id) =>
      nativeRpcBackend.invoke("browser_webview_reload", { request: { id: nativeId(id) } }),
    inspect: async (id) =>
      (await performInspectionAction(id, "browser.inspect", {})) as Omit<
        MistyBrowserInspection,
        "documentId"
      >,
    click: async (id, elementRef) => {
      await performInspectionAction(id, "browser.click", { elementRef, expectDownload: false });
    },
    async overlay(id, reason, active) {
      record(id);
      const reasons = overlays.get(id) ?? new Set<string>();
      const key = `sdk-browser:${id}:${reason}`;
      if (active && !reasons.has(key) && reasons.size >= 16)
        throw new AppRpcError("resource_limit", "Too many browser overlays are open.");
      if (active) reasons.add(key);
      else reasons.delete(key);
      overlays.set(id, reasons);
      setBrowserWebviewsSuspended(active, key);
      await browserOverlayReady();
    },
    hide: (id) => {
      const item = records.get(id);
      return item ? hideBrowserWebview(item.tab) : Promise.resolve();
    },
    async close(id) {
      const item = records.get(id);
      records.delete(id);
      item?.release();
      for (const reason of overlays.get(id) ?? []) setBrowserWebviewsSuspended(false, reason);
      overlays.delete(id);
      if (item) await closeBrowserRuntime(item.tab);
      // Native creation can partially succeed before reporting a failure.
      // Close even if the legacy runtime never marked the view as created.
      await nativeRpcBackend.invoke("browser_webview_close", { request: { id: nativeId(id) } });
    },
    async subscribe(id, listener) {
      const target = nativeId(id);
      const names = ["page", "title", "favicon", "compatibility"] as const;
      let closed = false;
      const send = (event: MistyBrowserEvent) => {
        if (closed) return;
        try {
          scope.assert();
        } catch {
          return;
        }
        listener(event);
      };
      const results = await Promise.allSettled(
        names.map((type) =>
          nativeRpcBackend.listen(`misty://browser-${type}`, (payload) => {
            if (!payload || typeof payload !== "object") return;
            const { id: eventId, ...data } = payload as Record<string, unknown>;
            if (eventId !== target) return;
            if (type === "title" && typeof data.title === "string")
              data.title = data.title.slice(0, 512);
            const parsed = MistyBrowserEventSchema.safeParse({ type, ...data });
            if (!parsed.success) return;
            if (parsed.data.type === "page") {
              const item = records.get(id);
              if (item) item.url = parsed.data.url;
            }
            send(parsed.data);
          }),
        ),
      );
      const removers = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        removers.forEach((stop) => stop());
        throw failed.reason;
      }
      const resume = () => send({ type: "layout" });
      window.addEventListener(browserRuntimeResumeEvent, resume);
      const sendState = () => {
        const state = useBrowserRuntimeStore.getState();
        const tabId = scope.identity.instanceId;
        const history = state.histories[tabId];
        send({
          type: "state",
          canBack: (history?.index ?? 0) > 0,
          canForward: !!history && history.index < history.entries.length - 1,
          loading: state.loading[tabId] ?? false,
          agentAccess: (state.grants[tabId]?.length ?? 0) > 0,
          history: (history?.entries ?? [])
            .filter((url) => MistyBrowserUrlSchema.safeParse(url).success)
            .slice(-500),
          error: state.errors[tabId]?.slice(0, 2000) ?? null,
          notice: state.notices[tabId]?.slice(0, 2000) ?? null,
        });
      };
      let stateKey = "";
      removers.push(
        useBrowserRuntimeStore.subscribe((state) => {
          const tabId = scope.identity.instanceId;
          const next = JSON.stringify([
            state.histories[tabId],
            state.loading[tabId],
            state.grants[tabId]?.length,
            state.errors[tabId],
            state.notices[tabId],
          ]);
          if (next !== stateKey) {
            stateKey = next;
            sendState();
          }
        }),
      );
      removers.push(
        useAppThemeStore.subscribe((state, previous) => {
          if (closed || state.resolvedTheme === previous.resolvedTheme || !records.has(id)) return;
          try {
            scope.assert();
          } catch {
            return;
          }
          void nativeRpcBackend
            .invoke("browser_webview_set_theme", { request: { theme: state.resolvedTheme } })
            .catch(() => undefined);
        }),
      );
      sendState();
      return () => {
        if (closed) return;
        closed = true;
        removers.forEach((stop) => stop());
        window.removeEventListener(browserRuntimeResumeEvent, resume);
      };
    },
  };
}
