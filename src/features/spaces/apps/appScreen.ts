import { create } from "zustand";
import type { FrameTarget } from "./hostChannel";

/** The message that hands the screen helper (`screen.js`) its channel. */
const SCREEN_MESSAGE = "misty:screen";
const COMMAND_TIMEOUT_MS = 10_000;

/** The host's end of a running app's screen helper: commands out, the person's own input in. */
export interface ScreenChannel {
  command<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  dispose(): void;
}

/**
 * Opens the screen helper's channel in a running app. It is apart from the SDK's, so an app's own SDK connection
 * never sees it. `onPersonInput` hears every time the person clicks or types in the app themself.
 */
export function createScreenChannel(
  frame: FrameTarget,
  onPersonInput: () => void,
): ScreenChannel {
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
  // The frame's origin is opaque, so the target is "*"; the port is what carries the trust.
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

/** An agent working in a running app: who it is and where its pointer is, as fractions of the app's view. */
export interface AgentInApp {
  agentId: string;
  name: string;
  x: number;
  y: number;
}

interface AppControlState {
  /** The agent working in each running app, by app id. */
  agents: Record<string, AgentInApp | undefined>;
  /** Apps whose person took control back; the agent waits until they hand it back. */
  held: Record<string, boolean | undefined>;
  point(appId: string, agent: AgentInApp): void;
  leave(appId: string): void;
  /** The person clicked or typed in the app while an agent worked there: control is theirs. */
  takeBack(appId: string): void;
  handBack(appId: string): void;
}

/**
 * Who has control of each running app. One driver at a time: an agent works in an app as a guest given control,
 * and the person's own click or keypress there takes it back until they hand it back.
 */
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

/** An app running in this window, for what works with it from outside its page (an agent's screen tools). */
export interface RunningAppHandle {
  appId: string;
  appName: string;
  screen: ScreenChannel;
  frame(): HTMLIFrameElement | null;
}

const running = new Map<string, RunningAppHandle>();

/** The ids of the apps running here, for what follows them (an added app's standby tools). */
export const useRunningAppIds = create<{ ids: string[] }>(() => ({ ids: [] }));
const publish = () => useRunningAppIds.setState({ ids: [...running.keys()].sort() });

/** Notes an app as running here, until the returned function says it stopped. */
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

/** The app running here by its id, if it is. */
export function runningApp(appId: string): RunningAppHandle | undefined {
  return running.get(appId);
}
