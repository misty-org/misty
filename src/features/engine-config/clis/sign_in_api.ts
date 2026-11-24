// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

const SIGN_IN_OUTPUT_EVENT = "engine-cli://sign-in-output";
const SIGN_IN_CLOSED_EVENT = "engine-cli://sign-in-closed";

export interface SignInRequest {
  engine: string;
  provider?: string;
  signOut?: boolean;
}

export type SignInAsks = "code" | "menu" | "nothing";

export interface SignInStarted {
  command: string;
  asks: SignInAsks;
}

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
  code: (id: string, code: string) => invoke<void>("engine_cli_sign_in_code", { id, code }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("engine_cli_sign_in_resize", { id, cols, rows }),
  close: (id: string, done = false) => invoke<void>("engine_cli_sign_in_close", { id, done }),
};

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
