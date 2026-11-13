import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

/** Batched shell output, sent only to the window that opened the terminal. */
export const TERMINAL_OUTPUT_EVENT = "misty://terminal-output";
/** A shell ended: it exited, or its window closed it. */
export const TERMINAL_CLOSED_EVENT = "misty://terminal-closed";
/** What a write to a shell that has ended fails with (`project/terminal.rs`). */
export const TERMINAL_GONE = "That terminal has closed.";

export interface TerminalOutputChunk {
  id: string;
  data: string;
}

interface TerminalHostInfo {
  platform: string;
  shellPath: string;
}

/** The terminal panel's native calls. The folder is checked natively against the linked folders. */
export const terminalApi = {
  open: (id: string, folder: string, cols: number, rows: number) =>
    invoke<void>("project_terminal_open", { account: agentAccountId(), id, folder, cols, rows }),
  write: (id: string, data: string) => invoke<void>("project_terminal_write", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("project_terminal_resize", { id, cols, rows }),
  close: (id: string) => invoke<void>("project_terminal_close", { id }),
  hostInfo: () => invoke<TerminalHostInfo>("project_terminal_host_info"),
};
