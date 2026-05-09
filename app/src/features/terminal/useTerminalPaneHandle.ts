import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { useImperativeHandle, type Dispatch, type ForwardedRef, type SetStateAction } from "react";

const MIN_FONT_SCALE = 0.6;
const MAX_FONT_SCALE = 2;

export interface TerminalPaneHandle {
  focus: () => void;
  clear: () => void;
  bumpFontScale: (delta: number | "reset") => void;
  copySelection: () => Promise<void>;
  paste: () => Promise<void>;
  toggleSearch: () => void;
}

interface TerminalPaneHandleOptions {
  handleRef: ForwardedRef<TerminalPaneHandle>;
  terminalRef: { current: Terminal | null };
  sessionIdRef: { current: string };
  setFontScale: Dispatch<SetStateAction<number>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}

export function useTerminalPaneHandle(options: TerminalPaneHandleOptions) {
  const { handleRef, terminalRef, sessionIdRef, setFontScale, setSearchOpen } = options;
  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => terminalRef.current?.focus(),
      clear: () => {
        terminalRef.current?.clear();
        const sessionId = sessionIdRef.current;
        if (sessionId)
          void invoke("terminal_write", { sessionId, data: "\x0c" }).catch(() => undefined);
      },
      bumpFontScale: (delta) => {
        setFontScale((current) => {
          if (delta === "reset") return 1;
          const next = Math.round((current + delta) * 20) / 20;
          return Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, next));
        });
      },
      copySelection: async () => {
        const selection = terminalRef.current?.getSelection();
        if (!selection) return;
        try {
          await navigator.clipboard.writeText(selection);
        } catch {
          // The native menu remains available when browser clipboard access is blocked.
        }
      },
      paste: async () => {
        const term = terminalRef.current;
        if (!term || !sessionIdRef.current) return;
        try {
          const text = await navigator.clipboard.readText();
          if (text) term.paste(text);
        } catch {
          // Clipboard access can be unavailable outside a focused desktop window.
        }
      },
      toggleSearch: () => setSearchOpen((current) => !current),
    }),
    [sessionIdRef, setFontScale, setSearchOpen, terminalRef],
  );
}
