// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { agentAccountId } from "../../personal/agent_account";

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  ignored?: boolean;
}

export interface FileContent {
  kind: "text" | "image" | "binary";
  text: string | null;
  size: number;
  mtimeMs: number;
  truncated: boolean;
}

interface FileOpResult {
  path: string;
  isDir: boolean;
}

interface PasteClipboardResult {
  created: FileOpResult[];
  failed: string[];
}

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
  rel: string;
  isDir: boolean;
}

export interface RepositorySummary {
  path: string;
  branch: string;
  changed: number;
  untracked: number;
}

export type FileTreeColor = "modified" | "untracked" | "repository";

interface GitTreeLevel {
  path: string;
  files: string[];
  directories: string[];
}

interface GitTreeStatus {
  repositories: RepositorySummary[];
  fileColors: Record<string, Record<string, FileTreeColor>>;
}

const account = () => agentAccountId();

export function imageFileUrl(path: string, version?: number): string {
  const query = new URLSearchParams({ account: account() });
  if (version !== undefined) query.set("v", String(version));
  return `${safeTauriAssetUrl(path, "misty-file")}?${query}`;
}

export const filesApi = {
  listDir: (path: string, gitIgnoreRoot?: string) =>
    invoke<DirEntry[]>("project_list_dir", { account: account(), path, gitIgnoreRoot }),
  readFile: (path: string) =>
    invoke<FileContent>("project_read_file", { account: account(), path }),
  readBytes: (path: string) =>
    invoke<ArrayBuffer>("project_read_bytes", { account: account(), path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("project_write_file", { account: account(), path, content }),
  createDir: (path: string) => invoke<void>("project_create_dir", { account: account(), path }),
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
  clipboardChangeCount: () => invoke<number | null>("project_clipboard_change_count"),
  clipboardSetFiles: (paths: string[]) =>
    invoke<number | null>("project_clipboard_set_files", { account: account(), paths }),
  searchText: (path: string, query: string) =>
    invoke<SearchHit[]>("project_search_text", { account: account(), path, query }),
  fileIndex: (path: string) =>
    invoke<FileIndexEntry[]>("project_file_index", { account: account(), path }),
  htmlPreview: (path: string) =>
    invoke<string>("project_html_preview_open", { account: account(), path }),
  gitTreeStatus: (levels: GitTreeLevel[]) =>
    invoke<GitTreeStatus>("project_git_tree_status", { account: account(), levels }),
  reveal: (path: string) => invoke<void>("project_reveal", { account: account(), path }),
  openInBrowser: (path: string) =>
    invoke<void>("project_open_in_browser", { account: account(), path }),
};
