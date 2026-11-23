// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useContextPanel } from "../context_panel_store";
import {
  ensureTerminalOutputListener,
  hasTerminalSession,
  markTerminalClosed,
  markTerminalOpened,
} from "../terminal/sessions";
import { terminalApi } from "../terminal/terminal_api";
import { useTerminalStore } from "../terminal/terminal_store";
import type { LaunchScriptEntry } from "./launch_scripts";

export const LAUNCH_TAB_KEY = "launch";

export async function runLaunchScript(
  chat: string,
  folder: string,
  entry: LaunchScriptEntry,
): Promise<void> {
  ensureTerminalOutputListener();
  const id = useTerminalStore
    .getState()
    .ensureTab(chat, folder, LAUNCH_TAB_KEY, entry.label || "Start command");
  useContextPanel.getState().show("terminal");
  if (hasTerminalSession(id)) {
    markTerminalClosed(id);
    await terminalApi.close(id).catch(() => undefined);
  }
  await terminalApi.open(id, folder, 120, 30);
  markTerminalOpened(id);
  await terminalApi.write(id, `${entry.script}\n`);
}
