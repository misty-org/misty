import { create } from "zustand";
import type { FrameTarget } from "./host_channel";

const SCREEN_MESSAGE = "misty:screen";
const COMMAND_TIMEOUT_MS = 10_000;

export interface ScreenChannel {
  command<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  dispose(): void;
}

export function createScreenChannel(frame: FrameTarget, onPersonInput: () => void): ScreenChannel {
  const channel = new MessageChannel();
  const port = channel.port1;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
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
    if (frameIn?.t !== "cmd-res" || typeof frameIn.id !== "number") return;
    const call = waiting.get(frameIn.id);
    if (!call) return;
    waiting.delete(frameIn.id);
    if (frameIn.ok) call.resolve(frameIn.result);
    else call.reject(new Error(frameIn.error || "The app didn't do that."));
  };
  frame.postMessage({ type: SCREEN_MESSAGE }, "*", [channel.port2]);
  return {
    command<T>(name: string, args: Record<string, unknown> = {}) {
      if (disposed) return Promise.reject(new Error("The app has closed."));
      return new Promise<T>((resolve, reject) => {
        const id = next++;
        const timer = window.setTimeout(() => {
          waiting.delete(id);
          reject(new Error("The app didn't answer. It may not have finished loading."));
        }, COMMAND_TIMEOUT_MS);
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
    dispose() {
      if (disposed) return;
      disposed = true;
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
  x: number;
  y: number;
}

interface AppControlState {
  agents: Record<string, AgentInApp | undefined>;
  held: Record<string, boolean | undefined>;
  point(appId: string, agent: AgentInApp): void;
  leave(appId: string): void;
  takeBack(appId: string): void;
  handBack(appId: string): void;
}

export const useAppControl = create<AppControlState>((set, get) => ({
  agents: {},
  held: {},
  point: (appId, agent) => set((state) => ({ agents: { ...state.agents, [appId]: agent } })),
  leave: (appId) =>
    set((state) => ({
      agents: { ...state.agents, [appId]: undefined },
      held: { ...state.held, [appId]: undefined },
    })),
  takeBack: (appId) => {
    if (!get().agents[appId]) return;
    set((state) => ({ held: { ...state.held, [appId]: true } }));
  },
  handBack: (appId) => set((state) => ({ held: { ...state.held, [appId]: undefined } })),
}));

export interface RunningAppHandle {
  appId: string;
  appName: string;
  screen: ScreenChannel;
  frame(): HTMLElement | null;
}

const running = new Map<string, RunningAppHandle>();

export const useRunningAppIds = create<{ ids: string[] }>(() => ({ ids: [] }));
const publish = () => useRunningAppIds.setState({ ids: [...running.keys()].sort() });

export function noteRunningApp(handle: RunningAppHandle): () => void {
  running.set(handle.appId, handle);
  publish();
  return () => {
    if (running.get(handle.appId) === handle) {
      running.delete(handle.appId);
      publish();
    }
  };
}

export function runningApp(appId: string): RunningAppHandle | undefined {
  return running.get(appId);
}
