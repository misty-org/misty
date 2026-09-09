import { isMistyTerminalMethod, parseTerminalParams } from "@misty/sdk";
import { AppRpcError, rpcInteger, rpcRecord, rpcString, type AppRpcScope } from "./session";

export interface TerminalRpcBackend {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen(event: string, listener: (payload: unknown) => void): Promise<() => void>;
}
type TerminalEvent = { type: "output"; data: string } | { type: "exit"; exitCode: number | null };
interface OwnedTerminal {
  nativeId: string;
  listeners: Set<(event: TerminalEvent) => void>;
  pending: TerminalEvent[];
  bytes: number;
  exited: boolean;
}
const maximumBufferBytes = 1024 * 1024;

/** Native ids and native event channels remain private to this mounted App. */
export function createTerminalRpc(scope: AppRpcScope, backend: TerminalRpcBackend) {
  const terminals = new Map<string, OwnedTerminal>();
  const creatingEvents = new Map<string, TerminalEvent[]>();
  let creating = 0;
  let creatingBytes = 0;
  let closed = false;
  let initialization: Promise<void> | undefined;
  let unlisten: (() => void)[] = [];
  const assert = () => {
    scope.assert("terminal.execute");
    if (closed) throw new AppRpcError("app_closed", "The terminal runtime has closed.");
  };
  function deliver(terminal: OwnedTerminal, event: TerminalEvent) {
    if (event.type === "exit") terminal.exited = true;
    if (terminal.listeners.size) {
      for (const listener of terminal.listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("App terminal subscriber failed", error);
        }
      }
    } else {
      terminal.pending.push(event);
      terminal.bytes += event.type === "output" ? event.data.length * 2 : 0;
      while (terminal.bytes > maximumBufferBytes && terminal.pending.length > 1) {
        const removed = terminal.pending.shift()!;
        terminal.bytes -= removed.type === "output" ? removed.data.length * 2 : 0;
      }
    }
  }
  function receive(payload: unknown, type: TerminalEvent["type"]) {
    try {
      assert();
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const item = payload as { sessionId?: unknown; data?: unknown; exitCode?: unknown };
    if (typeof item.sessionId !== "string") return;
    if (type === "output" && typeof item.data !== "string") return;
    const event: TerminalEvent =
      type === "output"
        ? { type, data: item.data as string }
        : { type, exitCode: typeof item.exitCode === "number" ? item.exitCode : null };
    const owned = [...terminals.values()].find((terminal) => terminal.nativeId === item.sessionId);
    if (owned) deliver(owned, event);
    // Listeners are installed before create. Keep bounded early output until
    // Rust returns the new session id, then transfer only that session's events.
    else if (creating > 0 && creatingBytes < maximumBufferBytes && creatingEvents.size < 128) {
      const pending = creatingEvents.get(item.sessionId) ?? [];
      if (pending.length >= 4096) return;
      pending.push(event);
      creatingEvents.set(item.sessionId, pending);
      creatingBytes += event.type === "output" ? event.data.length * 2 : 64;
    }
  }
  async function initialize() {
    if (!initialization)
      initialization = (async () => {
        const results = await Promise.allSettled([
          backend.listen("misty://terminal-output", (payload) => receive(payload, "output")),
          backend.listen("misty://terminal-exit", (payload) => receive(payload, "exit")),
        ]);
        const success = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        if (closed || results.some((result) => result.status === "rejected")) {
          success.forEach((remove) => remove());
          const failure = results.find((result) => result.status === "rejected");
          throw (
            failure?.reason ?? new AppRpcError("app_closed", "The terminal runtime has closed.")
          );
        }
        unlisten = success;
      })().catch((error) => {
        initialization = undefined;
        throw error;
      });
    await initialization;
    assert();
  }
  function owned(input: Record<string, unknown>) {
    const handle = rpcString(input.handle, 128);
    const terminal = terminals.get(handle);
    if (!terminal)
      throw new AppRpcError(
        "resource_denied",
        "This terminal does not belong to this App instance.",
      );
    return { handle, terminal };
  }
  async function request(message: { method: string; params?: unknown }): Promise<unknown> {
    assert();
    if (!isMistyTerminalMethod(message.method))
      throw new AppRpcError("unsupported_method", "Unknown terminal SDK method.");
    const input = parseTerminalParams(message.method, message.params) as Record<string, unknown>;
    if (message.method === "terminal.create") {
      const request = createParameters(input);
      await initialize();
      creating += 1;
      let nativeId: string | undefined;
      try {
        nativeId = await backend.invoke<string>("terminal_create", { request });
        assert();
        if (typeof nativeId !== "string" || !nativeId)
          throw new AppRpcError(
            "invalid_response",
            "Native terminal creation returned no session.",
          );
        const handle = crypto.randomUUID();
        const terminal: OwnedTerminal = {
          nativeId,
          listeners: new Set(),
          pending: [],
          bytes: 0,
          exited: false,
        };
        terminals.set(handle, terminal);
        for (const event of creatingEvents.get(nativeId) ?? []) deliver(terminal, event);
        creatingEvents.delete(nativeId);
        return { handle };
      } catch (error) {
        if (nativeId)
          await backend.invoke("terminal_kill", { sessionId: nativeId }).catch(() => undefined);
        throw error;
      } finally {
        creating -= 1;
        if (!creating) {
          creatingEvents.clear();
          creatingBytes = 0;
        }
      }
    }
    if (message.method === "terminal.environments") {
      const result = await backend.invoke<Record<string, unknown>[]>("terminal_ssh_environments");
      assert();
      return result.map(
        ({ configPath: _privateConfigPath, ...publicEnvironment }) => publicEnvironment,
      );
    }
    if (message.method === "terminal.preflight" || message.method === "terminal.trustHost") {
      const connection = sshConnection(input.connection);
      const result =
        message.method === "terminal.preflight"
          ? await backend.invoke("terminal_ssh_preflight", { connection })
          : await backend.invoke("terminal_ssh_trust_host", {
              request: { connection, fingerprint: rpcString(input.fingerprint, 256) },
            });
      assert();
      return result;
    }
    const { handle, terminal } = owned(input);
    if (message.method === "terminal.close") {
      terminals.delete(handle);
      terminal.listeners.clear();
      await backend.invoke("terminal_kill", { sessionId: terminal.nativeId });
      return;
    }
    if (terminal.exited)
      throw new AppRpcError("resource_closed", "The terminal process has exited.");
    const result =
      message.method === "terminal.write"
        ? await backend.invoke("terminal_write", {
            sessionId: terminal.nativeId,
            data: terminalInput(input.data),
          })
        : await backend.invoke("terminal_resize", {
            sessionId: terminal.nativeId,
            ...sizeParameters(input, true),
          });
    assert();
    return result;
  }
  const runtime = {
    request,
    async subscribe(topic: string, listener: (event: unknown) => void) {
      assert();
      if (!topic.startsWith("terminal:"))
        throw new AppRpcError("unsupported_event", "Unknown terminal event topic.");
      const { terminal } = owned({ handle: topic.slice("terminal:".length) });
      terminal.listeners.add(listener);
      const pending = terminal.pending.splice(0);
      terminal.bytes = 0;
      try {
        for (const event of pending) {
          assert();
          listener(event);
        }
      } catch (error) {
        terminal.listeners.delete(listener);
        throw error;
      }
      return () => {
        terminal.listeners.delete(listener);
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      unlisten.forEach((remove) => remove());
      unlisten = [];
      const owned = [...terminals.values()];
      terminals.clear();
      creatingEvents.clear();
      owned.forEach((terminal) => terminal.listeners.clear());
      await Promise.allSettled(
        owned.map((terminal) => backend.invoke("terminal_kill", { sessionId: terminal.nativeId })),
      );
    },
  };
  scope.signal.addEventListener(
    "abort",
    () => {
      void runtime.close();
    },
    { once: true },
  );
  if (scope.signal.aborted) void runtime.close();
  return runtime;
}

function sizeParameters(input: Record<string, unknown>, required = false) {
  const output: Record<string, number> = {};
  for (const field of ["cols", "rows", "pixelWidth", "pixelHeight"]) {
    if (input[field] == null && !(required && (field === "cols" || field === "rows"))) continue;
    output[field] = rpcInteger(input[field], field === "cols" || field === "rows" ? 2 : 0, 65535);
  }
  return output;
}
function sshConnection(value: unknown) {
  const input = rpcRecord(value);
  if (input.kind === "configured") return { kind: "configured", id: rpcString(input.id, 256) };
  if (input.kind !== "direct")
    throw new AppRpcError("invalid_params", "Invalid SSH connection type.");
  return {
    kind: "direct",
    host: rpcString(input.host, 253),
    ...(input.user == null ? {} : { user: rpcString(input.user, 128) }),
    port: rpcInteger(input.port, 1, 65535),
  };
}
function createParameters(input: Record<string, unknown>) {
  let environment: unknown;
  if (input.environment != null) {
    const item = rpcRecord(input.environment);
    if (item.kind === "local") environment = { kind: "local" };
    else if (item.kind === "ssh")
      environment = { kind: "ssh", connection: sshConnection(item.connection) };
    else throw new AppRpcError("invalid_params", "Invalid terminal environment.");
  }
  const env = input.env == null ? {} : rpcRecord(input.env);
  if (Object.keys(env).length > 128)
    throw new AppRpcError("invalid_params", "Too many terminal environment variables.");
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))
      throw new AppRpcError("invalid_params", "Invalid environment variable name.");
    rpcString(value, 32768, true);
  }
  return {
    ...sizeParameters(input),
    ...(input.cwd == null ? {} : { cwd: rpcString(input.cwd) }),
    env,
    ...(environment ? { environment } : {}),
  };
}

function terminalInput(value: unknown): string {
  if (typeof value !== "string" || value.length > maximumBufferBytes)
    throw new AppRpcError("invalid_params", "Invalid terminal input.");
  // Control bytes (including Ctrl-Space/NUL) are valid terminal input.
  return value;
}
