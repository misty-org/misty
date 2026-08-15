export type MistyNotificationLevel = "info" | "success" | "error";
import type { ThemeSnapshot } from "./plugins/types";

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

type HostReady = {
  channel: "misty-plugin";
  kind: "ready";
  pluginId: string;
  protocolVersion: 1;
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
  theme?: ThemeSnapshot;
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
export type HostedContext = { selectedPaths: string[]; theme: ThemeSnapshot };

export const fallbackTheme: ThemeSnapshot = {
  themeId: "misty-dark", mode: "dark", revision: 0,
  tokens: {
    background: "#181818", surface: "#111418", surfaceRaised: "#1a1f26", surfaceHover: "#22272f",
    border: "#2a3038", borderStrong: "#3b424d", text: "#f1f3f4", textMuted: "#a7abb3",
    textSubtle: "#747a84", primary: "#dbe2e8", primaryContrast: "#0b0d10", accent: "#7dd3fc",
    focus: "#7dd3fc", selection: "rgba(125, 211, 252, .24)", success: "#22c55e",
    warning: "#eab308", danger: "#ef4444", info: "#38bdf8", shadow: "rgba(0,0,0,.38)",
  },
};

const contextListeners = new Set<(context: HostedContext) => void>();
let requestSequence = 0;
let currentPluginId = "";

function isHostResponse(value: unknown): value is HostResponse | HostContextMessage {
  return Boolean(value && typeof value === "object" && "channel" in value && value.channel === "misty-host");
}

if (typeof window !== "undefined") window.addEventListener("message", (event) => {
  if (event.source !== window.parent || !isHostResponse(event.data)) return;
  if (event.data.kind === "context") {
    if (event.data.pluginId !== currentPluginId || !Array.isArray(event.data.selectedPaths)) return;
    const paths = event.data.selectedPaths.filter((path): path is string => typeof path === "string");
    const theme = validThemeSnapshot(event.data.theme) ? event.data.theme : fallbackTheme;
    contextListeners.forEach((listener) => listener({ selectedPaths: paths, theme }));
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

export function pluginReadyMessage(pluginId: string): HostReady {
  return {
    channel: "misty-plugin",
    kind: "ready",
    pluginId,
    protocolVersion: 1,
  };
}

export function configurePluginBridge(pluginId: string) {
  currentPluginId = pluginId;
  if (isHostedPlugin() && window.parent !== window) {
    window.parent.postMessage(pluginReadyMessage(pluginId), "*");
  }
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

export function subscribeHostContext(listener: (context: HostedContext) => void) {
  contextListeners.add(listener);
  return () => { contextListeners.delete(listener); };
}

function validThemeSnapshot(value: unknown): value is ThemeSnapshot {
  return Boolean(value && typeof value === "object" && "themeId" in value && "mode" in value && "revision" in value && "tokens" in value);
}

export function applyThemeSnapshot(theme: ThemeSnapshot) {
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  root.dataset.mistyTheme = theme.themeId;
  root.style.colorScheme = theme.mode;
  const names: Record<string, string> = {
    background: "bg", surface: "surface", surfaceRaised: "surface-2", surfaceHover: "surface-hover",
    border: "border", borderStrong: "border-strong", text: "text", textMuted: "text-muted",
    textSubtle: "text-subtle", primary: "primary", primaryContrast: "primary-contrast", accent: "accent",
    focus: "focus", selection: "selection", success: "success", warning: "warning", danger: "danger",
    info: "info", shadow: "shadow",
  };
  Object.entries(theme.tokens).forEach(([key, value]) => root.style.setProperty(`--misty-${names[key] ?? key}`, value));
}

export function standalonePreviewTheme(params: URLSearchParams): ThemeSnapshot {
  const mode = params.get("previewMode") === "light" ? "light" : "dark";
  const themeId = params.get("previewTheme")?.slice(0, 64) || fallbackTheme.themeId;
  let overrides: Record<string, unknown> = {};
  try { overrides = JSON.parse(params.get("previewTokens") ?? "{}"); } catch { overrides = {}; }
  const tokens = { ...fallbackTheme.tokens };
  for (const key of Object.keys(tokens) as Array<keyof typeof tokens>) {
    const value = overrides[key]; if (typeof value === "string" && value.length <= 80) tokens[key] = value;
  }
  return { themeId, mode, revision: 0, tokens };
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
