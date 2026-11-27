import { create } from "zustand";
import { watchAllRunEvents } from "@/features/agents";
import type { FrameTarget } from "./host_channel";

const SCREEN_MESSAGE = "misty:screen";
const COMMAND_TIMEOUT_MS = 10_000;

export interface ScreenChannel {
  command<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>;
  onTools(listener: () => void): () => void;
  onPoint(listener: (spot: ScreenPoint) => void): () => void;
  dispose(): void;
}

export interface ScreenPoint {
  call: string;
  x: number;
  y: number;
  doing?: string;
}

export class ScreenRefused extends Error {}

export function createScreenChannel(frame: FrameTarget, onPersonInput: () => void): ScreenChannel {
  const channel = new MessageChannel();
  const port = channel.port1;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const toolListeners = new Set<() => void>();
  const pointListeners = new Set<(spot: ScreenPoint) => void>();
  let next = 1;
  let disposed = false;
  port.onmessage = (event: MessageEvent) => {
    const frameIn = event.data as {
      t?: string;
      id?: number;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (frameIn?.t === "input") return onPersonInput();
    if (frameIn?.t === "tools") {
      for (const listener of [...toolListeners]) listener();
      return;
    }
    if (frameIn?.t === "point") {
      const spot = event.data as Partial<ScreenPoint>;
      const inside = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5;
      if (typeof spot.call !== "string") return;
      const point: ScreenPoint = {
        call: spot.call,
        x: inside(spot.x),
        y: inside(spot.y),
        doing: typeof spot.doing === "string" && spot.doing ? spot.doing.slice(0, 120) : undefined,
      };
      for (const listener of [...pointListeners]) listener(point);
      return;
    }
    if (frameIn?.t !== "cmd-res" || typeof frameIn.id !== "number") return;
    const call = waiting.get(frameIn.id);
    if (!call) return;
    waiting.delete(frameIn.id);
    if (frameIn.ok) call.resolve(frameIn.result);
    else call.reject(new ScreenRefused(frameIn.error || "The app didn't do that."));
  };
  frame.postMessage({ type: SCREEN_MESSAGE }, "*", [channel.port2]);
  return {
    command<T>(
      name: string,
      args: Record<string, unknown> = {},
      options: { timeoutMs?: number } = {},
    ) {
      if (disposed) return Promise.reject(new Error("The app has closed."));
      return new Promise<T>((resolve, reject) => {
        const id = next++;
        const timer = window.setTimeout(() => {
          waiting.delete(id);
          reject(new Error("The app didn't answer. It may not have finished loading."));
        }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
        waiting.set(id, {
          resolve: (value) => {
            window.clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            window.clearTimeout(timer);
            reject(error);
          },
        });
        port.postMessage({ t: "cmd", id, name, args });
      });
    },
    onTools(listener) {
      toolListeners.add(listener);
      return () => toolListeners.delete(listener);
    },
    onPoint(listener) {
      pointListeners.add(listener);
      return () => pointListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      toolListeners.clear();
      pointListeners.clear();
      for (const call of waiting.values()) call.reject(new Error("The app has closed."));
      waiting.clear();
      port.onmessage = null;
      port.close();
    },
  };
}

export interface AgentInApp {
  agentId: string;
  name: string;
  runId?: string;
  x: number;
  y: number;
  doing?: string;
}

interface AppControlState {
  agents: Record<string, AgentInApp | undefined>;
  held: Record<string, boolean | undefined>;
  point(instance: string, agent: AgentInApp): void;
  leave(instance: string): void;
  takeBack(instance: string): void;
  handBack(instance: string): void;
}

const RUN_ENDS = new Set(["invocation.completed", "invocation.failed", "invocation.canceled"]);

const runWatches = new Map<string, { runId: string; stop: () => void }>();

function unwatchRun(instance: string) {
  runWatches.get(instance)?.stop();
  runWatches.delete(instance);
}

function watchRun(instance: string, runId: string | undefined) {
  if (runId && runWatches.get(instance)?.runId === runId) return;
  unwatchRun(instance);
  if (!runId) return;
  const stop = watchAllRunEvents((ended, event) => {
    if (ended !== runId || !RUN_ENDS.has(event.type)) return;
    if (useAppControl.getState().agents[instance]?.runId === runId)
      useAppControl.getState().leave(instance);
  });
  runWatches.set(instance, { runId, stop });
}

export const useAppControl = create<AppControlState>((set, get) => ({
  agents: {},
  held: {},
  point: (instance, agent) => {
    watchRun(instance, agent.runId);
    set((state) => ({ agents: { ...state.agents, [instance]: agent } }));
  },
  leave: (instance) => {
    unwatchRun(instance);
    set((state) => ({
      agents: { ...state.agents, [instance]: undefined },
      held: { ...state.held, [instance]: undefined },
    }));
  },
  takeBack: (instance) => {
    if (!get().agents[instance]) return;
    set((state) => ({ held: { ...state.held, [instance]: true } }));
  },
  handBack: (instance) => set((state) => ({ held: { ...state.held, [instance]: undefined } })),
}));

export function watchAgentControl(
  instance: string,
  owner: string,
  emit: (data: unknown) => void,
): () => void {
  let last = "";
  const send = () => {
    const { agents, held } = useAppControl.getState();
    const agent = agents[instance];
    const control = {
      agent: agent ? { id: agent.agentId, name: agent.name, user_id: owner } : null,
      driver: agent && !held[instance] ? ("agent" as const) : ("person" as const),
    };
    const key = JSON.stringify(control);
    if (key === last) return;
    last = key;
    emit(control);
  };
  send();
  return useAppControl.subscribe(send);
}

export interface RunningAppHandle {
  instance: string;
  spaceId: string;
  appId: string;
  appName: string;
  screen: ScreenChannel;
  frame(): HTMLElement | null;
}

const running = new Map<string, RunningAppHandle>();

export const runningKey = (spaceId: string, appId: string) => `${spaceId}/${appId}`;

export const useRunningAppIds = create<{ ids: string[] }>(() => ({ ids: [] }));
const publish = () =>
  useRunningAppIds.setState({
    ids: [
      ...new Set([...running.values()].map((handle) => runningKey(handle.spaceId, handle.appId))),
    ].sort(),
  });

export function noteRunningApp(handle: RunningAppHandle): () => void {
  running.set(handle.instance, handle);
  publish();
  return () => {
    if (running.get(handle.instance) === handle) {
      running.delete(handle.instance);
      publish();
    }
  };
}

export function runningApp(spaceId: string, appId: string): RunningAppHandle | undefined {
  let found: RunningAppHandle | undefined;
  for (const handle of running.values())
    if (handle.spaceId === spaceId && handle.appId === appId) found = handle;
  return found;
}
