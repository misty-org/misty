import { configureApiSession } from "@/api/client/session";
import { configureOfficialAppRuntimeApiBase } from "@/api/deployment/api";
import { PointerDragProvider } from "@/features/dnd";
import { useSpacesStore } from "@/features/spaces/store/useSpacesStore";
import { dockTabs, useWorkspaceStore } from "@/features/workspace";
import type { WorkspaceDockNode, WorkspaceTab } from "@/features/workspace/model";
import { createRoot, type Root } from "react-dom/client";
import { PackageRouter } from "./PackageRouter";
import { takeSelectedFile } from "./selectedFiles";
import type {
  OfficialAppPackageDefinition,
  OfficialAppPackageMount,
  OfficialAppPackageMountProps,
} from "./types";
import { configureOfficialAppAuthRuntime, OfficialAppAuthProvider } from "./auth";
import { configureOfficialAppSettings } from "./settings";
import { useAppThemeStore } from "@/features/settings";
import { packageSessionIdentity, retainSnapshot } from "./sessionState";
import "@/styles/styles.css";
import "@/styles/mobile.css";

type OfficialAppRenderer = (props: OfficialAppPackageMountProps) => React.ReactNode;

const sessions = new Map<string, OfficialAppPackageMountProps["session"]>();
let generation = 0;
let currentUser: OfficialAppPackageMountProps["user"] | null = null;
let currentSessionIdentity = "";

configureApiSession({
  isTransitioning: () => false,
  readGeneration: () => generation,
  readToken: async () => null,
  requestCredentials: () => "omit",
});
configureOfficialAppAuthRuntime({
  generation: () => generation,
  session: () => sessions.values().next().value,
  user: () => currentUser,
});

export function registerOfficialAppPackage(appId: string, renderApp: OfficialAppRenderer): void {
  const definition = {
    appId,
    mount: (element, initialProps) => mountPackageRoot(element, initialProps, renderApp),
  } satisfies OfficialAppPackageDefinition;
  registerSandboxBridge(definition);
}

const sandboxMounts = new Map<string, OfficialAppPackageMount>();
let sandboxBridgeRegistered = false;

function registerSandboxBridge(definition: OfficialAppPackageDefinition) {
  if (window.parent === window || sandboxBridgeRegistered) return;
  sandboxBridgeRegistered = true;
  const parameters = new URL(window.location.href).searchParams;
  const instanceId = parameters.get("mistyAppInstance") ?? "";
  const expectedAppId = parameters.get("mistyAppId") ?? "";
  if (!instanceId || expectedAppId !== definition.appId) {
    throw new Error("Misty App runtime identity is missing or invalid.");
  }
  installOfficialAppFetchBridge();
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (receiveHostResponse(event.data)) return;
    const message = event.data as {
      type?: string;
      protocol?: number;
      appId?: string;
      instanceId?: string;
      props?: OfficialAppPackageMountProps;
    };
    if (
      message.type !== "misty:app-host-update" ||
      message.protocol !== 2 ||
      message.appId !== definition.appId ||
      message.instanceId !== instanceId ||
      !message.props ||
      message.props.instanceId !== instanceId
    )
      return;
    try {
      const root = document.getElementById("misty-app-root");
      if (!root) throw new Error("The App root is unavailable.");
      const props: OfficialAppPackageMountProps = {
        ...message.props,
        onWorkspaceTabChange: (tab) =>
          window.parent.postMessage(
            {
              type: "misty:app-tab-change",
              protocol: 2,
              appId: definition.appId,
              instanceId,
              tab,
            },
            "*",
          ),
      };
      const mounted = sandboxMounts.get(instanceId);
      if (mounted) mounted.update(props);
      else sandboxMounts.set(instanceId, definition.mount(root, props));
    } catch (error) {
      window.parent.postMessage(
        {
          type: "misty:app-error",
          protocol: 2,
          appId: definition.appId,
          instanceId,
          message: error instanceof Error ? error.message : String(error),
        },
        "*",
      );
    }
  });
  window.parent.postMessage(
    { type: "misty:app-ready", protocol: 2, appId: definition.appId, instanceId },
    "*",
  );
}

