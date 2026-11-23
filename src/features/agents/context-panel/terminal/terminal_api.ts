import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agent_account";

export const TERMINAL_OUTPUT_EVENT = "misty://terminal-output";
export const TERMINAL_CLOSED_EVENT = "misty://terminal-closed";
export const TERMINAL_GONE = "That terminal has closed.";

export interface TerminalOutputChunk {
  id: string;
  data: string;
}

interface TerminalHostInfo {
  platform: string;
  shellPath: string;
}

export const terminalApi = {
  open: (id: string, folder: string, cols: number, rows: number) =>
    invoke<void>("project_terminal_open", { account: agentAccountId(), id, folder, cols, rows }),
  write: (id: string, data: string) => invoke<void>("project_terminal_write", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("project_terminal_resize", { id, cols, rows }),
  close: (id: string) => invoke<void>("project_terminal_close", { id }),
  hostInfo: () => invoke<TerminalHostInfo>("project_terminal_host_info"),
};
