export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpCallResult {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: number };

const PROTOCOL_VERSION = "2025-03-26";
const MAX_PAGES = 10;
const CALL_TIMEOUT_MS = 20 * 60_000;

export class McpRemoteError extends Error {}

export class McpUnreachable extends Error {}

export interface AppMcpClient {
  receive(message: unknown): void;
  listTools(): Promise<McpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  dispose(): void;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export function createAppMcpClient(
  send: (message: unknown) => void,
  options: {
    requestTimeoutMs?: number;
    callTimeoutMs?: number;
    startTimeoutMs?: number;
    retryMs?: number;
    onToolsChanged?: () => void;
  } = {},
): AppMcpClient {
  const {
    requestTimeoutMs = 60_000,
    callTimeoutMs = CALL_TIMEOUT_MS,
    startTimeoutMs = 15_000,
    retryMs = 750,
  } = options;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;
  let ready: Promise<void> | undefined;

  const request = (
    method: string,
    params: unknown,
    timeoutMs = requestTimeoutMs,
    signal?: AbortSignal,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (disposed) return reject(new Error("The app closed."));
      if (signal?.aborted) return reject(new Error("The call was cancelled."));
      const id = nextId++;
      const finish = () => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        pending.delete(id);
      };
      const onAbort = () => {
        finish();
        send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
        reject(new Error("The call was cancelled."));
      };
      const timer = window.setTimeout(() => {
        finish();
        reject(new Error(`The app didn't answer ${method}.`));
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
        timer,
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  const handshake = async () => {
    const deadline = Date.now() + startTimeoutMs;
    for (;;) {
      try {
        await request(
          "initialize",
          {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "misty", version: "1" },
          },
          retryMs * 2,
        );
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        return;
      } catch (error) {
        if (disposed || Date.now() >= deadline) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, retryMs));
      }
    }
  };

  const started = () => {
    if (ready) return ready;
    const attempt = handshake();
    ready = attempt;
    attempt.catch(() => {
      if (ready === attempt) ready = undefined;
    });
    return attempt;
  };

  return {
    receive(message) {
      const body = record(message);
      if (typeof body.method === "string") {
        if (body.id === undefined) {
          if (body.method === "notifications/tools/list_changed") options.onToolsChanged?.();
          return;
        }
        const result =
          body.method === "ping"
            ? { result: {} }
            : { error: { code: -32601, message: "Misty offers no such method." } };
        send({ jsonrpc: "2.0", id: body.id, ...result });
        return;
      }
      if (typeof body.id !== "number") return;
      const call = pending.get(body.id);
      if (!call) return;
      const error = record(body.error);
      if (body.error !== undefined)
        call.reject(
          new McpRemoteError(
            typeof error.message === "string" ? error.message : "The app's server failed.",
          ),
        );
      else call.resolve(body.result);
    },
    async listTools() {
      await started();
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = record(await request("tools/list", cursor ? { cursor } : {}));
        for (const tool of Array.isArray(result.tools) ? result.tools : []) {
          const found = record(tool);
          if (typeof found.name === "string") tools.push(found as unknown as McpTool);
        }
        cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
        if (!cursor) break;
      }
      return tools;
    },
    async callTool(name, args, signal) {
      await started().catch((error: unknown) => {
        throw new McpUnreachable(error instanceof Error ? error.message : String(error));
      });
      return record(
        await request("tools/call", { name, arguments: args }, callTimeoutMs, signal),
      ) as McpCallResult;
    },
    dispose() {
      disposed = true;
      for (const call of pending.values()) {
        window.clearTimeout(call.timer);
        call.reject(new Error("The app closed."));
      }
      pending.clear();
    },
  };
}