function mountPackageRoot(
  element: HTMLElement,
  initialProps: OfficialAppPackageMountProps,
  renderApp: OfficialAppRenderer,
): OfficialAppPackageMount {
  const root = createRoot(element, {
    onUncaughtError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      window.parent.postMessage(
        {
          type: "misty:app-error",
          protocol: 2,
          appId: initialProps.session.appId,
          instanceId: initialProps.instanceId,
          message: message.includes("Minified React error #185")
            ? "This App hit a repeated update loop. Close and reopen it to retry."
            : message,
        },
        "*",
      );
      console.error(error);
    },
  });
  let current = initialProps;
  let lastWorkspaceTab = workspaceTabFingerprint(initialProps.tab);
  let applyingHostTab = false;
  const synchronizeHostTab = (props: OfficialAppPackageMountProps) => {
    applyingHostTab = true;
    synchronizeWorkspaceTab(props);
    lastWorkspaceTab = workspaceTabFingerprint(props.tab);
    applyingHostTab = false;
  };
  synchronizeHostTab(initialProps);
  const unsubscribeWorkspace = useWorkspaceStore.subscribe((state) => {
    if (applyingHostTab) return;
    const tabId = current.tab?.id;
    if (!tabId || !current.onWorkspaceTabChange) return;
    const next = dockTabs(state.layout.root).find((tab) => tab.id === tabId);
    const fingerprint = workspaceTabFingerprint(next);
    if (!next || fingerprint === lastWorkspaceTab) return;
    lastWorkspaceTab = fingerprint;
    current.onWorkspaceTabChange(next);
  });
  const render = (props: OfficialAppPackageMountProps) => {
    current = {
      ...props,
      user: retainSnapshot(current.user, props.user),
      space: retainSnapshot(current.space, props.space),
      settingsDocument: retainSnapshot(current.settingsDocument, props.settingsDocument),
    };
    synchronizeHostTab(props);
    prepareRuntime(current);
    root.render(
      <PackageProviders
        props={{
          ...current,
          onWorkspaceTabChange: (tab) => {
            // A route change must reach the local tab store before title/state
            // effects run, or their next message can restore the previous route.
            current = { ...current, tab };
            synchronizeHostTab(current);
            current.onWorkspaceTabChange?.(tab);
          },
        }}
        renderApp={renderApp}
      />,
    );
  };
  render(initialProps);
  return {
    update: render,
    unmount: () => {
      unsubscribeWorkspace();
      removeWorkspaceTab(current.tab?.id);
      releaseRuntime(current.instanceId, root);
    },
  };
}

function synchronizeWorkspaceTab(props: OfficialAppPackageMountProps) {
  if (!props.tab) return;
  const state = useWorkspaceStore.getState();
  const existing = dockTabs(state.layout.root).find((tab) => tab.id === props.tab?.id);
  if (existing) {
    if (workspaceTabFingerprint(existing) === workspaceTabFingerprint(props.tab)) return;
    useWorkspaceStore.setState({
      layout: {
        ...state.layout,
        root: mapWorkspaceTabs(state.layout.root, (tab) =>
          tab.id === props.tab?.id ? props.tab! : tab,
        ),
      },
    });
    return;
  }
  const paneId = firstPaneId(state.layout.root) || `package-pane:${props.instanceId}`;
  const root = dockTabs(state.layout.root).length
    ? appendWorkspaceTab(state.layout.root, props.tab)
    : { type: "leaf" as const, id: paneId, tabs: [props.tab], activeTabId: props.tab.id };
  useWorkspaceStore.setState({
    layout: { root, focusedPaneId: state.layout.focusedPaneId || paneId },
  });
}

function removeWorkspaceTab(tabId: string | undefined) {
  if (!tabId) return;
  const state = useWorkspaceStore.getState();
  useWorkspaceStore.setState({
    layout: { ...state.layout, root: removeTabFromWorkspace(state.layout.root, tabId) },
  });
}

