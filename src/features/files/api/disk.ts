import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@/shared/platform/native_invoke";
import { hasTauriInternals, safeTauriAssetUrl } from "@/shared/platform/tauri";

export interface FinderTag {
  name: string;
  color: number;
}

export type FileKind = "folder" | "file" | "link" | "package";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  modifiedMs: number;
  createdMs: number;
  hidden: boolean;
  ext?: string;
  linkTarget?: string;
  tags?: FinderTag[];
}

export interface Listing {
  path: string;
  entries: FileEntry[];
}

export interface FileInfo {
  entry: FileEntry;
  kindLabel: string;
  parent: string;
  permissions: string;
  owner?: string;
  ownedByYou: boolean;
  dimensions?: { width: number; height: number };
  defaultApp?: string;
}

export interface FolderSize {
  bytes: number;
  items: number;
}

export interface ThumbnailCacheStatus {
  limit: number;
  used: number;
}

export interface FreeSpace {
  free: number;
  total: number;
}

export interface Drive {
  name: string;
  path: string;
  removable: boolean;
}

export interface Places {
  home: string;
  desktop?: string;
  documents?: string;
  downloads?: string;
  applications?: string;
  drives: Drive[];
}

export interface Conflict {
  source: string;
  existing: FileEntry;
}

export type Resolution = "replace" | "keep-both" | "skip";

export interface Failure {
  path: string;
  error: string;
}

export interface TransferResult {
  created: string[];
  failed: Failure[];
  cancelled: boolean;
}

export interface Progress {
  opId: string;
  label: string;
  doneBytes: number;
  totalBytes: number;
  item?: string;
}

export interface TrashedItem {
  id: string;
  name: string;
  originalPath: string;
  trashedPath: string;
  trashedAt: number;
  kind: FileKind;
  size: number;
}

export interface UndoState {
  undo?: string;
  redo?: string;
}

export interface ClipboardFiles {
  paths: string[];
  cut: boolean;
}

export interface AppChoice {
  name: string;
  path: string;
  isDefault: boolean;
}

export type RenameRule =
  | { kind: "replace"; find: string; replace: string }
  | { kind: "add"; text: string; at: "before" | "after" }
  | { kind: "format"; base: string; start: number; at: "before" | "after" };

export interface RenamePreview {
  from: string;
  to: string;
  clash: boolean;
}

export interface DuplicateGroup {
  size: number;
  hash: string;
  paths: string[];
}

export type CompareState = "same" | "changed" | "only-left" | "only-right";

export interface CompareRow {
  relative: string;
  state: CompareState;
  folder: boolean;
  leftSize?: number;
  rightSize?: number;
}

export interface IndexStatus {
  state: "off" | "indexing" | "ready";
  files: number;
}

export interface AgentTrashItem {
  id: number;
  name: string;
  originalPath: string;
  holdingPath?: string;
  agentId: string;
  chatId?: string;
  trashedAt: number;
  size: number;
  kind: FileKind;
  spaceId?: string;
  driveItemId?: string;
}

export interface AgentTrashUsage {
  bytes: number;
  items: number;
  oldestMs?: number;
}

