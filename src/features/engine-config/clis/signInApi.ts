// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

const SIGN_IN_OUTPUT_EVENT = "engine-cli://sign-in-output";
const SIGN_IN_CLOSED_EVENT = "engine-cli://sign-in-closed";

/** What to start: an engine's own sign-in, or its sign-out; `provider` picks Pi's or Oh My Pi's
 *  provider, or MiniMax Code's or Kimi Code's region (`global` or `cn`). */
export interface SignInRequest {
  engine: string;
  provider?: string;
  signOut?: boolean;
}

/** What the person does while a sign-in runs: paste the code its page shows (`code`), enter on
 *  its page the code the CLI prints (`device-code`), answer the CLI's own screen (`menu`), or
 *  nothing but finish its page (`nothing`). */
export type SignInAsks = "code" | "device-code" | "menu" | "nothing";

/** A started sign-in: the line that runs, and what it asks of the person. */
export interface SignInStarted {
  command: string;
  asks: SignInAsks;
}

/**
 * Signing in through the CLI itself, in a terminal native code runs for the dialog. The CLI
 * keeps whatever it gets in its own files; nothing of it reaches the page beyond what the CLI
 * prints to the terminal.
 */
export const signInApi = {
  start: (request: SignInRequest, id: string, cols: number, rows: number) =>
    invoke<SignInStarted>("engine_cli_sign_in", {
      engine: request.engine,
      provider: request.provider ?? null,
      signOut: request.signOut ?? false,
      id,
      cols,
      rows,
    }),
  write: (id: string, data: string) => invoke<void>("engine_cli_sign_in_write", { id, data }),
  /** A code pasted into the dialog: native code types it, then Return, into the CLI and keeps
   *  nothing of it. Only a sign-in that asks for a code takes one. */
  code: (id: string, code: string) => invoke<void>("engine_cli_sign_in_code", { id, code }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("engine_cli_sign_in_resize", { id, cols, rows }),
  /** Ends the CLI. `done`: the person pressed Done on a sign-in answered in the CLI's own
   *  screen, which counts it as finished for an engine with no way to say. */
  close: (id: string, done = false) => invoke<void>("engine_cli_sign_in_close", { id, done }),
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
