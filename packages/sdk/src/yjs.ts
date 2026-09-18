import { WebsocketProvider } from "y-partyserver/provider";
import type { Doc } from "yjs";
import type { MistyCollaborationResource, MistyCollaborationResult } from "@misty/contracts";
import type { MistyCollaborationSDK } from "./collaboration.js";
import { createCollaborationWebSocket } from "./collaboration-socket.js";

/** Journal's Yjs provider uses leased host RPC; it never sees a join ticket or server URL. */
export async function connectMistyYjs(sdk: MistyCollaborationSDK, options: {
  resource: MistyCollaborationResource;
  resourceId: string;
  doc: Doc;
  signal: AbortSignal;
  onRole?(role: MistyCollaborationResult<"collaboration.open">["role"]): void;
}) {
  if (options.signal.aborted) throw new Error("Collaboration session is closed.");
  const lease = await sdk.open({ resource: options.resource, resourceId: options.resourceId });
  if (options.signal.aborted) {
    await sdk.close(lease.handle).catch(() => undefined);
    throw new Error("Collaboration session closed while joining.");
  }
  const lifetime = new AbortController();
  const Socket = createCollaborationWebSocket(sdk, { ...options, signal: lifetime.signal, initial: lease });
  let provider: WebsocketProvider | undefined;
  let destroyProvider: (() => void) | undefined;
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    options.signal.removeEventListener("abort", destroy);
    // Stop the provider's reconnect policy before closing its leased socket.
    destroyProvider?.();
    lifetime.abort();
    Socket.dispose();
  };
  try {
    const party = options.resource === "note" ? "note-room" : "drawing-room";
    provider = new WebsocketProvider(`wss://misty-sdk.invalid/parties/${party}`, options.resourceId, options.doc, {
      connect: false, disableBc: true, WebSocketPolyfill: Socket,
    });
    destroyProvider = provider.destroy.bind(provider);
    provider.destroy = destroy;
    options.signal.addEventListener("abort", destroy, { once: true });
    provider.connect();
    return { provider, role: lease.role, destroy };
  } catch (error) { destroy(); throw error; }
}
