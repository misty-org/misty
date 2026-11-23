import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { LocalToolRejected } from "@/features/agents";
import type { LocalToolHandler } from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";

interface Asked {
  id: string;
  run_id: string;
  call_id: string;
  name: string;
  input: unknown;
  instance?: string;
}

type Answer =
  | { state: "done"; result: unknown }
  | { state: "failed"; code: string; message: string }
  | { state: "uncertain"; message: string };

const instances = new Map<string, Map<string, LocalToolHandler>>();
const standby = new Map<string, LocalToolHandler>();

export function registerAppTools(instance: string, tools: Record<string, LocalToolHandler>) {
  instances.set(instance, new Map(Object.entries(tools)));
}

export function unregisterAppTools(instance: string) {
  instances.delete(instance);
}

export function registerStandbyTools(tools: Record<string, LocalToolHandler>) {
  for (const [name, handler] of Object.entries(tools)) standby.set(name, handler);
}

export function unregisterStandbyTools(names: string[]) {
  for (const name of names) standby.delete(name);
}

const inputOf = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

export async function answerAppCall(asked: Asked, signal: AbortSignal): Promise<Answer> {
  const handler = asked.instance
    ? instances.get(asked.instance)?.get(asked.name)
    : standby.get(asked.name);
  if (!handler)
    return {
      state: "failed",
      code: "tool_unavailable",
      message: "That app isn't open here anymore, so nothing was done.",
    };
  try {
    const result = await handler({
      runId: asked.run_id,
      callId: asked.call_id,
      name: asked.name,
      input: inputOf(asked.input),
      policyCall: asked.id,
      signal,
    });
    return { state: "done", result: result ?? {} };
  } catch (error) {
    if (error instanceof LocalToolRejected)
      return { state: "failed", code: error.code, message: error.message };
    return { state: "uncertain", message: error instanceof Error ? error.message : String(error) };
  }
}

export function acknowledge(id: string): Promise<boolean> {
  return invoke("agent_tool_finish", { id, answer: { state: "received" } }).then(
    () => true,
    () => false,
  );
}

let serving = 0;
let stopServer: (() => void) | undefined;

function startServer(): () => void {
  const running = new Map<string, AbortController>();
  const webview = getCurrentWebview();
  const stops = [
    webview.listen<Asked>("misty://agent-app-tool-call", ({ payload }) => {
      const controller = new AbortController();
      running.set(payload.id, controller);
      void acknowledge(payload.id)
        .then(async (accepted) => {
          if (!accepted || controller.signal.aborted) return;
          const answer = await answerAppCall(payload, controller.signal);
          await invoke("agent_tool_finish", { id: payload.id, answer });
        })
        .catch(() => undefined)
        .finally(() => running.delete(payload.id));
    }),
    webview.listen<{ id: string }>("misty://agent-tool-cancel", ({ payload }) => {
      running.get(payload.id)?.abort(new Error("agent_tool_cancelled"));
    }),
  ];
  return () => {
    for (const stop of stops) void stop.then((unlisten) => unlisten());
    for (const controller of running.values())
      controller.abort(new Error("agent_tool_host_closed"));
    running.clear();
  };
}

export function serveAppTools(): () => void {
  if (!hasTauriInternals()) return () => undefined;
  serving += 1;
  stopServer ??= startServer();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    serving -= 1;
    if (serving > 0) return;
    stopServer?.();
    stopServer = undefined;
  };
}
