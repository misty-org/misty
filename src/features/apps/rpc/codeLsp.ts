import { createLspProjectPaths } from "./lspProjectPaths";
import {
  isMistyCodeLspMethod,
  mistyCodeLspContracts,
  MistyLspEventSchema,
  type MistyLspEvent,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";
import type { TerminalRpcBackend } from "./terminal";

export interface CodeLspProjectLease {
  /** Host-resolved path from a live owned directory, never an app-supplied native path. */
  nativeRoot: string;
  signal: AbortSignal;
  release(): void | Promise<void>;
}
interface Process {
  paths?: ReturnType<typeof createLspProjectPaths>;
  project?: CodeLspProjectLease;
  removeProjectListener?: () => void;
  stopping?: Promise<void>;
  nativeId: string;
  exited: boolean;
  listeners: Set<(event: MistyLspEvent) => void>;
  pending: MistyLspEvent[];
  bytes: number;
}
const MAX_BUFFER = 8 * 1024 * 1024;
const encoder = new TextEncoder();
/** The executing App owns every process, handle, event subscription and pending startup. */
export function createCodeLspRpc(
  scope: AppRpcScope,
  backend: TerminalRpcBackend,
  options: {
    /** The integrating host must resolve this through its owned folder grants. */
    resolveProject?(virtualRoot: string, signal: AbortSignal): Promise<CodeLspProjectLease>;
  } = {},
) {
  const processes = new Map<string, Process>();
  const early = new Map<string, MistyLspEvent[]>();
  let earlyBytes = 0;
  let overflow = false;
  let starting = 0;
  let closed = false;
  let initialization: Promise<void> | undefined;
  let removals: (() => void)[] = [];
  const assert = () => {
    scope.assert("code.execute");
    if (closed) throw new AppRpcError("app_closed", "The Code language-server runtime is closed.");
  };
  const stop = (nativeId: string) => backend.invoke("code_lsp_stop", { sessionId: nativeId });
  const stopProcess = (process: Process) => {
    process.removeProjectListener?.();
    return (process.stopping ??= stop(process.nativeId)
      .then(() => undefined)
      .finally(async () => {
        await process.project?.release();
      }));
  };
  const bytes = (event: MistyLspEvent) =>
    event.type === "message" ? encoder.encode(event.payload).byteLength : 128;
  const notify = (process: Process, event: MistyLspEvent) => {
    for (const listener of process.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Code language-server subscriber failed", error);
      }
    }
  };
  const deliver = (process: Process, event: MistyLspEvent) => {
    if (process.exited) return;
    if (event.type === "message" && process.paths) {
      try {
        event = {
          type: "message",
          payload: JSON.stringify(process.paths.toApp(JSON.parse(event.payload))),
        };
      } catch {
        event = {
          type: "exit",
          reason: "The language server returned an invalid document location.",
        };
        void stopProcess(process).catch(() => undefined);
      }
    }
    if (event.type === "exit") process.exited = true;
    if (process.listeners.size) {
      notify(process, event);
      return;
    }
    process.bytes += bytes(event);
    if (process.bytes > MAX_BUFFER || process.pending.length >= 256) {
      process.exited = true;
      process.pending = [
        { type: "exit", reason: "Language-server output exceeded this view's buffer." },
      ];
      process.bytes = 128;
      void stopProcess(process).catch(() => undefined);
    } else process.pending.push(event);
  };
  function receive(payload: unknown, type: "message" | "exit") {
    try {
      assert();
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const native = payload as { sessionId?: unknown; payload?: unknown; reason?: unknown };
    if (typeof native.sessionId !== "string" || native.sessionId.length > 256) return;
    const parsed = MistyLspEventSchema.safeParse(
      type === "message" ? { type, payload: native.payload } : { type, reason: native.reason },
    );
    if (!parsed.success) return;
    const process = [...processes.values()].find((item) => item.nativeId === native.sessionId);
    if (process) {
      deliver(process, parsed.data);
      return;
    }
    if (!starting || overflow) return;
    const queue = early.get(native.sessionId) ?? [];
    earlyBytes += bytes(parsed.data);
    if (earlyBytes > MAX_BUFFER || early.size >= 64 || queue.length >= 256) {
      overflow = true;
      early.clear();
      return;
    }
    queue.push(parsed.data);
    early.set(native.sessionId, queue);
  }
  async function initialize() {
    initialization ??= (async () => {
      const results = await Promise.allSettled([
        backend.listen("misty://code-lsp-message", (value) => receive(value, "message")),
        backend.listen("misty://code-lsp-exit", (value) => receive(value, "exit")),
      ]);
      const success = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failure = results.find((result) => result.status === "rejected");
      if (closed || failure) {
        success.forEach((remove) => remove());
        throw failure?.reason ?? new AppRpcError("app_closed", "The Code view closed.");
      }
      removals = success;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    assert();
  }
  const owned = (handle: string) => {
    const process = processes.get(handle);
    if (!process)
      throw new AppRpcError(
        "resource_denied",
        "This language server belongs to another view or has closed.",
      );
    return process;
  };
  async function request(message: { method: string; params?: unknown }): Promise<unknown> {
    assert();
    if (!isMistyCodeLspMethod(message.method))
      throw new AppRpcError("unsupported_method", "Unknown Code language-server method.");
    if (message.method === "code.lsp.start") {
      const input = mistyCodeLspContracts[message.method].params.parse(message.params);
      if (processes.size + starting >= 8)
        throw new AppRpcError(
          "resource_limit",
          "This Code view already has eight language servers.",
        );
      starting++;
      let nativeId: string | undefined;
      let project: CodeLspProjectLease | undefined;
      try {
        await initialize();
        if (options.resolveProject) {
          scope.assert("files.read");
          project = await options.resolveProject(input.cwd, scope.signal);
          assert();
          if (project.signal.aborted)
            throw new AppRpcError(
              "resource_closed",
              "The Code project closed while starting its language server.",
            );
        }
        const paths = project ? createLspProjectPaths(input.cwd, project.nativeRoot) : undefined;
        nativeId = await backend.invoke<string>("code_lsp_start", {
          request: { ...input, cwd: project?.nativeRoot ?? input.cwd },
        });
        assert();
        if (!nativeId || typeof nativeId !== "string")
          throw new AppRpcError("invalid_response", "Language-server startup returned no process.");
        if (project?.signal.aborted)
          throw new AppRpcError(
            "resource_closed",
            "The Code project closed while starting its language server.",
          );
        if (overflow)
          throw new AppRpcError(
            "resource_limit",
            "Language-server startup output exceeded its buffer.",
          );
        const handle = crypto.randomUUID();
        const process: Process = {
          nativeId,
          paths,
          project,
          exited: false,
          listeners: new Set(),
          pending: [],
          bytes: 0,
        };
        processes.set(handle, process);
        if (project) {
          const abortProject = () => {
            deliver(process, {
              type: "exit",
              reason: "The Code project access closed or was revoked.",
            });
            void stopProcess(process).catch(() => undefined);
          };
          project.signal.addEventListener("abort", abortProject, { once: true });
          process.removeProjectListener = () =>
            project!.signal.removeEventListener("abort", abortProject);
        }
        for (const event of early.get(nativeId) ?? []) deliver(process, event);
        early.delete(nativeId);
        return { handle };
      } catch (error) {
        if (typeof nativeId === "string" && nativeId) await stop(nativeId).catch(() => undefined);
        await project?.release();
        throw error;
      } finally {
        starting--;
        if (!starting) {
          early.clear();
          earlyBytes = 0;
          overflow = false;
        }
      }
    }
    if (message.method === "code.lsp.stop") {
      const { handle } = mistyCodeLspContracts[message.method].params.parse(message.params);
      const process = owned(handle);
      processes.delete(handle);
      process.listeners.clear();
      process.pending.length = 0;
      await stopProcess(process);
      return;
    }
    const input = mistyCodeLspContracts[message.method].params.parse(message.params);
    const process = owned(input.handle);
    if (process.exited) throw new AppRpcError("resource_closed", "The language server has exited.");
    const payload = process.paths
      ? JSON.stringify(process.paths.toNative(JSON.parse(input.payload)))
      : input.payload;
    await backend.invoke("code_lsp_send", { sessionId: process.nativeId, payload });
    assert();
  }
  const runtime = {
    request,
    async subscribe(topic: string, listener: (event: unknown) => void) {
      assert();
      if (!topic.startsWith("code-lsp:"))
        throw new AppRpcError("unsupported_event", "Unknown Code event topic.");
      const process = owned(topic.slice("code-lsp:".length));
      process.listeners.add(listener);
      const pending = process.pending.splice(0);
      process.bytes = 0;
      try {
        for (const event of pending) {
          assert();
          listener(event);
        }
      } catch (error) {
        process.listeners.delete(listener);
        throw error;
      }
      return () => {
        process.listeners.delete(listener);
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      scope.signal.removeEventListener("abort", abort);
      removals.forEach((remove) => remove());
      removals = [];
      const owned = [...processes.values()];
      processes.clear();
      early.clear();
      owned.forEach((process) => {
        process.listeners.clear();
        process.pending.length = 0;
      });
      await Promise.allSettled(owned.map(stopProcess));
    },
  };
  const abort = () => {
    void runtime.close();
  };
  scope.signal.addEventListener("abort", abort, { once: true });
  if (scope.signal.aborted) abort();
  return runtime;
}
