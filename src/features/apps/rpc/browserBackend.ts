import {
  browserProviders,
  providerUrlAllowed,
  providerBelongsToApp,
  registerProviderBrowser,
  popupBrowserProfile,
  consumePopupBrowserInstance,
  forgetProviderProfile,
} from "@/features/browser/browserProviders";
import type {
  MistyBrowserBounds,
  MistyBrowserEvent,
  MistyBrowserInspection,
  MistyBrowserProvider,
} from "@misty/sdk";
import { MistyBrowserEventSchema, MistyBrowserUrlSchema } from "@misty/sdk";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { parseBrowserTabState, type WorkspaceTab } from "@/features/workspace/model";
import { useAppThemeStore } from "@/features/settings";
import { appZoomChangedEvent, getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
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
import { browserProfileId, constrainBrowserBounds, providerOAuthCallback } from "./browserIdentity";
import { AppRpcError, type AppRpcScope } from "./session";
import type { BrowserRpcBackend } from "./browser";

// Account removal spans workspace panes, while authority remains with each owning backend.
const profileViews = new Map<string, Set<() => Promise<void>>>();
const removingProfiles = new Set<string>();
export { browserProfileId, constrainBrowserBounds, providerOAuthCallback } from "./browserIdentity";
export function createBrowserRpcBackend(
  scope: AppRpcScope,
  root: HTMLElement,
  serverBase: string,
): BrowserRpcBackend {
  const records = new Map<
    string,
    {
      tab: WorkspaceTab;
      url: string;
      profileId: string;
      scopeId: string;
      provider?: MistyBrowserProvider;
      release: () => void;
    }
  >();
  const nativeKeys = new Map<string, string>();
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
    browserRuntimeId({ id: scope.identity.instanceId, instanceKey: nativeKeys.get(id) ?? id });
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
    operation:
      "browser.inspect" | "browser.click" | "browser.type" | "browser.request" | "browser.interact",
    input: Record<string, unknown>,
  ) => {
    const item = record(id);
    scope.assert(
      ["browser.inspect", "browser.request"].includes(operation)
        ? "browser.inspect"
        : "browser.interact",
    );
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
      scope.assert(
        ["browser.inspect", "browser.request"].includes(operation)
          ? "browser.inspect"
          : "browser.interact",
      );
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
    async availability() {
      scope.assert();
      if (!/Mac/.test(navigator.platform))
        return {
          available: false,
          persistent: false,
          reason: "Provider websites require Misty on a Mac.",
        };
      // Native website views are a host capability owned by the requesting app.
      // Sharing their implementation does not require installing the Browser app.
      const persistent = await nativeRpcBackend.invoke("browser_profile_persistence", {});
      scope.assert();
      if (scope.identity.appId !== "browser" && persistent !== true)
        return {
          available: false,
          persistent: false,
          reason:
            "Website accounts require macOS 14 or later to keep separate sign-ins. You can still use the existing app view.",
        };
      return {
        available: true,
        persistent: persistent === true,
        supportedProviders: Object.keys(browserProviders).filter((id) =>
          providerBelongsToApp(scope.identity.appId, id as keyof typeof browserProviders),
        ) as (keyof typeof browserProviders)[],
        profileCleanup: true,
      };
    },
    async removeAccount(provider) {
      scope.assert("browser.navigate");
      if (!providerBelongsToApp(scope.identity.appId, provider.id))
        throw new AppRpcError("provider_denied", "This provider does not belong to this App.");
      const profileId = await browserProfileId(
        serverBase,
        scope.identity.accountId,
        scope.identity.appId,
        provider,
      );
      scope.assert("browser.navigate");
      if (removingProfiles.has(profileId))
        throw new AppRpcError("account_busy", "This website account is already being removed.");
      removingProfiles.add(profileId);
      try {
        await Promise.all([...(profileViews.get(profileId) ?? [])].map((close) => close()));
        await nativeRpcBackend.invoke("browser_profile_remove", { profileId });
        forgetProviderProfile(profileId);
      } finally {
        removingProfiles.delete(profileId);
      }
    },
    initialUrl: () => parseBrowserTabState(ownedTab().state).url,
    constrainBounds: (bounds) => {
      ownedTab();
      return constrainBrowserBounds(bounds, root);
    },
    async create(input) {
      const tab = { ...ownedTab(), instanceKey: input.id };
      let provider = input.provider;
      const candidate = popupBrowserProfile(tab.id);
      const inherited =
        candidate &&
        candidate.ownerAccountId === scope.identity.accountId &&
        candidate.serverBase === serverBase &&
        (scope.identity.appId === "browser" ||
          (candidate.ownerAppId === scope.identity.appId &&
            providerBelongsToApp(scope.identity.appId, candidate.provider.id) &&
            (!provider ||
              (provider.id === candidate.provider.id &&
                provider.accountId === candidate.provider.accountId))))
          ? candidate
          : undefined;
      if (
        inherited &&
        inherited.ownerAccountId === scope.identity.accountId &&
        inherited.serverBase === serverBase
      ) {
        provider = inherited.provider;
        input = { ...input, url: inherited.url ?? input.url };
      } else if (provider && !providerBelongsToApp(scope.identity.appId, provider.id))
        throw new AppRpcError("provider_denied", "This provider does not belong to this App.");
      if (provider && scope.identity.appId !== "browser") {
        const availability = await this.availability!();
        if (!availability.available)
          throw new AppRpcError("webview_unavailable", availability.reason!);
        if (
          !providerUrlAllowed(provider.id, input.url) &&
          !(inherited?.popupInstanceKey && input.url === "about:blank")
        )
          throw new AppRpcError("provider_denied", "Open this link in a Browser tab.");
      }
      const profileId =
        inherited &&
        inherited.ownerAccountId === scope.identity.accountId &&
        inherited.serverBase === serverBase
          ? inherited.profileId
          : provider
            ? await browserProfileId(
                serverBase,
                scope.identity.accountId,
                scope.identity.appId,
                provider,
              )
            : await (profile ??= browserProfileId(
                serverBase,
                scope.identity.accountId,
                scope.identity.appId,
              ));
      scope.assert();
      if (removingProfiles.has(profileId))
        throw new AppRpcError("account_busy", "This website account is being removed.");
      if (
        inherited?.popupInstanceKey &&
        inherited.ownerAccountId === scope.identity.accountId &&
        inherited.serverBase === serverBase
      ) {
        tab.instanceKey = inherited.popupInstanceKey;
        nativeKeys.set(input.id, inherited.popupInstanceKey);
      }
      const releaseContext = registerSdkBrowserContext(tab.id, nativeId(input.id), input.scopeId);
      const releaseProvider = provider
        ? registerProviderBrowser(nativeId(input.id), {
            originSpaceId: scope.identity.spaceId,
            scopeId: input.scopeId,
            profileId,
            ownerAppId: scope.identity.appId,
            provider,
            ownerAccountId: scope.identity.accountId,
            serverBase,
          })
        : () => {};
      const closeProfileView = () => this.close(input.id);
      const peers = profileViews.get(profileId) ?? new Set<() => Promise<void>>();
      peers.add(closeProfileView);
      profileViews.set(profileId, peers);
      const release = () => {
        peers.delete(closeProfileView);
        if (!peers.size) profileViews.delete(profileId);
        releaseContext();
        releaseProvider();
      };
      records.set(input.id, {
        tab,
        url: input.url,
        profileId,
        provider,
        scopeId: input.scopeId,
        release,
      });
      useBrowserRuntimeStore.getState().ensureHistory(tab.id, input.url);
      await syncBrowserWebview({
        originSpaceId: scope.identity.spaceId,
        tab,
        url: input.url,
        profileId,
        providerId: scope.identity.appId === "browser" ? undefined : provider?.id,
        profileProviderId: provider?.id,
        scopeId: input.scopeId,
        bounds: nativeBounds(constrainBrowserBounds(input.bounds, root)),
        theme: useAppThemeStore.getState().resolvedTheme,
        nativeLiveResize: input.nativeLiveResize,
      });
      if (inherited?.popupInstanceKey) consumePopupBrowserInstance(tab.id);
    },
    async layout(input) {
      const item = record(input.id);
      if (!input.visible) return hideBrowserWebview(item.tab);
      await syncBrowserWebview({
        originSpaceId: scope.identity.spaceId,
        ...item,
        providerId: scope.identity.appId === "browser" ? undefined : item.provider?.id,
        profileProviderId: item.provider?.id,
        bounds: nativeBounds(constrainBrowserBounds(input.bounds, root)),
        theme: useAppThemeStore.getState().resolvedTheme,
        nativeLiveResize: input.nativeLiveResize,
      });
    },
    async navigate(id, url) {
      const item = record(id);
      if (
        scope.identity.appId !== "browser" &&
        item.provider &&
        !providerUrlAllowed(item.provider.id, url)
      )
        throw new AppRpcError(
          "provider_boundary",
          "This link is outside the current provider website.",
        );
      const oauthCallback = item.provider
        ? providerOAuthCallback(item.provider.id, url, serverBase)
        : undefined;
      await nativeRpcBackend.invoke("browser_webview_navigate", {
        request: { id: nativeId(id), url, ...(oauthCallback ? { oauthCallback } : {}) },
      });
      item.url = url;
    },
    back: (id) =>
      nativeRpcBackend.invoke("browser_webview_back", { request: { id: nativeId(id) } }),
    forward: (id) =>
      nativeRpcBackend.invoke("browser_webview_forward", { request: { id: nativeId(id) } }),
    reload: (id) =>
      nativeRpcBackend.invoke("browser_webview_reload", { request: { id: nativeId(id) } }),
    setZoom: async (id, factor) => {
      record(id);
      await nativeRpcBackend.invoke("browser_webview_set_zoom", {
        request: { id: nativeId(id), factor },
      });
    },
    inspect: async (id) =>
      (await performInspectionAction(id, "browser.inspect", {})) as Omit<
        MistyBrowserInspection,
        "documentId"
      >,
    click: async (id, elementRef) => {
      await performInspectionAction(id, "browser.click", { elementRef, expectDownload: false });
    },
    type: async (id, elementRef, text) => {
      await performInspectionAction(id, "browser.type", { elementRef, text });
      return { prepared: true };
    },
    interact: async (id, action) => {
      await performInspectionAction(id, "browser.interact", { action });
      return { attempted: true };
    },
    request: async (id, path) => {
      const item = record(id);
      if (!item.provider)
        throw new AppRpcError(
          "provider_required",
          "Authenticated requests require a provider account view.",
        );
      if (
        !providerUrlAllowed(item.provider.id, item.url) ||
        !browserProviders[item.provider.id].domains.some(
          (domain) =>
            new URL(item.url).hostname === domain ||
            new URL(item.url).hostname.endsWith(`.${domain}`),
        )
      )
        throw new AppRpcError(
          "authentication_required",
          "Finish signing in to this provider first.",
        );
      const origin = new URL(item.url).origin;
      const result = await performInspectionAction(id, "browser.request", { path, origin });
      scope.assert("browser.inspect");
      if (records.get(id) !== item || new URL(item.url).origin !== origin)
        throw new AppRpcError(
          "stale_page",
          "The provider account page changed during the request. Retry in the current account.",
        );
      return result as { status: number; body: string; truncated: boolean };
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
      nativeKeys.delete(id);
    },
    async subscribe(id, listener) {
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
            if (eventId !== nativeId(id)) return;
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
      window.addEventListener(appZoomChangedEvent, resume);
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
        window.removeEventListener(appZoomChangedEvent, resume);
      };
    },
  };
}
