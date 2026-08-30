import { invoke } from "@tauri-apps/api/core";

// Module-scope state that survives React unmount. Each terminal "slot" is one
// xterm/PTY pair and each dock tab owns at most one slot.

/** Slot id → live PTY session id in Rust. */
export const sessionBySlot = new Map<string, string>();

/** Slot id → serialized xterm buffer, restored on remount. */
export const bufferBySlot = new Map<string, string>();

/** Slot id → most recent cwd reported by the shell (OSC 7). */
export const cwdBySlot = new Map<string, string>();

/** Slot id → most recent title (OSC 0 / 2), used for the workspace-tab title. */
export const titleBySlot = new Map<string, string>();

/** Workspace tab id → ordered list of slot ids that belong to it. */
export const slotsByTab = new Map<string, string[]>();

export function registerSlot(tabId: string, slotId: string): void {
  slotsByTab.set(tabId, [slotId]);
}

export function unregisterSlot(tabId: string, slotId: string): void {
  const existing = slotsByTab.get(tabId);
  if (!existing) return;
  const next = existing.filter((id) => id !== slotId);
  if (next.length === 0) slotsByTab.delete(tabId);
  else slotsByTab.set(tabId, next);
}

/** Kill one slot's PTY and forget its buffer / cwd / title. */
export function killTerminalSlot(slotId: string): void {
  const sessionId = sessionBySlot.get(slotId);
  sessionBySlot.delete(slotId);
  bufferBySlot.delete(slotId);
  cwdBySlot.delete(slotId);
  titleBySlot.delete(slotId);
  if (sessionId) {
    void invoke("terminal_kill", { sessionId }).catch(() => undefined);
  }
}

/** Kill every slot belonging to a workspace tab. Called when the tab closes. */
export function killTerminalTab(tabId: string): void {
  const slots = slotsByTab.get(tabId);
  slotsByTab.delete(tabId);
  if (!slots) return;
  for (const slotId of slots) killTerminalSlot(slotId);
}
