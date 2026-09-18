import {
  MISTY_COLLABORATION_SEND_BYTES,
  type MistyCollaborationResource,
  type MistyCollaborationResult,
} from "@misty/contracts";
import type { MistyCollaborationSDK } from "./collaboration.js";

type Lease = MistyCollaborationResult<"collaboration.open">;
/** A WebSocket-compatible Yjs transport. The URL argument never opens a network connection. */
export function createCollaborationWebSocket(sdk: MistyCollaborationSDK, options: {
  resource: MistyCollaborationResource;
  resourceId: string;
  signal: AbortSignal;
  initial?: Lease;
  onRole?(role: Lease["role"]): void;
}): typeof WebSocket & { dispose(): void } {
  let disposed = false;
  let initial = options.initial;
  const sockets = new Set<CollaborationSocket>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.signal.removeEventListener("abort", dispose);
    for (const socket of sockets) socket.close();
    if (initial) { void sdk.close(initial.handle).catch(() => undefined); initial = undefined; }
  };
  class CollaborationSocket extends EventTarget implements WebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static dispose = dispose;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readonly extensions = "";
    readonly protocol = "";
    binaryType: BinaryType = "arraybuffer";
    readyState: number = 0;
    bufferedAmount = 0;
    onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
    onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
    onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
    onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
    private handle?: string;
    private unlisten?: () => void;
    private queue = Promise.resolve();
    constructor(url: string | URL, _protocols?: string | string[]) {
      super();
      this.url = String(url);
      sockets.add(this);
      if (disposed || options.signal.aborted) {
        queueMicrotask(() => this.finish(1000, "App connection closed"));
        return;
      }
      const lease = initial;
      initial = undefined;
      void this.open(lease).catch(() => {
        if (this.readyState >= this.CLOSING) return;
        this.dispatchEvent(new Event("error"));
        this.finish(1006, "Collaboration connection failed");
      });
    }
    private async open(initialLease?: Lease) {
      const lease = initialLease ?? await sdk.open({ resource: options.resource, resourceId: options.resourceId });
      this.handle = lease.handle;
      if (this.readyState >= this.CLOSING || disposed || options.signal.aborted) {
        void sdk.close(lease.handle).catch(() => undefined);
        this.finish(1000, "App connection closed");
        return;
      }
      options.onRole?.(lease.role);
      const remove = await sdk.subscribe(lease.handle, event => {
        if (this.readyState >= this.CLOSING) return;
        switch (event.type) {
          case "open":
            if (this.readyState !== this.CONNECTING) return;
            this.readyState = this.OPEN;
            this.dispatchEvent(new Event("open"));
            break;
          case "binary": {
            const bytes = Uint8Array.from(atob(event.data), character => character.charCodeAt(0));
            this.dispatchEvent(new MessageEvent("message", { data: this.binaryType === "blob" ? new Blob([bytes]) : bytes.buffer }));
            break;
          }
          case "text": this.dispatchEvent(new MessageEvent("message", { data: event.data })); break;
          case "error": this.dispatchEvent(new Event("error")); break;
          case "close": this.finish(event.code, event.reason); break;
        }
      });
      if (this.readyState >= this.CLOSING || disposed) remove(); else this.unlisten = remove;
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== this.OPEN) throw new Error("Collaboration connection is not open.");
      if (typeof data === "string") throw new TypeError("Journal collaboration accepts binary Yjs frames.");
      const size = data instanceof Blob ? data.size : data.byteLength;
      if (size > MISTY_COLLABORATION_SEND_BYTES || this.bufferedAmount + size > 2 * MISTY_COLLABORATION_SEND_BYTES)
        throw new Error("Collaboration update exceeds the send buffer limit.");
      // Snapshot mutable buffers immediately, matching WebSocket.send behavior.
      const copy = data instanceof Blob ? data : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
        : new Uint8Array(data).slice();
      this.bufferedAmount += size;
      this.queue = this.queue.then(async () => {
        try {
          if (this.readyState !== this.OPEN || !this.handle) return;
          const bytes = copy instanceof Blob ? new Uint8Array(await copy.arrayBuffer()) : copy;
          if (this.readyState !== this.OPEN) return;
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000)
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          await sdk.send(this.handle, btoa(binary));
        } finally { this.bufferedAmount = Math.max(0, this.bufferedAmount - size); }
      }).catch(() => {
        if (this.readyState < this.CLOSING) {
          this.dispatchEvent(new Event("error"));
          this.finish(1006, "Collaboration send failed");
        }
      });
    }
    close(_code?: number, _reason?: string) { this.finish(1000, "App connection closed"); }
    private finish(code: number, reason: string) {
      if (this.readyState === this.CLOSED) return;
      this.readyState = this.CLOSED;
      sockets.delete(this);
      this.unlisten?.(); this.unlisten = undefined;
      if (this.handle) void sdk.close(this.handle).catch(() => undefined);
      const event = typeof CloseEvent === "function" ? new CloseEvent("close", { code, reason, wasClean: code === 1000 })
        : Object.assign(new Event("close"), { code, reason, wasClean: code === 1000 });
      this.dispatchEvent(event);
    }
    override dispatchEvent(event: Event) {
      const result = super.dispatchEvent(event);
      if (event.type === "open") this.onopen?.call(this, event);
      else if (event.type === "error") this.onerror?.call(this, event);
      else if (event.type === "close") this.onclose?.call(this, event as CloseEvent);
      else if (event.type === "message") this.onmessage?.call(this, event as MessageEvent);
      return result;
    }
  }
  if (options.signal.aborted) dispose();
  else options.signal.addEventListener("abort", dispose, { once: true });
  return CollaborationSocket;
}
