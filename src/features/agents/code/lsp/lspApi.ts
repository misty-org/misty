import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";
import type { LspLanguage } from "./languages";

/** One JSON-RPC message from a server, sent only to the window that started it. */
export const LSP_MESSAGE_EVENT = "misty://code-lsp-message";
/** A server ended on its own (it crashed or quit). */
export const LSP_CLOSED_EVENT = "misty://code-lsp-closed";
/** An install's progress, sent to the window that asked for it. */
export const LSP_PROGRESS_EVENT = "misty://code-lsp-progress";

export interface LspMessage {
  id: string;
  message: string;
}

export interface LspClosed {
  id: string;
  message: string | null;
}

/** What an install is doing: fetching Node.js, downloading the server, or npm/Go installing it. */
export type LspInstallStep = "node" | "download" | "install";

export interface LspProgress {
  language: LspLanguage;
  step: LspInstallStep;
  received: number;
  total: number | null;
}

export interface LspStatus {
  language: LspLanguage;
  server: string;
  installed: boolean;
  version: string | null;
  /** Why it can't be installed here, such as Go missing. */
  problem: string | null;
}

export interface LspStarted {
  id: string;
  rootUri: string;
  fileUri: string;
  folderUri: string;
}

/** The language server commands (`src-tauri/features/code/lsp`). The window names a language
 * from the native catalog and never a program; paths are checked against the linked folders. */
export const lspApi = {
  status: (language: LspLanguage) =>
    invoke<LspStatus>("code_lsp_status", { account: agentAccountId(), language }),
  install: (language: LspLanguage) =>
    invoke<LspStatus>("code_lsp_install", { account: agentAccountId(), language }),
  start: (language: LspLanguage, folder: string, file: string, page: string) =>
    invoke<LspStarted>("code_lsp_start", {
      account: agentAccountId(),
      language,
      folder,
      file,
      page,
    }),
  /** Messages go as one ordered batch: separate calls could be handled out of order. */
  send: (id: string, messages: string[]) => invoke<void>("code_lsp_send", { id, messages }),
  /** Whether the server ended because this was its last user. */
  stop: (id: string) => invoke<boolean>("code_lsp_stop", { id }),
};
