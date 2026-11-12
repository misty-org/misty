// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  /** Git ignores this entry (`.gitignore`, info/exclude, global excludes, and `.git` itself;
   * tracked content never is). Only set when the listing was asked with `gitIgnoreRoot`. */
  ignored?: boolean;
}

export interface FileContent {
  kind: "text" | "image" | "binary";
  text: string | null;
  dataUrl: string | null;
  /** Longer than what was read: it opens read-only, since saving would cut it short. */
  truncated: boolean;
}

/** What duplicating or pasting made. */
export interface FileOpResult {
  path: string;
  isDir: boolean;
}

export interface PasteClipboardResult {
  created: FileOpResult[];
  failed: string[];
}

/** The file paths the system clipboard holds, and its change count where the system keeps one. */
export interface ClipboardFileSnapshot {
  paths: string[];
  changeCount: number | null;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface FileIndexEntry {
  /** Relative to the folder, with `/` between names. */
  rel: string;
  isDir: boolean;
}

/** A folder in the tree that is itself the top of a Git repository, with its branch and counts. */
export interface RepositorySummary {
  path: string;
  branch: string;
  changed: number;
  untracked: number;
}

export type FileTreeColor = "modified" | "untracked" | "repository";

export interface GitTreeLevel {
  path: string;
  files: string[];
  directories: string[];
}

export interface GitTreeStatus {
  repositories: RepositorySummary[];
  /** Listed folder → entry name → its Git color. */
  fileColors: Record<string, Record<string, FileTreeColor>>;
}

const account = () => agentAccountId();

/** The file panel's native calls. Every path is checked natively against the account's linked folders. */
export const filesApi = {
  listDir: (path: string, gitIgnoreRoot?: string) =>
    invoke<DirEntry[]>("project_list_dir", { account: account(), path, gitIgnoreRoot }),
  readFile: (path: string) =>
    invoke<FileContent>("project_read_file", { account: account(), path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("project_write_file", { account: account(), path, content }),
  createDir: (path: string) => invoke<void>("project_create_dir", { account: account(), path }),
  /** Fails when the file already exists, where writing would overwrite it. */
  createFile: (path: string) => invoke<void>("project_create_file", { account: account(), path }),
  rename: (from: string, to: string) =>
    invoke<void>("project_rename", { account: account(), from, to }),
  trash: (path: string) => invoke<void>("project_trash", { account: account(), path }),
  duplicate: (path: string) =>
    invoke<FileOpResult>("project_duplicate", { account: account(), path }),
  paste: (source: string, targetDir: string) =>
    invoke<FileOpResult>("project_paste", { account: account(), source, targetDir }),
  pasteClipboard: (targetDir: string) =>
    invoke<PasteClipboardResult>("project_paste_clipboard", { account: account(), targetDir }),
  clipboardSnapshot: () => invoke<ClipboardFileSnapshot>("project_clipboard_snapshot"),
  /** The clipboard's change count alone; answers while another app holds the clipboard. */
  clipboardChangeCount: () => invoke<number | null>("project_clipboard_change_count"),
  /** Puts a file on the system clipboard, as Finder's Copy does; returns the new change count. */
  clipboardSetFiles: (paths: string[]) =>
    invoke<number | null>("project_clipboard_set_files", { account: account(), paths }),
  searchText: (path: string, query: string) =>
    invoke<SearchHit[]>("project_search_text", { account: account(), path, query }),
  fileIndex: (path: string) =>
    invoke<FileIndexEntry[]>("project_file_index", { account: account(), path }),
  /** The HTML file as one document for the preview frame, its own folder's files inlined. */
  htmlPreview: (path: string) =>
    invoke<string>("project_html_preview_open", { account: account(), path }),
  /** Git colors and repository badges for loaded tree levels (`project/git.rs`). */
  gitTreeStatus: (levels: GitTreeLevel[]) =>
    invoke<GitTreeStatus>("project_git_tree_status", { account: account(), levels }),
  /** Shows a file or folder in Finder or the system's file manager (`project/open_app.rs`). */
  reveal: (path: string) => invoke<void>("project_reveal", { account: account(), path }),
  /** Opens an HTML file in the person's default browser (`project/open_app.rs`). */
  openInBrowser: (path: string) =>
    invoke<void>("project_open_in_browser", { account: account(), path }),
};
