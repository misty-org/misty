export interface LspMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}
export interface CodeLspTransport {
  start(language: string, cwd: string): Promise<string>;
  send(sessionId: string, message: LspMessage): Promise<void>;
  stop(sessionId: string): Promise<void>;
  subscribe(
    sessionId: string,
    message: (message: LspMessage) => void,
    exited: (reason: string) => void,
  ): Promise<() => void>;
}
type Handler = (message: LspMessage) => void;
interface PendingRequest {
  resolve(message: LspMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** One view-owned protocol client. The native or SDK transport is supplied by its owner. */
export class LspClient {
  private sessionId: string | null = null;
  private unlisten: (() => void) | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private handlers = new Set<Handler>();
  private startPromise: Promise<void> | null = null;
  private ready = false;
  private lifetime = new AbortController();
  private stopped = new Map<string, Promise<void>>();
  private readonly onAbort = () => {
    void this.dispose().catch(() => undefined);
  };

  constructor(
    readonly language: string,
    readonly cwd: string,
    private readonly transport: CodeLspTransport,
    private readonly options: { signal?: AbortSignal; requestTimeoutMs?: number } = {},
  ) {
    options.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (options.signal?.aborted) this.onAbort();
  }
  onMessage(handler: Handler): () => void {
    this.assertOpen();
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  private assertOpen() {
    if (this.lifetime.signal.aborted) throw new Error("This Code language-server view is closed.");
  }
  private whileOpen<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("This Code language-server view is closed."));
      this.lifetime.signal.addEventListener("abort", abort, { once: true });
      if (this.lifetime.signal.aborted) abort();
      operation.then(
        (value) => {
          this.lifetime.signal.removeEventListener("abort", abort);
          if (!this.lifetime.signal.aborted) resolve(value);
        },
        (error) => {
          this.lifetime.signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }
  ensureStarted(): Promise<void> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.ready) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start().catch(async (error) => {
      await this.dispose().catch(() => undefined);
      throw error;
    });
    return this.startPromise;
  }
  private async start() {
    const sessionId = await this.whileOpen(
      this.transport.start(this.language, this.cwd).then(async (id) => {
        if (this.lifetime.signal.aborted) {
          await this.stopOwned(id).catch(() => undefined);
          this.assertOpen();
        }
        this.sessionId = id;
        return id;
      }),
    );
    await this.whileOpen(
      this.transport
        .subscribe(
          sessionId,
          (message) => this.receive(message),
          (reason) => {
            this.failAll(new Error(reason || "The language server stopped."));
            void this.dispose().catch(() => undefined);
          },
        )
        .then((remove) => {
          if (this.lifetime.signal.aborted) remove();
          else this.unlisten = remove;
        }),
    );
    await this.requestRaw("initialize", {
      processId: null,
      rootUri: pathToUri(this.cwd),
      workspaceFolders: [{ uri: pathToUri(this.cwd), name: "workspace" }],
      capabilities: CAPABILITIES,
    });
    this.assertOpen();
    await this.whileOpen(
      this.transport.send(sessionId, { jsonrpc: "2.0", method: "initialized", params: {} }),
    );
    this.ready = true;
  }
  private receive(message: LspMessage) {
    if (this.lifetime.signal.aborted || message.jsonrpc !== "2.0") return;
    if (typeof message.id === "number" && !message.method && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }
    for (const handler of this.handlers) handler(message);
  }
  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  private async requestRaw<T>(method: string, params: unknown): Promise<T> {
    this.assertOpen();
    const sessionId = this.sessionId;
    if (!sessionId) throw new Error("Language server is not started.");
    if (this.pending.size >= 128) throw new Error("Too many pending language-server requests.");
    const id = this.nextRequestId++;
    const message = await new Promise<LspMessage>((resolve, reject) => {
      const fail = (error: Error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error(`Language-server request timed out: ${method}`)),
        this.options.requestTimeoutMs ?? 15000,
      );
      this.pending.set(id, { resolve, reject, timer });
      void Promise.resolve()
        .then(() => {
          this.assertOpen();
          return this.transport.send(sessionId, { jsonrpc: "2.0", id, method, params });
        })
        .catch((error) =>
          fail(error instanceof Error ? error : new Error("The language-server request failed.")),
        );
    });
    this.assertOpen();
    if (message.error) throw new Error(message.error.message);
    return message.result as T;
  }
  isStarting(): boolean {
    return Boolean(this.startPromise && !this.ready && !this.lifetime.signal.aborted);
  }
  isRunning(): boolean {
    return this.ready && !this.lifetime.signal.aborted;
  }
  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ensureStarted();
    return this.requestRaw<T>(method, params);
  }
  async notify(method: string, params: unknown): Promise<void> {
    await this.ensureStarted();
    this.assertOpen();
    await this.whileOpen(this.transport.send(this.sessionId!, { jsonrpc: "2.0", method, params }));
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
    await this.notify("textDocument/didClose", { textDocument: { uri: pathToUri(path) } });
  }
  private stopOwned(id: string): Promise<void> {
    let pending = this.stopped.get(id);
    if (!pending) {
      pending = Promise.resolve().then(() => this.transport.stop(id));
      this.stopped.set(id, pending);
    }
    return pending;
  }
  async dispose(): Promise<void> {
    this.options.signal?.removeEventListener("abort", this.onAbort);
    this.lifetime.abort();
    this.ready = false;
    this.failAll(new Error("This Code language-server view is closed."));
    const remove = this.unlisten;
    this.unlisten = null;
    this.handlers.clear();
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      remove?.();
    } finally {
      if (sessionId) await this.stopOwned(sessionId);
    }
  }
}
export function pathToUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  try {
    const parsed = new URL(uri);
    if (parsed.hostname && parsed.hostname !== "localhost") return uri;
    return decodeURIComponent(parsed.pathname);
  } catch {
    return uri.slice("file://".length);
  }
}
const CAPABILITIES = {
  textDocument: {
    synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
    publishDiagnostics: { relatedInformation: true },
    hover: { contentFormat: ["markdown", "plaintext"] },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ["markdown", "plaintext"],
      },
    },
    definition: { linkSupport: false },
    typeDefinition: { linkSupport: false },
    implementation: { linkSupport: false },
    references: {},
    rename: { prepareSupport: true },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: { valueSet: ["", "quickfix", "refactor", "source"] },
      },
    },
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
      },
    },
    inlayHint: { dynamicRegistration: false },
    documentHighlight: {},
  },
  workspace: { workspaceEdit: { documentChanges: true } },
};