function mapWorkspaceTabs(
  node: WorkspaceDockNode,
  update: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceDockNode {
  if (node.type === "leaf") return { ...node, tabs: node.tabs.map(update) };
  return {
    ...node,
    first: mapWorkspaceTabs(node.first, update),
    second: mapWorkspaceTabs(node.second, update),
  };
}

function appendWorkspaceTab(node: WorkspaceDockNode, tab: WorkspaceTab): WorkspaceDockNode {
  if (node.type === "leaf") {
    return { ...node, tabs: [...node.tabs, tab], activeTabId: tab.id };
  }
  return { ...node, first: appendWorkspaceTab(node.first, tab) };
}

function removeTabFromWorkspace(node: WorkspaceDockNode, tabId: string): WorkspaceDockNode {
  if (node.type === "leaf") {
    const tabs = node.tabs.filter((tab) => tab.id !== tabId);
    return {
      ...node,
      tabs,
      activeTabId:
        node.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : node.activeTabId,
    };
  }
  return {
    ...node,
    first: removeTabFromWorkspace(node.first, tabId),
    second: removeTabFromWorkspace(node.second, tabId),
  };
}

function firstPaneId(node: WorkspaceDockNode): string {
  return node.type === "leaf" ? node.id : firstPaneId(node.first);
}

function workspaceTabFingerprint(tab: OfficialAppPackageMountProps["tab"]): string {
  if (!tab) return "";
  try {
    return JSON.stringify([tab.id, tab.title, tab.route, tab.state]);
  } catch {
    return `${tab.id}:${tab.title}:${tab.route}`;
  }
}

function PackageProviders(props: {
  props: OfficialAppPackageMountProps;
  renderApp: OfficialAppRenderer;
}) {
  return (
    <OfficialAppAuthProvider user={props.props.user}>
      <PointerDragProvider>
        <PackageRouter props={props.props} renderApp={props.renderApp} />
      </PointerDragProvider>
    </OfficialAppAuthProvider>
  );
}

function prepareRuntime(props: OfficialAppPackageMountProps) {
  sessions.set(props.instanceId, props.session);
  currentUser = props.user;
  const identity = packageSessionIdentity(props);
  if (identity !== currentSessionIdentity) {
    currentSessionIdentity = identity;
    generation += 1;
  }
  configureOfficialAppRuntimeApiBase(officialAppSdkOrigin);
  configureOfficialAppSettings(props.settingsDocument);
  if (useAppThemeStore.getState().resolvedTheme !== props.resolvedTheme) {
    useAppThemeStore.getState().setResolvedTheme(props.resolvedTheme);
  }
  document.documentElement.dataset.formFactor = props.platform;
  if (props.space && useSpacesStore.getState().spaces[0] !== props.space) {
    useSpacesStore.setState({
      spaces: [props.space],
      snapshotReady: true,
      loading: false,
      error: null,
    });
  }
}

function releaseRuntime(instanceId: string, root: Root) {
  sessions.delete(instanceId);
  if (sessions.size === 0) currentUser = null;
  generation += 1;
  root.unmount();
}

const officialAppSdkOrigin = "https://misty-sdk.local";
const pendingHostRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }
>();

function callHost<T>(method: string, params: unknown): Promise<T> {
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingHostRequests.delete(requestId);
      reject(new Error("The Misty SDK request timed out."));
    }, 30_000);
    pendingHostRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
    window.parent.postMessage(
      { type: "misty:app-rpc", protocol: 2, requestId, method, params },
      "*",
    );
  });
}

function receiveHostResponse(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const response = value as {
    type?: string;
    protocol?: number;
    requestId?: string;
    ok?: boolean;
    result?: unknown;
    error?: { message?: string };
  };
  if (
    response.type !== "misty:app-rpc-response" ||
    response.protocol !== 2 ||
    typeof response.requestId !== "string"
  ) {
    return false;
  }
  const pending = pendingHostRequests.get(response.requestId);
  if (!pending) return true;
  window.clearTimeout(pending.timer);
  pendingHostRequests.delete(response.requestId);
  if (response.ok) pending.resolve(response.result);
  else pending.reject(new Error(response.error?.message || "Misty denied the SDK request."));
  return true;
}

function installOfficialAppFetchBridge() {
  const browserFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === officialAppSdkOrigin && url.pathname.startsWith("/__selected-files/")) {
      const file = takeSelectedFile(url.href);
      if (!file) throw new Error("Choose the file again to use it in this App.");
      return new Response(file, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          "content-length": String(file.size),
        },
      });
    }
    if (url.protocol === "blob:" || url.protocol === "data:") return browserFetch(request);
    if (url.origin !== officialAppSdkOrigin) {
      throw new Error("Misty Apps can access network services only through @misty/sdk.");
    }
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const response = await callHost<{
      status: number;
      statusText: string;
      headers: [string, string][];
      body: ArrayBuffer;
    }>("official.http", {
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: [...request.headers.entries()],
      body,
    });
    return new Response([204, 205, 304].includes(response.status) ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
