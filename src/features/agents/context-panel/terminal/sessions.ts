// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  TERMINAL_CLOSED_EVENT,
  TERMINAL_OUTPUT_EVENT,
  type TerminalOutputChunk,
} from "./terminalApi";

/**
 * Native shells outlive their xterm view: closing the panel or switching tabs remounts the view.
 * Output gathers here in between so nothing is lost, and a view that mounts again replays it.
 * Module-level on purpose: this changes as fast as the shell prints and must never go through
 * React state.
 */
const MAX_BUFFER_CHARS = 200_000;

const buffers = new Map<string, string>();
const writers = new Map<string, (data: string) => void>();
const openSessions = new Set<string>();
let listening = false;

/** Appends output to a session's backlog and hands it to its live view, if one is mounted. */
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

/** A shell ended on its own: its next input opens a fresh one. */
function receiveTerminalClosed(id: string): void {
  if (!openSessions.has(id)) return;
  openSessions.delete(id);
  receiveTerminalOutput([{ id, data: "\r\n[The shell ended]\r\n" }]);
}

/** One subscription to this window's terminal output, for every session. Idempotent. */
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

/** Buffered output, replayed into a view as it mounts. */
export function terminalBacklog(id: string): string {
  return buffers.get(id) ?? "";
}

/** Drops everything kept for a session (its tab closed). */
export function clearTerminalSessionState(id: string): void {
  buffers.delete(id);
  writers.delete(id);
  openSessions.delete(id);
}

/** Registers the live xterm writer for a session; `null` unregisters it. */
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

/** Whether the native side confirmed a live shell for this id. */
export function hasTerminalSession(id: string): boolean {
  return openSessions.has(id);
}
