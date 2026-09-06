import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MistyTerminalEvent, MistyTerminalSDK } from "@misty/sdk";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { reportSystemError } from "@/features/activity/systemActivity";
import type { TerminalServices } from "./terminalServices";

// Transitional embedded Host renderer only. Downloaded components receive the
// scoped SDK from their mount input and must never import this module.
const listeners = new Map<string, (event: MistyTerminalEvent) => void>();
const pending = new Map<string, MistyTerminalEvent[]>();
const owned = new Set<string>();
let unlisten: Array<() => void> = [];
let listening: Promise<unknown> | undefined;
let creating = 0;
let bufferedBytes = 0;
function discardPending(id: string) {
  const events = pending.get(id) ?? [];
  pending.delete(id);
  for (const event of events) bufferedBytes -= event.type === "output" ? event.data.length * 2 : 64;
  return events;
}
function releaseListenersIfIdle() {
  if (owned.size || creating) return;
  unlisten.forEach((remove) => remove());
  unlisten = [];
  listening = undefined;
  pending.clear();
  bufferedBytes = 0;
}
function receive(id: string, event: MistyTerminalEvent) {
  const listener = listeners.get(id);
  if (listener) listener(event);
  else if ((creating || owned.has(id)) && bufferedBytes < 1024 * 1024) {
    const events = pending.get(id) ?? [];
    events.push(event);
    pending.set(id, events);
    bufferedBytes += event.type === "output" ? event.data.length * 2 : 64;
  }
}
async function ensureListeners() {
  listening ??= Promise.allSettled([
    listen<{ sessionId: string; data: string }>("misty://terminal-output", ({ payload }) =>
      receive(payload.sessionId, { type: "output", data: payload.data }),
    ),
    listen<{ sessionId: string; exitCode?: number }>("misty://terminal-exit", ({ payload }) =>
      receive(payload.sessionId, { type: "exit", exitCode: payload.exitCode ?? null }),
    ),
  ]).then((results) => {
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      results.forEach((result) => {
        if (result.status === "fulfilled") result.value();
      });
      listening = undefined;
      throw failed.reason;
    }
    unlisten = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  });
  await listening;
}
const terminal: MistyTerminalSDK = {
  async create(options = {}) {
    creating++;
    try {
      await ensureListeners();
      const handle = await invoke<string>("terminal_create", {
        request: { ...options, cwd: options.cwd ?? null, env: options.env ?? {} },
      });
      owned.add(handle);
      if (!pending.has(handle)) pending.set(handle, []);
      return { handle };
    } finally {
      creating--;
      if (!creating) for (const id of pending.keys()) if (!owned.has(id)) discardPending(id);
      releaseListenersIfIdle();
    }
  },
  write: (sessionId, data) => invoke("terminal_write", { sessionId, data }),
  resize: (sessionId, size) => invoke("terminal_resize", { sessionId, ...size }),
  close: async (sessionId) => {
    listeners.delete(sessionId);
    owned.delete(sessionId);
    discardPending(sessionId);
    releaseListenersIfIdle();
    await invoke("terminal_kill", { sessionId });
  },
  async subscribe(handle, listener) {
    if (!owned.has(handle)) throw new Error("The terminal session is closed.");
    await ensureListeners();
    if (!owned.has(handle)) throw new Error("The terminal session is closed.");
    listeners.set(handle, listener);
    const events = discardPending(handle);
    for (const event of events) {
      listener(event);
    }
    return () => {
      if (listeners.get(handle) === listener) listeners.delete(handle);
    };
  },
  environments: () => invoke("terminal_ssh_environments"),
  preflight: (connection) => invoke("terminal_ssh_preflight", { connection }),
  trustHost: (connection, fingerprint) =>
    invoke("terminal_ssh_trust_host", { request: { connection, fingerprint } }),
};
export const terminalHostServices: TerminalServices = {
  terminal,
  clipboard: {
    readText: () => navigator.clipboard.readText(),
    writeText: (text) => navigator.clipboard.writeText(text),
  },
  openExternal: openSystemExternalLink,
  reportError: (error) => {
    reportSystemError({
      error,
      scope: "terminal:session",
      title: "Terminal session is unavailable",
    });
  },
};
