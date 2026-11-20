import { HostError, INIT_MESSAGE, PROTOCOL_VERSION, toWireError } from "./protocol";
import type { Frame } from "./protocol";

export type Unsubscribe = () => void;

/** What the host does for an app. A call that isn't supported throws `HostError("unsupported", …)`. */
export interface HostHandlers {
  call(method: string, params: unknown): Promise<unknown>;
  /** Starts a subscription. It sends the current value first, then each change, through `emit`. */
  subscribe(topic: string, params: unknown, emit: (data: unknown) => void): Unsubscribe;
  /** One JSON-RPC message the app's MCP server sent. */
  mcp?(message: unknown): void;
}

/** Native's check of a call before it runs. It rejects with the reason when the app may not. */
export type Authorize = (kind: "call" | "subscribe", name: string) => Promise<void>;

/** The window a frame's content runs in; only `postMessage` is used. */
export interface FrameTarget {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

export interface HostChannel {
  /** Hands the app its end of the channel. Call it when the frame has loaded. */
  start(): void;
  /** Sends one JSON-RPC message to the app's MCP server. */
  sendMcp(message: unknown): void;
  /** Ends every subscription and closes the channel. Safe to call twice. */
  dispose(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The host's end of the SDK channel for one running app. Every call and subscription is authorized by
 * native code before a handler sees it, and a frame that isn't well formed is dropped.
 */
export function createHostChannel(options: {
  frame: FrameTarget;
  authorize: Authorize;
  handlers: HostHandlers;
  /** Called once, when the app first sends anything: proof it started and reached the channel. */
  onActivity?: () => void;
}): HostChannel {
  const { frame, authorize, handlers, onActivity } = options;
  let active = false;
  const channel = new MessageChannel();
  const port = channel.port1;
  const subscriptions = new Map<number, Unsubscribe>();
  /** Subscriptions waiting on native's check, and the ones the app ended while they waited. */
  const pending = new Set<number>();
  const endedEarly = new Set<number>();
  let disposed = false;
  let started = false;

  const send = (message: Frame) => {
    if (!disposed) port.postMessage(message);
  };
  const fail = (id: number, error: unknown) =>
    send({ t: "res", id, ok: false, error: toWireError(error) });
  const deny = (error: unknown): HostError =>
    new HostError("permission_denied", error instanceof Error ? error.message : String(error));

  const handleRequest = async (id: number, method: string, params: unknown) => {
    try {
      await authorize("call", method).catch((error: unknown) => {
        throw deny(error);
      });
      send({ t: "res", id, ok: true, result: await handlers.call(method, params) });
    } catch (error) {
      fail(id, error);
    }
  };

  const handleSubscribe = async (id: number, topic: string, params: unknown) => {
    if (subscriptions.has(id) || pending.has(id)) return;
    pending.add(id);
    try {
      await authorize("subscribe", topic).catch((error: unknown) => {
        throw deny(error);
      });
      if (disposed || endedEarly.delete(id)) return;
      const stop = handlers.subscribe(topic, params, (data) => {
        if (subscriptions.has(id)) send({ t: "evt", id, data });
      });
      subscriptions.set(id, stop);
    } catch (error) {
      if (!endedEarly.delete(id)) send({ t: "end", id, error: toWireError(error) });
    } finally {
      pending.delete(id);
    }
  };

  const handleUnsubscribe = (id: number) => {
    if (pending.has(id)) endedEarly.add(id);
    subscriptions.get(id)?.();
    subscriptions.delete(id);
  };

  port.onmessage = (event: MessageEvent) => {
    const frameIn: unknown = event.data;
    if (!isRecord(frameIn) || typeof frameIn.t !== "string") return;
    if (!active) {
      active = true;
      onActivity?.();
    }
    const id = frameIn.id;
    switch (frameIn.t) {
      case "req":
        if (Number.isSafeInteger(id) && typeof frameIn.method === "string")
          void handleRequest(id as number, frameIn.method, frameIn.params);
        return;
      case "sub":
        if (Number.isSafeInteger(id) && typeof frameIn.topic === "string")
          void handleSubscribe(id as number, frameIn.topic, frameIn.params);
        return;
      case "unsub":
        if (Number.isSafeInteger(id)) handleUnsubscribe(id as number);
        return;
      case "mcp":
        handlers.mcp?.(frameIn.message);
        return;
      default:
        return;
    }
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      // The frame has an opaque origin, so the target can only be "*"; the port is what carries the trust.
      frame.postMessage({ type: INIT_MESSAGE, version: PROTOCOL_VERSION }, "*", [channel.port2]);
    },
    sendMcp(message) {
      send({ t: "mcp", message });
    },
    dispose() {
      if (disposed) return;
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
      pending.clear();
      endedEarly.clear();
      disposed = true;
      port.onmessage = null;
      port.close();
    },
  };
}