export const disk = {
  granted: () => invoke<boolean>("files_grant_status"),
  grant: () => invoke<boolean>("files_grant"),
  revokeGrant: () => invoke<void>("files_grant_revoke"),

  places: () => invoke<Places>("files_places"),
  list: (path: string, hidden: boolean) => invoke<Listing>("files_list", { path, hidden }),
  info: (path: string) => invoke<FileInfo>("files_info", { path }),
  folderSize: (path: string, opId: string) =>
    invoke<FolderSize>("files_folder_size", { path, opId }),
  freeSpace: (path: string) => invoke<FreeSpace>("files_free_space", { path }),
  watchOpen: (path: string, hidden: boolean) =>
    invoke<FolderWatch>("files_watch_open", { path, hidden }),
  watchClose: (id: string) => invoke<void>("files_watch_close", { id }),
  readHead: (path: string, limit: number) => invoke<FileHead>("files_read_head", { path, limit }),

  createFolder: (dir: string, name: string) =>
    invoke<FileEntry>("files_create_folder", { dir, name }),
  createFile: (dir: string, name: string) => invoke<FileEntry>("files_create_file", { dir, name }),
  rename: (path: string, name: string) => invoke<FileEntry>("files_rename", { path, name }),
  duplicate: (paths: string[]) => invoke<string[]>("files_duplicate", { paths }),
  conflicts: (sources: string[], dir: string) =>
    invoke<Conflict[]>("files_conflicts", { sources, dir }),
  transfer: (
    op: "copy" | "move",
    sources: string[],
    dir: string,
    resolutions: Record<string, Resolution>,
    opId: string,
  ) => invoke<TransferResult>("files_transfer", { op, sources, dir, resolutions, opId }),
  cancel: (opId: string) => invoke<void>("files_cancel", { opId }),

  trash: (paths: string[]) => invoke<TrashedItem[]>("files_trash", { paths }),
  trashed: () => invoke<TrashedItem[]>("files_trashed"),
  putBack: (ids: string[]) => invoke<TransferResult>("files_put_back", { ids }),
  deleteNow: (paths: string[], opId: string) =>
    invoke<Failure[]>("files_delete_now", { paths, opId }),
  deleteTrashed: (ids: string[]) => invoke<Failure[]>("files_delete_trashed", { ids }),

  undoState: () => invoke<UndoState>("files_undo_state"),
  undo: () => invoke<UndoState>("files_undo"),
  redo: () => invoke<UndoState>("files_redo"),

  copyToClipboard: (paths: string[], cut: boolean) =>
    invoke<void>("files_clipboard_set", { paths, cut }),
  clipboard: () => invoke<ClipboardFiles>("files_clipboard"),

  open: (paths: string[], confirmed = false) => invoke<void>("files_open", { paths, confirmed }),
  appsFor: (path: string) => invoke<AppChoice[]>("files_apps_for", { path }),
  openWith: (path: string, app: string, confirmed = false) =>
    invoke<void>("files_open_with", { path, app, confirmed }),
  reveal: (path: string) => invoke<void>("files_reveal", { path }),
  openTerminal: (path: string) => invoke<void>("files_open_terminal", { path }),

  starred: () => invoke<FileEntry[]>("files_starred"),
  star: (paths: string[], on: boolean) => invoke<void>("files_star", { paths, on }),
  recent: () => invoke<FileEntry[]>("files_recent"),
  noteRecent: (path: string) => invoke<void>("files_note_recent", { path }),
  tags: () => invoke<FinderTag[]>("files_tags"),
  setTags: (paths: string[], tags: FinderTag[]) => invoke<void>("files_set_tags", { paths, tags }),
  tagged: (name: string) => invoke<FileEntry[]>("files_tagged", { name }),

  search: (query: string, scope: string | null, limit: number) =>
    invoke<FileEntry[]>("files_search", { query, scope, limit }),
  indexStatus: () => invoke<IndexStatus>("files_index_status"),

  compress: (paths: string[], opId?: string) =>
    invoke<string>("files_compress", { paths, opId: opId ?? null }),
  extract: (path: string, opId: string) => invoke<string>("files_extract", { path, opId }),
  checksum: (path: string) => invoke<string>("files_checksum", { path }),

  thumbnailCache: () => invoke<ThumbnailCacheStatus>("files_thumbnail_cache"),
  setThumbnailCacheLimit: (bytes: number) =>
    invoke<ThumbnailCacheStatus>("files_set_thumbnail_cache_limit", { bytes }),
  makeLink: (path: string) => invoke<string>("files_make_link", { path }),
  renamePreview: (paths: string[], rule: RenameRule) =>
    invoke<RenamePreview[]>("files_rename_preview", { paths, rule }),
  renameMany: (paths: string[], rule: RenameRule) =>
    invoke<TransferResult>("files_rename_many", { paths, rule }),
  duplicates: (dir: string, opId: string) =>
    invoke<DuplicateGroup[]>("files_duplicates", { dir, opId }),
  compare: (left: string, right: string, opId: string) =>
    invoke<CompareRow[]>("files_compare", { left, right, opId }),

  agentTrash: () => invoke<AgentTrashItem[]>("files_agent_trash_list"),
  agentTrashUsage: () => invoke<AgentTrashUsage>("files_agent_trash_usage"),
  agentTrashPutBack: (ids: number[], resolution: Resolution) =>
    invoke<TransferResult>("files_agent_trash_put_back", { ids, resolution }),
  agentTrashDelete: (ids: number[]) => invoke<Failure[]>("files_agent_trash_delete", { ids }),
  agentTrashEmpty: () => invoke<Failure[]>("files_agent_trash_empty"),

  agentDeleteOn: () => invoke<boolean>("files_agent_delete_status"),
  allowAgentDelete: () => invoke<boolean>("files_agent_delete_allow"),
  stopAgentDelete: () => invoke<void>("files_agent_delete_stop"),
};

export function thumbnailUrl(path: string, modifiedMs: number, size: number): string {
  const query = new URLSearchParams({
    kind: "thumbnail",
    size: String(size),
    v: String(modifiedMs),
  });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

export function fileUrl(path: string, modifiedMs: number): string {
  const query = new URLSearchParams({ kind: "file", v: String(modifiedMs) });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

export function driveThumbnailUrl(
  spaceId: string,
  path: string,
  modifiedMs: number,
  size: number,
): string {
  const query = new URLSearchParams({
    kind: "thumbnail",
    size: String(size),
    v: String(modifiedMs),
    space: spaceId,
  });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

export function driveFileUrl(spaceId: string, path: string, modifiedMs: number): string {
  const query = new URLSearchParams({ kind: "file", v: String(modifiedMs), space: spaceId });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

export interface FolderWatch {
  id: string;
  path: string;
  entries: FileEntry[];
}

export interface FolderDelta {
  id: string;
  added: FileEntry[];
  changed: FileEntry[];
  removed: string[];
  reset?: boolean;
}

export interface FileHead {
  text: string;
  truncated: boolean;
  binary: boolean;
}

const NEEDS_CONFIRM = "needs-confirm:";

export function needsConfirm(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const at = message.indexOf(NEEDS_CONFIRM);
  return at < 0 ? null : message.slice(at + NEEDS_CONFIRM.length).trim() || "file";
}

export type IndexChange = IndexStatus;

export const fileEvents = {
  folder: "files://folder",
  progress: "files://progress",
  index: "files://index",
  reveal: "files://reveal",
} as const;

export function onFilesEvent<T>(event: string, listener: (payload: T) => void): () => void {
  if (!hasTauriInternals()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void getCurrentWebview()
    .listen<T>(event, ({ payload }) => {
      if (!stopped) listener(payload);
    })
    .then(
      (stop) => {
        if (stopped) stop();
        else unlisten = stop;
      },
      () => undefined,
    );
  return () => {
    stopped = true;
    unlisten?.();
  };
}
