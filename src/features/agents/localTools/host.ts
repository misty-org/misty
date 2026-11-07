import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Runs an agent's tools on this computer. The run asks through
 * native code, which keeps the journal, and this window does the work. Only the window that runs the
 * device's agent jobs listens.
 */

export interface LocalToolRequest {
  runId: string;
  callId: string;
  name: string;
  input: Record<string, unknown>;
  /** Native code's name for this call, which native page work finds its run by. */
  policyCall?: string;
  /** Aborts when the run stops waiting: it was cancelled, or Misty is closing. */
  signal: AbortSignal;
}

/** The call was refused before it could have had any effect, so the model may correct it. */
export class LocalToolRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The call began and nobody can say whether it took effect. The run stops rather than repeat it. */
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

/** What one call answers. An error nobody classified counts as uncertain, the only safe reading. */
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

/** Starts answering calls in this window. Returns how to stop. */
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
        // The run stopped waiting, so nobody needs this answer.
        .catch(() => undefined)
        .finally(() => running.delete(payload.id));
    }),
    webview.listen<{ id: string }>("misty://agent-tool-cancel", ({ payload }) => {
      running.get(payload.id)?.abort(new Error("agent_tool_cancelled"));
    }),
  ];
  // After the listeners, or a call could arrive with nothing listening.
  void Promise.all(stops).then(() => invoke("agent_tool_host_ready"));
  return () => {
    for (const stop of stops) void stop.then((unlisten) => unlisten());
    for (const controller of running.values()) controller.abort(new Error("agent_tool_host_closed"));
    running.clear();
  };
}
