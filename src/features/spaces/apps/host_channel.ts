import { INIT_MESSAGE, PROTOCOL_VERSION, toWireError } from "./protocol";
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

export type Authorize = (
  kind: "call" | "subscribe",
  name: string,
  params?: unknown,
) => Promise<void>;

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
  let arrived: Promise<void> = Promise.resolve();

  const send = (message: Frame) => {
    if (!disposed) port.postMessage(message);
  };
  const fail = (id: number, error: unknown) =>
    send({ t: "res", id, ok: false, error: toWireError(error) });
  const inTurn = (step: () => Promise<void> | void) => {
    arrived = arrived.then(() => (disposed ? undefined : step())).catch(() => undefined);
  };

  const handleRequest = async (id: number, method: string, params: unknown) => {
    let answer: Promise<unknown>;
    try {
      await authorize("call", method, params);
      if (disposed) return;
      answer = handlers.call(method, params);
    } catch (error) {
      fail(id, error);
      return;
    }
    void answer.then(
      (result) => send({ t: "res", id, ok: true, result }),
      (error: unknown) => fail(id, error),
    );
  };

  const handleSubscribe = async (id: number, topic: string, params: unknown) => {
    try {
      await authorize("subscribe", topic, params);
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
        if (Number.isSafeInteger(id) && typeof frameIn.method === "string") {
          const method = frameIn.method;
          const params = frameIn.params;
          inTurn(() => handleRequest(id as number, method, params));
        }
        return;
      case "sub":
        if (Number.isSafeInteger(id) && typeof frameIn.topic === "string") {
          const topic = frameIn.topic;
          const params = frameIn.params;
          if (subscriptions.has(id as number) || pending.has(id as number)) return;
          pending.add(id as number);
          inTurn(() => handleSubscribe(id as number, topic, params));
        }
        return;
      case "unsub":
        if (Number.isSafeInteger(id)) {
          if (pending.has(id as number)) endedEarly.add(id as number);
          inTurn(() => handleUnsubscribe(id as number));
        }
        return;
      case "mcp": {
        const message = frameIn.message;
        inTurn(() => handlers.mcp?.(message));
        return;
      }
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
