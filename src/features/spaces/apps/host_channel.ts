import { HostError, INIT_MESSAGE, PROTOCOL_VERSION, toWireError } from "./protocol";
import type { Frame } from "./protocol";

export type Unsubscribe = () => void;

export const PROTOCOL_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

export interface HostHandlers {
  call(method: string, params: unknown): Promise<unknown>;
  subscribe(
    topic: string,
    params: unknown,
    emit: (data: unknown) => void,
    end: (error?: unknown) => void,
  ): Unsubscribe;
  mcp?(message: unknown): void;
  dispose?(): void;
}

export type Authorize = (kind: "call" | "subscribe", name: string) => Promise<void>;

export interface FrameTarget {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

export interface HostChannel {
  start(): void;
  sendMcp(message: unknown): void;
  dispose(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function createHostChannel(options: {
  frame: FrameTarget;
  authorize: Authorize;
  handlers: HostHandlers;
  onActivity?: () => void;
}): HostChannel {
  const { frame, authorize, handlers, onActivity } = options;
  let active = false;
  const channel = new MessageChannel();
  const port = channel.port1;
  const subscriptions = new Map<number, Unsubscribe>();
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
      let open = true;
      let stop: Unsubscribe | undefined;
      const release = () => {
        const run = stop;
        stop = undefined;
        run?.();
      };
      stop = handlers.subscribe(
        topic,
        params,
        (data) => {
          if (open) send({ t: "evt", id, data });
        },
        (error) => {
          if (!open) return;
          open = false;
          subscriptions.delete(id);
          send(
            error === undefined ? { t: "end", id } : { t: "end", id, error: toWireError(error) },
          );
          queueMicrotask(release);
        },
      );
      if (!open) return;
      subscriptions.set(id, () => {
        open = false;
        release();
      });
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
      frame.postMessage(
        { type: INIT_MESSAGE, version: PROTOCOL_VERSION, versions: [...PROTOCOL_VERSIONS] },
        "*",
        [channel.port2],
      );
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
      handlers.dispose?.();
    },
  };
}
