import { retainAppView } from "./appUpdateSafety";
import { createCodeControlsRpc } from "./rpc/codeControls";
import { isMistyCodeControlsMethod } from "@misty/sdk";
import { createAgentsRpc } from "./rpc/agents";
import { isMistyAgentsMethod } from "@misty/sdk";
import { createSocialRpc } from "./rpc/social";
import { isMistySocialMethod } from "@misty/sdk";
import { createLibraryRpc } from "./rpc/library";
import { isMistyLibraryMethod } from "@misty/sdk";
import { createFilesHostRpc } from "./rpc/filesHost";
import { createFilesHostBackend } from "./rpc/filesHostBackend";
import { componentSessionKey } from "./rpc/componentSessions";
import { createCodeLspRpc } from "./rpc/codeLsp";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { createAppSurfaceBridge } from "./rpc/surface";
import { useAiSurfaceAdapter, type AiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { createAppUiRpc } from "./rpc/appUi";
import { createAppUiBackend } from "./rpc/appUiBackend";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  isMistyCodeLspMethod,
  isMistyAppUiMethod,
  isMistyServerMethod,
  isMistyTerminalMethod,
  isMistyBrowserMethod,
  isMistyCollaborationMethod,
  isMistyJournalAssetMethod,
  isMistyAiControlsMethod,
  isMistyMailCacheMethod,
  mistyJournalAssetServerContracts,
  type MistyComponentContext,
} from "@misty/sdk";
import type { OfficialApp, OfficialAppSession } from "@/api/apps";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { AuthUser } from "@/features/auth/authSession";
import {
  accountScopeResetEvent,
  readActiveSavedAccountSession,
} from "@/features/auth/runtimeSession";
import { useAppThemeStore } from "@/features/settings";
import type { WorkspaceTab } from "@/features/workspace/model";
import { decodeNativeAppValue } from "./nativeAppWire";
import { loadDesktopApp } from "./desktopAppLoader";
import { executeAppCapability } from "./appCapabilityGateway";
import { isNativeDeviceMethod, useNativeAppPermissions } from "./useNativeAppPermissions";
import { mountAppComponent } from "./rpc/component";
import { createAppRpcScope, AppRpcError } from "./rpc/session";
import { createServerRpc } from "./rpc/server";
import { createTerminalRpc } from "./rpc/terminal";
import { nativeRpcBackend } from "./rpc/nativeBackend";
import { resolveDeploymentTarget } from "@/api/deployment/api";
import { migrateOfficialAppPreferences } from "./plannerPreferenceMigration";
import { createAppNavigationRegistration } from "./appNavigation";
import { createBrowserRpc } from "./rpc/browser";
import { createBrowserRpcBackend } from "./rpc/browserBackend";
import { createCollaborationRpc } from "./rpc/collaboration";
import { createJournalAssetsRpc } from "./rpc/journalAssets";
import { createAiControlsRpc } from "./rpc/aiControls";
import { createAiControlsBackend } from "./rpc/aiControlsBackend";
import { createMailCacheRpc } from "./rpc/mailCache";
import { createMailCacheBackend } from "./rpc/mailCacheBackend";

interface Props {
  app: OfficialApp;
  session: OfficialAppSession;
  serverBase: string;
  user: AuthUser;
  space?: Space;
  tab?: WorkspaceTab;
  route: string;
  active?: boolean;
  onNavigate: (route: string) => void;
}
const hostMethods = new Set([
  "context.get",
  "navigation.open",
  "navigation.setItems",
  "ui.toast",
  ...["local", "sync"].flatMap((area) =>
    ["get", "set", "delete", "keys"].map((operation) => `storage.${area}.${operation}`),
  ),
]);

