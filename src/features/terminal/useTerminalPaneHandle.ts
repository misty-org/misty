import { invoke } from "@tauri-apps/api/core";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { useImperativeHandle, type Dispatch, type ForwardedRef, type SetStateAction } from "react";
import { hasTerminalControlCharacters } from "./terminalInputSafety";
import { MISTY_TERMINAL_SEARCH_DECORATIONS } from "./terminalTheme";

const MIN_FONT_SCALE = 0.6;
const MAX_FONT_SCALE = 2;

export interface TerminalPaneHandle {
  focus: () => void;
  clear: () => void;
  bumpFontScale: (delta: number | "reset") => void;
  copySelection: () => Promise<void>;
  paste: () => Promise<void>;
  search: (query: string, direction?: "next" | "previous") => boolean;
  clearSearch: () => void;
  aiSnapshot: () => string;
  stageAiCommand: (command: string) => Promise<void>;
}

interface TerminalPaneHandleOptions {
  handleRef: ForwardedRef<TerminalPaneHandle>;
  terminalRef: { current: Terminal | null };
  searchRef: { current: SearchAddon | null };
  sessionIdRef: { current: string };
  setFontScale: Dispatch<SetStateAction<number>>;
}

export function useTerminalPaneHandle(options: TerminalPaneHandleOptions) {
  const { handleRef, terminalRef, searchRef, sessionIdRef, setFontScale } = options;
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
      search: (query, direction = "next") => {
        const search = searchRef.current;
        if (!search || !query) {
          search?.clearDecorations();
          return false;
        }
        const searchOptions = {
          decorations: MISTY_TERMINAL_SEARCH_DECORATIONS,
          incremental: direction === "next",
        };
        return direction === "previous"
          ? search.findPrevious(query, searchOptions)
          : search.findNext(query, searchOptions);
      },
      clearSearch: () => searchRef.current?.clearDecorations(),
      aiSnapshot: () => {
        const term = terminalRef.current;
        if (!term) return "";
        const selected = term.getSelection().trim();
        if (selected) return selected.slice(0, 32 << 10);
        const buffer = term.buffer.active;
        const end = buffer.baseY + buffer.cursorY;
        const start = Math.max(0, end - 120);
        const lines: string[] = [];
        for (let row = start; row <= end; row++) {
          const line = buffer.getLine(row)?.translateToString(true) ?? "";
          if (line.trim()) lines.push(line);
        }
        return lines.join("\n").slice(-(32 << 10));
      },
      stageAiCommand: async (command) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId || !command || hasTerminalControlCharacters(command)) {
          throw new Error("The terminal command is not safe to stage.");
        }
        // Intentionally omit a newline: applying an AI artifact may prepare a
        // command, but only the user's final Enter gesture may execute it.
        await invoke("terminal_write", { sessionId, data: command });
        terminalRef.current?.focus();
      },
    }),
    [searchRef, sessionIdRef, setFontScale, terminalRef],
  );
}
