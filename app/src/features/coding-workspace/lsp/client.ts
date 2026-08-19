import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { codeLspSend, codeLspStart, codeLspStop } from "../native";

type Handler = (message: LspMessage) => void;

export interface LspMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export class LspClient {
  private sessionId: string | null = null;
  private unlisten: UnlistenFn | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, (message: LspMessage) => void>();
  private handlers = new Set<Handler>();
  private startPromise: Promise<void> | null = null;
  private starting = false;

  constructor(
    readonly language: string,
    readonly cwd: string,
  ) {}

  onMessage(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async ensureStarted(): Promise<void> {
    if (this.sessionId) return;
    if (this.startPromise) return this.startPromise;
    this.starting = true;
    this.startPromise = (async () => {
      const sessionId = await codeLspStart(this.language, this.cwd);
      this.sessionId = sessionId;
      this.unlisten = await listen<{ sessionId: string; payload: string }>(
        "misty://code-lsp-message",
        ({ payload }) => {
          if (payload.sessionId !== sessionId) return;
          try {
            const message = JSON.parse(payload.payload) as LspMessage;
            if (typeof message.id === "number" && this.pending.has(message.id)) {
              const resolve = this.pending.get(message.id);
              this.pending.delete(message.id);
              resolve?.(message);
              return;
            }
            for (const handler of this.handlers) handler(message);
          } catch {
            /* ignore malformed payloads */
          }
        },
      );
      await this.send({
        jsonrpc: "2.0",
        id: this.nextRequestId++,
        method: "initialize",
        params: {
          processId: null,
          rootUri: pathToUri(this.cwd),
          workspaceFolders: [{ uri: pathToUri(this.cwd), name: "workspace" }],
          capabilities: {
            textDocument: {
              synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
              publishDiagnostics: { relatedInformation: true },
              hover: { contentFormat: ["markdown", "plaintext"] },
              completion: {
                completionItem: {
                  snippetSupport: false,
                  documentationFormat: ["markdown", "plaintext"],
                },
              },
              definition: { linkSupport: false },
            },
          },
        },
      });
      this.notify("initialized", {});
    })();
    try {
      await this.startPromise;
    } finally {
      this.starting = false;
    }
  }

  isStarting(): boolean {
    return this.starting;
  }

  isRunning(): boolean {
    return this.sessionId !== null;
  }

  private async send(message: LspMessage): Promise<void> {
    if (!this.sessionId) throw new Error("LSP session not started");
    await codeLspSend(this.sessionId, JSON.stringify(message));
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ensureStarted();
    const id = this.nextRequestId++;
    const pending = new Promise<LspMessage>((resolve) => {
      this.pending.set(id, resolve);
    });
    await this.send({ jsonrpc: "2.0", id, method, params });
    const response = await pending;
    if (response.error) throw new Error(response.error.message);
    return response.result as T;
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.ensureStarted();
    await this.send({ jsonrpc: "2.0", method, params });
  }

  async didOpen(path: string, languageId: string, text: string, version = 1): Promise<void> {
    await this.notify("textDocument/didOpen", {
      textDocument: { uri: pathToUri(path), languageId, version, text },
    });
  }

  async didChange(path: string, text: string, version: number): Promise<void> {
    await this.notify("textDocument/didChange", {
      textDocument: { uri: pathToUri(path), version },
      contentChanges: [{ text }],
    });
  }

  async didClose(path: string): Promise<void> {
    await this.notify("textDocument/didClose", {
      textDocument: { uri: pathToUri(path) },
    });
  }

  async dispose(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.handlers.clear();
    this.pending.clear();
    if (sessionId) await codeLspStop(sessionId);
  }
}

export function pathToUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return `file://${encodeURI(path).replace(/#/g, "%23")}`;
}

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  try {
    return decodeURI(uri.replace("file://", ""));
  } catch {
    return uri.replace("file://", "");
  }
}
