// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export const SIGN_IN_OUTPUT_EVENT = "engine-cli://sign-in-output";
export const SIGN_IN_CLOSED_EVENT = "engine-cli://sign-in-closed";

/** What to start: an engine's own sign-in, or its sign-out; `provider` picks Pi's or Oh My Pi's
 *  provider, or MiniMax Code's region (`global` or `cn`). */
export interface SignInRequest {
  engine: string;
  provider?: string;
  signOut?: boolean;
}

/**
 * Signing in through the CLI itself, in a terminal native code runs for the dialog. The CLI
 * keeps whatever it gets in its own files; nothing of it reaches the page beyond what the CLI
 * prints to the terminal.
 */
export const signInApi = {
  start: (request: SignInRequest, id: string, cols: number, rows: number) =>
    invoke<{ command: string }>("engine_cli_sign_in", {
      engine: request.engine,
      provider: request.provider ?? null,
      signOut: request.signOut ?? false,
      id,
      cols,
      rows,
    }),
  /** A vendor's installer (Claude Code's or Codex's own script) in the same kind of terminal;
   *  native code works out the line from the engine. */
  installInTerminal: (engine: string, id: string, cols: number, rows: number) =>
    invoke<{ command: string }>("engine_cli_install_in_terminal", { engine, id, cols, rows }),
  write: (id: string, data: string) => invoke<void>("engine_cli_sign_in_write", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("engine_cli_sign_in_resize", { id, cols, rows }),
  close: (id: string) => invoke<void>("engine_cli_sign_in_close", { id }),
};

/** A sign-in terminal's output and its end, for this window only. */
export async function listenSignIn(
  id: string,
  onData: (data: string) => void,
  onClosed: (ok: boolean) => void,
): Promise<UnlistenFn> {
  if (!hasTauriInternals()) return () => {};
  const webview = getCurrentWebview();
  const stopOutput = await webview.listen<{ id: string; data: string }>(
    SIGN_IN_OUTPUT_EVENT,
    ({ payload }) => {
      if (payload.id === id) onData(payload.data);
    },
  );
  const stopClosed = await webview.listen<{ id: string; ok: boolean }>(
    SIGN_IN_CLOSED_EVENT,
    ({ payload }) => {
      if (payload.id === id) onClosed(payload.ok);
    },
  );
  return () => {
    stopOutput();
    stopClosed();
  };
}
