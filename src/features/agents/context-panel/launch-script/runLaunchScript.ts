// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useContextPanel } from "../contextPanelStore";
import {
  ensureTerminalOutputListener,
  hasTerminalSession,
  markTerminalClosed,
  markTerminalOpened,
} from "../terminal/sessions";
import { terminalApi } from "../terminal/terminalApi";
import { useTerminalStore } from "../terminal/terminalStore";
import type { LaunchScriptEntry } from "./launchScripts";

/** The one terminal tab a chat's start commands for a folder run in, every time. */
export const LAUNCH_TAB_KEY = "launch";

/**
 * Runs a start command in the chat's launch tab for the folder. Every run starts that tab's shell again
 * (close, then open), so a shell that ended, or a server still running from the last run, never
 * swallows the command. The terminal panel opens to show it.
 */
export async function runLaunchScript(
  chat: string,
  folder: string,
  entry: LaunchScriptEntry,
): Promise<void> {
  // Output is kept even before any terminal view has mounted.
  ensureTerminalOutputListener();
  const id = useTerminalStore
    .getState()
    .ensureTab(chat, folder, LAUNCH_TAB_KEY, entry.label || "Start command");
  useContextPanel.getState().show("terminal");
  if (hasTerminalSession(id)) {
    markTerminalClosed(id);
    await terminalApi.close(id).catch(() => undefined);
  }
  // Opening is idempotent per id, and the view opens with its real size and resizes the shell
  // when it mounts, so this size only lasts until the panel shows.
  await terminalApi.open(id, folder, 120, 30);
  markTerminalOpened(id);
  await terminalApi.write(id, `${entry.script}\n`);
}
