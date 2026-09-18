import { invoke } from "@tauri-apps/api/core";
import type { DirectoryListing } from "@/native/contracts/media-library";

export type LineEnding = "lf" | "crlf";

export interface CodeFileContent {
  contents: string;
  sizeBytes: number;
  modifiedMs: number | null;
  readonly: boolean;
  lineEnding: LineEnding;
}

export interface CodeFileMeta {
  sizeBytes: number;
  modifiedMs: number | null;
}

export interface WalkedFile {
  path: string;
  relative: string;
  name: string;
}

export interface SearchMatch {
  path: string;
  relative: string;
  lineNumber: number;
  line: string;
  column: number;
}

export interface SearchOutcome {
  matches: SearchMatch[];
  truncated: boolean;
  usedRipgrep: boolean;
}

export function codeReadTextFile(path: string): Promise<CodeFileContent> {
  return invoke("code_read_text_file", { path });
}

export function codeWriteTextFile(
  path: string,
  contents: string,
  lineEnding: LineEnding = "lf",
): Promise<CodeFileMeta> {
  return invoke("code_write_text_file", { path, contents, lineEnding });
}

export function codeCreateFile(path: string, contents = ""): Promise<void> {
  return invoke("code_create_file", { path, contents });
}

export function codeCreateFolder(path: string): Promise<void> {
  return invoke("code_create_folder", { path });
}

export function codeRenamePath(from: string, to: string): Promise<void> {
  return invoke("code_rename_path", { from, to });
}

export function codeDeletePath(path: string): Promise<void> {
  return invoke("code_delete_path", { path });
}

/** The code explorer always lists dotfiles — they are source, not clutter. */
export function codeListDirectory(path: string): Promise<DirectoryListing> {
  return invoke("explorer_list_directory", {
    request: { path, showHidden: true, forceRemoteRefresh: false },
  });
}

export function codeWalkFiles(root: string): Promise<WalkedFile[]> {
  return invoke("code_walk_files", { root });
}

export function codeFindInFiles(
  root: string,
  query: string,
  caseSensitive = false,
): Promise<SearchOutcome> {
  return invoke("code_find_in_files", { root, query, caseSensitive });
}

export function codeWatchDir(root: string): Promise<string> {
  return invoke("code_watch_dir", { root });
}

export function codeStopWatch(watcherId: string): Promise<void> {
  return invoke("code_stop_watch", { watcherId });
}

export function codeLspStart(language: string, cwd: string): Promise<string> {
  return invoke("code_lsp_start", { request: { language, cwd } });
}

export function codeLspSend(sessionId: string, payload: string): Promise<void> {
  return invoke("code_lsp_send", { sessionId, payload });
}

export function codeLspStop(sessionId: string): Promise<void> {
  return invoke("code_lsp_stop", { sessionId });
}
