import { listen } from "@tauri-apps/api/event";
import { codeLspSend, codeLspStart, codeLspStop } from "../native";
import type { CodeLspTransport, LspMessage } from "./client";

/** Native imports stay in the embedded-host adapter, outside the reusable protocol client. */
export const nativeCodeLspTransport: CodeLspTransport = {
  start: codeLspStart,
  send: (sessionId, message) => codeLspSend(sessionId, JSON.stringify(message)),
  stop: codeLspStop,
  async subscribe(sessionId, message, exited) {
    const removeMessages = await listen<{ sessionId: string; payload: string }>(
      "misty://code-lsp-message",
      ({ payload }) => {
        if (payload.sessionId !== sessionId) return;
        try {
          message(JSON.parse(payload.payload) as LspMessage);
        } catch {
          /* Ignore malformed server output. */
        }
      },
    );
    try {
      const removeExit = await listen<{ sessionId: string; reason: string }>(
        "misty://code-lsp-exit",
        ({ payload }) => {
          if (payload.sessionId === sessionId) exited(payload.reason);
        },
      );
      return () => {
        removeMessages();
        removeExit();
      };
    } catch (error) {
      removeMessages();
      throw error;
    }
  },
};
