// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  TERMINAL_CLOSED_EVENT,
  TERMINAL_OUTPUT_EVENT,
  type TerminalOutputChunk,
} from "./terminal_api";

const MAX_BUFFER_CHARS = 200_000;

const buffers = new Map<string, string>();
const writers = new Map<string, (data: string) => void>();
const openSessions = new Set<string>();
let listening = false;

export function receiveTerminalOutput(chunks: TerminalOutputChunk[]): void {
  for (const { id, data } of chunks) {
    const next = (buffers.get(id) ?? "") + data;
    buffers.set(
      id,
      next.length > MAX_BUFFER_CHARS ? next.slice(next.length - MAX_BUFFER_CHARS) : next,
    );
    writers.get(id)?.(data);
  }
}

function receiveTerminalClosed(id: string): void {
  if (!openSessions.has(id)) return;
  openSessions.delete(id);
  receiveTerminalOutput([{ id, data: "\r\n[The shell ended]\r\n" }]);
}

export function ensureTerminalOutputListener(): void {
  if (listening) return;
  listening = true;
  const webview = getCurrentWebview();
  void webview.listen<TerminalOutputChunk[]>(TERMINAL_OUTPUT_EVENT, ({ payload }) =>
    receiveTerminalOutput(payload),
  );
  void webview.listen<{ id: string }>(TERMINAL_CLOSED_EVENT, ({ payload }) =>
    receiveTerminalClosed(payload.id),
  );
}

export function terminalBacklog(id: string): string {
  return buffers.get(id) ?? "";
}

export function clearTerminalSessionState(id: string): void {
  buffers.delete(id);
  writers.delete(id);
  openSessions.delete(id);
}

export function setTerminalWriter(id: string, writer: ((data: string) => void) | null): void {
  if (writer) writers.set(id, writer);
  else writers.delete(id);
}

export function markTerminalOpened(id: string): void {
  openSessions.add(id);
}

export function markTerminalClosed(id: string): void {
  openSessions.delete(id);
}

export function hasTerminalSession(id: string): boolean {
  return openSessions.has(id);
}
