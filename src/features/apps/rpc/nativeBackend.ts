import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TerminalRpcBackend } from "./terminal";

// This adapter is host-owned and must never be bundled into a downloaded App.
export const nativeRpcBackend: TerminalRpcBackend = {
  invoke,
  listen: (event, listener) => listen(event, ({ payload }) => listener(payload)),
};
