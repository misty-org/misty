export type MistyNotificationLevel = "info" | "success" | "error";

export type MistyWebHost = {
  selectedPaths?: () => Promise<string[]>;
  notify?: (notification: {
    level: MistyNotificationLevel;
    title: string;
    message: string;
    pluginId: string;
  }) => void;
  runCommand?: <T = unknown>(command: string, payload?: Record<string, unknown>) => Promise<T>;
};

type HostRequest = {
  channel: "misty-plugin";
  kind: "request";
  requestId: string;
  pluginId: string;
  command: string;
  payload: Record<string, unknown>;
};

type HostResponse = {
  channel: "misty-host";
  kind: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type HostContextMessage = {
  channel: "misty-host";
  kind: "context";
  pluginId: string;
  selectedPaths: string[];
};

declare global {
  interface Window {
    mistyPluginHost?: MistyWebHost;
  }
}

const pending = new Map<string, {
  resolve: (value: unknown) => void;
  timeout: number;
}>();
const contextListeners = new Set<(paths: string[]) => void>();
let requestSequence = 0;
let currentPluginId = "";

function isHostResponse(value: unknown): value is HostResponse | HostContextMessage {
  return Boolean(value && typeof value === "object" && "channel" in value && value.channel === "misty-host");
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || !isHostResponse(event.data)) return;
  if (event.data.kind === "context") {
    if (event.data.pluginId !== currentPluginId || !Array.isArray(event.data.selectedPaths)) return;
    const paths = event.data.selectedPaths.filter((path): path is string => typeof path === "string");
    contextListeners.forEach((listener) => listener(paths));
    return;
  }
  const waiter = pending.get(event.data.requestId);
  if (!waiter) return;
  window.clearTimeout(waiter.timeout);
  pending.delete(event.data.requestId);
  waiter.resolve(event.data.ok
    ? event.data.result
    : { ok: false, message: event.data.error ?? "Misty could not complete the extension command." });
});

export function configurePluginBridge(pluginId: string) {
  currentPluginId = pluginId;
}

export function isHostedPlugin() {
  return new URLSearchParams(window.location.search).get("hosted") === "1" || window.parent !== window;
}

function querySelectedPaths() {
  const params = new URLSearchParams(window.location.search);
  return params
    .getAll("selected")
    .flatMap((value) => value.split("\n"))
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function readSelectedPathsFromHost() {
  if (window.mistyPluginHost?.selectedPaths) return window.mistyPluginHost.selectedPaths();
  if (isHostedPlugin()) {
    const result = await runHostCommand<{ ok?: boolean; selectedPaths?: string[] }>("host.selectedPaths");
    if (Array.isArray(result.selectedPaths)) return result.selectedPaths;
  }
  return querySelectedPaths();
}

export function subscribeHostContext(listener: (paths: string[]) => void) {
  contextListeners.add(listener);
  return () => { contextListeners.delete(listener); };
}

export function publishHostNotification(
  pluginId: string,
  level: MistyNotificationLevel,
  title: string,
  message: string,
) {
  if (window.mistyPluginHost?.notify) {
    window.mistyPluginHost.notify({ level, title, message, pluginId });
    return;
  }
  if (isHostedPlugin()) {
    void runHostCommand("host.notify", { level, title, message });
    return;
  }
  window.dispatchEvent(new CustomEvent("misty:plugin-notification", {
    detail: { level, title, message, pluginId },
  }));
}

export async function runHostCommand<T = unknown>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (window.mistyPluginHost?.runCommand) return window.mistyPluginHost.runCommand<T>(command, payload);
  if (!isHostedPlugin() || window.parent === window) {
    return {
      ok: false,
      command,
      payload,
      message: "Open this extension inside Misty to use system features.",
    } as T;
  }

  const requestId = `${Date.now().toString(36)}-${++requestSequence}`;
  const request: HostRequest = {
    channel: "misty-plugin",
    kind: "request",
    requestId,
    pluginId: currentPluginId,
    command,
    payload,
  };
  return new Promise<T>((resolve) => {
    const timeout = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, message: "Misty did not respond to the extension command." } as T);
    }, 30_000);
    pending.set(requestId, { resolve: (value) => resolve(value as T), timeout });
    window.parent.postMessage(request, "*");
  });
}
