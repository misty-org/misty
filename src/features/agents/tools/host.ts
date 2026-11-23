import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface LocalToolRequest {
  runId: string;
  callId: string;
  name: string;
  input: Record<string, unknown>;
  policyCall?: string;
  signal: AbortSignal;
}

export class LocalToolRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class LocalToolUncertain extends Error {}

export type LocalToolHandler = (request: LocalToolRequest) => Promise<unknown>;

type Answer =
  | { state: "done"; result: unknown }
  | { state: "failed"; code: string; message: string }
  | { state: "uncertain"; message: string };

const handlers = new Map<string, LocalToolHandler>();

export function registerLocalTools(tools: Record<string, LocalToolHandler>) {
  for (const [name, handler] of Object.entries(tools)) handlers.set(name, handler);
}

export function unregisterLocalTools(names: string[]) {
  for (const name of names) handlers.delete(name);
}

interface Asked {
  id: string;
  run_id: string;
  call_id: string;
  name: string;
  input: unknown;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export async function answerFor(
  asked: Pick<Asked, "run_id" | "call_id" | "name" | "input"> & { id?: string },
  signal: AbortSignal,
): Promise<Answer> {
  const handler = handlers.get(asked.name);
  if (!handler) {
    return {
      state: "failed",
      code: "tool_unavailable",
      message: "That tool is not available on this computer.",
    };
  }
  try {
    const result = await handler({
      runId: asked.run_id,
      callId: asked.call_id,
      name: asked.name,
      input: asRecord(asked.input),
      policyCall: asked.id,
      signal,
    });
    return { state: "done", result: result ?? {} };
  } catch (error) {
    if (error instanceof LocalToolRejected) {
      return { state: "failed", code: error.code, message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { state: "uncertain", message };
  }
}

export function startLocalToolHost(): () => void {
  if (!hasTauriInternals()) return () => undefined;
  const running = new Map<string, AbortController>();
  const webview = getCurrentWebview();
  const stops = [
    webview.listen<Asked>("misty://agent-tool-call", ({ payload }) => {
      const controller = new AbortController();
      running.set(payload.id, controller);
      void answerFor(payload, controller.signal)
        .then((answer) => invoke("agent_tool_finish", { id: payload.id, answer }))
        .catch(() => undefined)
        .finally(() => running.delete(payload.id));
    }),
    webview.listen<{ id: string }>("misty://agent-tool-cancel", ({ payload }) => {
      running.get(payload.id)?.abort(new Error("agent_tool_cancelled"));
    }),
  ];
  void Promise.all(stops).then(() => invoke("agent_tool_host_ready"));
  return () => {
    for (const stop of stops) void stop.then((unlisten) => unlisten());
    for (const controller of running.values())
      controller.abort(new Error("agent_tool_host_closed"));
    running.clear();
  };
}
