import { invoke } from "@/native/invoke";

export interface ScreenMemoryStatus {
  supported: boolean;
  allowed: boolean;
  running: boolean;
  sessionId?: string;
  startedAtMs?: number;
  frames?: number;
}

export interface ScreenMemoryOptions {
  intervalSecs: number;
  idleSecs: number;
  excludedApps: string[];
}

export interface ScreenMemoryFrame {
  sessionId: string;
  app: string;
  title: string;
  text: string;
  capturedAtMs: number;
}

export type ScreenMemoryEnd = "stopped" | "idle" | "failed" | "window-closed";

export const FRAME_EVENT = "screen-memory-frame";
export const ENDED_EVENT = "screen-memory-ended";

export const screenMemoryNative = {
  /** With `request`, macOS asks for screen access if it was never granted. */
  status: (request = false) => invoke<ScreenMemoryStatus>("screen_memory_status", { request }),
  start: (options: ScreenMemoryOptions) =>
    invoke<{ running: boolean; startedAtMs: number }>("screen_memory_start", { options }),
  stop: () => invoke<void>("screen_memory_stop"),
};