/** Trusted signed components run in the host document with an instance-bound SDK. */
export function DownloadedAppSurface(props: Props) {
  const identity = JSON.stringify([
    props.user.id,
    props.serverBase,
    props.app.id,
    props.app.version,
    props.app.desktop.sha256,
    props.session.space_id,
    props.tab?.id,
    [...props.session.scopes].sort(),
  ]);
  return <ComponentInstance key={identity} {...props} />;
}
function ComponentInstance(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instanceId = useRef(props.tab?.id ?? `app-${crypto.randomUUID()}`).current;
  const focused = useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (item) => item.id === state.layout.focusedPaneId,
    );
    return pane?.activeTabId === instanceId;
  });
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [surface, setSurface] = useState<AiSurfaceAdapter | null>(null);
  useAiSurfaceAdapter(surface);
  const permissions = useNativeAppPermissions(props.app.name);
  const current = useRef({ props, permissions });
  current.current = { props, permissions };
  const lifecycle = useRef<ReturnType<typeof mountAppComponent> | null>(null);
  const scopeRef = useRef<ReturnType<typeof createAppRpcScope> | null>(null);
  const context: MistyComponentContext = {
    instanceId,
    route: props.route,
    active: props.active ?? true,
    focused,
    appearance: { mode: theme },
  };
  const latestContext = useRef(context);
  latestContext.current = context;

  useEffect(() => {
    const root = container.current!;
    let releaseView: () => void;
    try { releaseView = retainAppView(props.app.id, instanceId); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wait for the current update to finish.");
      return;
    }
    const scope = createAppRpcScope({
      identity: {
        appId: props.app.id,
        accountId: props.user.id,
        spaceId: props.session.space_id,
        instanceId,
      },
      scopes: props.session.scopes.filter((item) => props.app.scopes.includes(item)),
      expiresAt: props.session.expires_at,
      isCurrentAccount: (accountId) => readActiveSavedAccountSession()?.id === accountId,
    });
    scopeRef.current = scope;
    const terminal = createTerminalRpc(scope, nativeRpcBackend);
    const codeLsp = createCodeLspRpc(scope, nativeRpcBackend);
    const browser = createBrowserRpc(scope, createBrowserRpcBackend(scope, root, props.serverBase));
    const appUi = createAppUiRpc(scope, createAppUiBackend(scope));
    const surfaces = createAppSurfaceBridge(scope, setSurface);
    const aiControls = createAiControlsRpc(scope, createAiControlsBackend(scope, surfaces.read));
    const navigation = createAppNavigationRegistration(scope);
    const server = createServerRpc(scope, {
      serverBase: props.serverBase,
      readAppSession: () => {
        const session = current.current.props.session;
        return { appId: session.app_id, spaceId: session.space_id, token: session.token };
      },
    });
    const collaboration = createCollaborationRpc(scope, {
      ticket: (resource, resourceId, signal) =>
        server.request(
          resource === "note"
            ? { method: "notes.collaboration.ticket", params: { path: { noteID: resourceId } } }
            : {
                method: "drawings.collaboration.ticket",
                params: { path: { drawingID: resourceId } },
              },
          { signal },
        ),
      socket: (url) => new WebSocket(url),
    });
    const journalAssets = createJournalAssetsRpc(scope, server);
    let mailCache: ReturnType<typeof createMailCacheRpc> | undefined;
    let disposed = false;
    let released = false;
    let nativeInstance = "";
    let nativeRegistration: Promise<string> | undefined;
    const closeNative = () => {
      if (!nativeInstance) return;
      const instance = nativeInstance;
      nativeInstance = "";
      void nativeRpcBackend.invoke("mini_app_close", { instance }).catch(() => undefined);
    };
    const deviceInstance = () =>
      (nativeRegistration ??= (async () => {
        const installed =
          await nativeRpcBackend.invoke<Array<{ id: string; root: string; plugin_dir: string }>>(
            "scan_local_plugins",
          );
        scope.assert();
        const record = installed.find((item) => item.id === props.app.id && item.root === "public");
        if (!record)
          throw new AppRpcError("package_missing", "The installed App package is unavailable.");
        const instance = await nativeRpcBackend.invoke<string>("mini_widget_open", {
          request: {
            root: record.plugin_dir,
            owner: { accountId: props.user.id, spaceId: props.session.space_id },
            scopeLimit: current.current.props.session.scopes.filter((item) =>
              props.app.scopes.includes(item),
            ),
          },
        });
        nativeInstance = instance;
        try {
          scope.assert();
        } catch (error) {
          closeNative();
          throw error;
        }
        return instance;
      })().catch((error) => {
        nativeRegistration = undefined;
        throw error;
      }));
    const executeDevice = async (method: string, params?: unknown) => {
      const instance = await deviceInstance();
      scope.assert();
      const result = await current.current.permissions.execute(
        instance,
        method,
        params,
        () => scope.assert(),
        scope.signal,
      );
      scope.assert();
      return decodeNativeAppValue(result);
    };
    const filesHost = createFilesHostRpc(
      scope,
      createFilesHostBackend(scope, {
        serverBase: props.serverBase,
        instance: deviceInstance,
        native: executeDevice,
        root: () => container.current,
        navigate: (route) => current.current.props.onNavigate(route),
      }),
    );
    const codeControls = createCodeControlsRpc(scope);
    const agents = createAgentsRpc(scope, {
      serverBase: props.serverBase,
      token: () => current.current.props.session.token,
    });
    const social = createSocialRpc(scope, {
      serverBase: props.serverBase,
      token: () => current.current.props.session.token,
    });
    const library = createLibraryRpc(scope, {
      serverBase: props.serverBase,
      token: () => current.current.props.session.token,
    });
    const release = () => {
      if (released) return;
      released = true;
      server.close();
      appUi.close();
      surfaces.close();
      aiControls.close();
      navigation.close();
      void terminal.close();
      void codeLsp.close();
      void browser.close();
      collaboration.close();
      journalAssets.close();
      filesHost.close();
      closeNative();
      current.current.permissions.reset();
    };
    const resetAccount = () => scope.close();
    window.addEventListener(accountScopeResetEvent, resetAccount);
    scope.signal.addEventListener(
      "abort",
      () => {
        closeNative();
        if (!disposed)
          setError(
            scope.signal.reason instanceof Error
              ? scope.signal.reason.message
              : "The App session closed.",
          );
      },
      { once: true },
    );
    const transport = {
      registerSurface: surfaces.register,
      async request(message: { method: string; params?: unknown }) {
        scope.assert();
        if (message.method === "lifecycle.ready") return undefined;
        if (isMistyCodeControlsMethod(message.method)) return codeControls.request(message);
        if (isMistyAgentsMethod(message.method)) return agents.request(message);
        if (isMistySocialMethod(message.method)) return social.request(message);
        if (isMistyLibraryMethod(message.method)) return library.request(message);
        if (isMistyAppUiMethod(message.method)) return appUi.request(message);
        if (isMistyCodeLspMethod(message.method)) return codeLsp.request(message);
        if (isMistyTerminalMethod(message.method)) return terminal.request(message);
        if (isMistyBrowserMethod(message.method)) return browser.request(message);
        if (isMistyCollaborationMethod(message.method)) return collaboration.request(message);
        if (isMistyJournalAssetMethod(message.method)) return journalAssets.request(message);
        if (isMistyAiControlsMethod(message.method)) return aiControls.request(message);
        if (isMistyMailCacheMethod(message.method)) {
          mailCache ??= createMailCacheRpc(scope, createMailCacheBackend(props.serverBase));
          return mailCache.request(message);
        }
        if (Object.prototype.hasOwnProperty.call(mistyJournalAssetServerContracts, message.method))
          throw new AppRpcError(
            "host_owned_transfer",
            "Use journal.assets to transfer attachments through this App view.",
          );
        if (
          ["notes.collaboration.ticket", "drawings.collaboration.ticket"].includes(message.method)
        )
          throw new AppRpcError(
            "host_owned_connection",
            "Use collaboration.open for a connection owned by this App view.",
          );
        if (isMistyServerMethod(message.method)) return server.request(message);
        const fileResponse = await filesHost.request(message);
        if (fileResponse.handled) return fileResponse.value;
        if (isNativeDeviceMethod(message.method))
          return executeDevice(message.method, message.params);

        if (!hostMethods.has(message.method))
          throw new AppRpcError(
            "unsupported_method",
            "This App method is not supported by Misty yet.",
          );
        const now = current.current.props;
        return executeAppCapability(
          {
            app: now.app,
            session: now.session,
            serverBase: now.serverBase,
            user: now.user,
            space: now.space,
            tab: now.tab,
            platform: "desktop",
            signal: scope.signal,
            navigate: now.onNavigate,
            setNavigationItems: navigation.setItems,
            showToast: (message) => setNotice(message),
          },
          message.method,
          message.params,
        );
      },
      subscribe: async (topic: string, listener: (event: unknown) => void) =>
        topic === "social"
          ? social.subscribe(listener)
          : topic.startsWith("agents:invocation:")
            ? agents.subscribe(topic, listener)
            : topic === "files:drop"
              ? filesHost.subscribeDrop(listener)
              : topic.startsWith("code-lsp:")
                ? codeLsp.subscribe(topic, listener)
                : topic.startsWith("terminal:")
                  ? terminal.subscribe(topic, listener)
                  : topic.startsWith("browser:")
                    ? browser.subscribe(topic, listener)
                    : topic.startsWith("collaboration:")
                      ? collaboration.subscribe(topic, listener)
                      : topic === "ai"
                        ? aiControls.subscribe(topic, listener)
                        : appUi.subscribe(topic, listener),
    };
    void (async () => {
      try {
        scope.assert();
        if (
          props.session.app_id !== props.app.id ||
          (props.space && props.space.id !== props.session.space_id)
        )
          throw new AppRpcError(
            "session_mismatch",
            "The App session does not match its App and Space.",
          );
        const definition = await loadDesktopApp(props.app);
        scope.assert();
        await migrateOfficialAppPreferences(
          { ...props, platform: "desktop", signal: scope.signal },
          scope,
          resolveDeploymentTarget,
        );
        scope.assert();
        const mounted = mountAppComponent({
          definition,
          sessionKey: componentSessionKey({
            appId: props.app.id,
            accountId: props.user.id,
            spaceId: props.session.space_id ?? "",
            serverBase: props.serverBase,
            packageHash: props.app.desktop.sha256 ?? "",
            scopes: props.session.scopes.filter((item) => props.app.scopes.includes(item)),
          }),
          root,
          context: latestContext.current,
          scope,
          transport,
          release,
        });
        lifecycle.current = mounted;
        await mounted.ready;
        if (!disposed) setReady(true);
      } catch (caught) {
        scope.close();
        release();
        if (!disposed)
          setError(caught instanceof Error ? caught.message : "This App could not be opened.");
      }
    })();
    return () => {
      disposed = true;
      window.removeEventListener(accountScopeResetEvent, resetAccount);
      scope.close();
      const closing = lifecycle.current?.close();
      void Promise.resolve(closing).catch(() => undefined).finally(releaseView);
      lifecycle.current = null;
      release();
    };
    // Identity/grants are encoded in ComponentInstance's key. Refreshes update refs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope || scope.signal.aborted) return;
    try {
      scope.refresh({
        scopes: props.session.scopes.filter((item) => props.app.scopes.includes(item)),
        expiresAt: props.session.expires_at,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The App session expired.");
    }
  }, [props.app.scopes, props.session]);
  useEffect(() => {
    try {
      lifecycle.current?.update(latestContext.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This App could not be updated.");
    }
  }, [props.route, props.active, focused, theme]);
  return (
    <div className="relative h-full min-h-0" data-misty-component-app={props.app.id}>
      <div ref={container} className="h-full min-h-0" />
      {!ready && !error ? (
        <div className="absolute inset-0 grid place-items-center" role="status">
          <LoaderCircle size={22} className="animate-spin text-cream-muted" />
          <span className="sr-only">Opening {props.app.name}</span>
        </div>
      ) : null}
      {error ? (
        <div
          className="absolute inset-0 grid place-items-center bg-charcoal-bg p-6 text-sm text-cream-muted"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {notice ? <div role="status">{notice}</div> : null}
      {permissions.controls}
    </div>
  );
}
