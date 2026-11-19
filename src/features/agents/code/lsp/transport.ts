import type { Transport } from "@codemirror/lsp-client";
import { lspApi } from "./lspApi";

/**
 * The few requests a server makes of its client that CodeMirror's client doesn't answer, each
 * with the plain answer that lets the server carry on with its defaults. CodeMirror's client
 * answers every other request "not implemented".
 */
function localResult(method: string, params: unknown, rootUri: string): { result: unknown } | null {
  switch (method) {
    case "workspace/configuration": {
      // One answer per item asked for; null means "use your defaults".
      const items = (params as { items?: unknown } | null)?.items;
      return { result: Array.isArray(items) ? items.map(() => null) : [] };
    }
    case "workspace/workspaceFolders": {
      const name = decodeURIComponent(rootUri.slice(rootUri.lastIndexOf("/") + 1)) || rootUri;
      return { result: [{ uri: rootUri, name }] };
    }
    // The client can't apply edits to files it doesn't hold, so it declines them.
    case "workspace/applyEdit":
      return { result: { applied: false } };
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
    case "window/showMessageRequest":
    case "workspace/codeLens/refresh":
    case "workspace/semanticTokens/refresh":
    case "workspace/inlayHint/refresh":
    case "workspace/inlineValue/refresh":
    case "workspace/diagnostic/refresh":
      return { result: null };
    default:
      return null;
  }
}

/** The reply to `message` when it is a request answered here, or null. */
function localAnswer(message: string, rootUri: string): string | null {
  // Most messages are answers and notifications; only parse what may be a request.
  if (!message.includes('"method"') || !message.includes('"id"')) return null;
  let value: { id?: unknown; method?: unknown; params?: unknown };
  try {
    value = JSON.parse(message) as typeof value;
  } catch {
    return null;
  }
  if (value.id === undefined || value.id === null || typeof value.method !== "string") return null;
  const answer = localResult(value.method, value.params, rootUri);
  return answer ? JSON.stringify({ jsonrpc: "2.0", id: value.id, ...answer }) : null;
}

/**
 * CodeMirror's transport over Misty's native bridge: the server's messages arrive as window
 * events (routed here by `receive`), and the client's go out through `code_lsp_send`. Sends are
 * queued and go as ordered batches, one call at a time, because separate native calls may run
 * out of order and a server must see edits in the order they were made.
 */
export class ServerTransport implements Transport {
  private readonly id: string;
  private readonly rootUri: string;
  private readonly handlers = new Set<(message: string) => void>();
  private queue: string[] = [];
  private sending = false;
  private closed = false;

  constructor(id: string, rootUri: string) {
    this.id = id;
    this.rootUri = rootUri;
  }

  send(message: string): void {
    if (this.closed) throw new Error("The language server has stopped.");
    this.queue.push(message);
    this.flush();
  }

  subscribe(handler: (message: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (message: string) => void): void {
    this.handlers.delete(handler);
  }

  /** A message from the server. */
  receive(message: string): void {
    if (this.closed) return;
    const answer = localAnswer(message, this.rootUri);
    if (answer) {
      this.queue.push(answer);
      this.flush();
      return;
    }
    for (const handler of this.handlers) handler(message);
  }

  /** The server is gone: nothing more goes out or comes in. */
  close(): void {
    this.closed = true;
    this.queue = [];
    this.handlers.clear();
  }

  private flush(): void {
    if (this.sending || this.closed || this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.sending = true;
    // A failed send means the server ended; its closed event says so.
    void lspApi
      .send(this.id, batch)
      .catch(() => undefined)
      .finally(() => {
        this.sending = false;
        this.flush();
      });
  }
}
