import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@/shared/platform/nativeInvoke";
import { hasTauriInternals, safeTauriAssetUrl } from "@/shared/platform/tauri";

/**
 * Files' native side (`src-tauri/features/files/`): the person's whole disk, behind the disk grant.
 * Every path here is absolute, as the system writes it. Every command checks it came from a
 * person's own window, and every read and write passes `file_access::disk`, which never opens
 * `~/.misty` (except the Space drives under `~/.misty/mnt`), the keychains, or system folders for
 * writing.
 *
 * Rust returns these shapes with `#[serde(rename_all = "camelCase")]`; arguments are the
 * commands' parameters in camelCase.
 */

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────────

/** A Finder tag on an item: its name and Finder's color number (0 none, 1 gray, 2 green, 3 purple,
 * 4 blue, 5 yellow, 6 red, 7 orange). Only macOS has them; elsewhere every list of them is empty. */
export interface FinderTag {
  name: string;
  color: number;
}

export type FileKind = "folder" | "file" | "link" | "package";

/** One item in a folder. */
export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  /** Bytes; 0 for a folder (its size is `files_folder_size`'s). */
  size: number;
  modifiedMs: number;
  createdMs: number;
  /** Starts with a dot, or the system marks it hidden. */
  hidden: boolean;
  /** The lowercase extension without its dot, when it has one. */
  ext?: string;
  /** Where a link points, for `link`. */
  linkTarget?: string;
  tags: FinderTag[];
}

export interface Listing {
  path: string;
  entries: FileEntry[];
}

/** Get Info. */
export interface FileInfo {
  entry: FileEntry;
  /** What it is in words: "PDF document", "Folder", "Application". */
  kindLabel: string;
  /** The folder it is in. */
  parent: string;
  /** `rwxr-xr-x` on unix, "Read only" / "Read and write" on Windows. */
  permissions: string;
  /** Whose it is, when the system says. */
  owner?: string;
  /** The person's own user owns it and the folder it's in: agents may change it. */
  ownedByYou: boolean;
  /** For an image: its pixel size. */
  dimensions?: { width: number; height: number };
  /** The app that opens it by default. */
  defaultApp?: string;
}

export interface FolderSize {
  bytes: number;
  items: number;
}

/** Files' thumbnail cache: the most it may hold and what it holds now, in bytes. */
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

/** The sidebar's fixed places. Each is absent when this system has none. */
export interface Places {
  home: string;
  desktop?: string;
  documents?: string;
  downloads?: string;
  applications?: string;
  drives: Drive[];
}

/** An item already in the folder a copy or move goes to. */
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
  /** The new paths, in the order of the sources. */
  created: string[];
  failed: Failure[];
  cancelled: boolean;
}

/** `files://progress`, while a long operation runs. */
export interface Progress {
  opId: string;
  /** What it is doing: "Copying", "Moving", "Compressing", "Finding duplicates". */
  label: string;
  doneBytes: number;
  totalBytes: number;
  /** The item it is on now. */
  item?: string;
}

/** Something Misty moved to the system Trash, which Put Back returns. */
export interface TrashedItem {
  id: string;
  name: string;
  originalPath: string;
  trashedPath: string;
  trashedAt: number;
  kind: FileKind;
  size: number;
}

/** What Undo and Redo would do now, in words ("Undo Move", "Redo Rename"), when there is one. */
export interface UndoState {
  undo?: string;
  redo?: string;
}

export interface ClipboardFiles {
  paths: string[];
  /** The paths were cut: pasting moves them. */
  cut: boolean;
}

export interface AppChoice {
  name: string;
  /** The app's own path, which `files_open_with` takes. */
  path: string;
  isDefault: boolean;
}

/** A batch rename: one of three rules, as Finder's Rename Items. */
export type RenameRule =
  | { kind: "replace"; find: string; replace: string }
  | { kind: "add"; text: string; at: "before" | "after" }
  | { kind: "format"; base: string; start: number; at: "before" | "after" };

export interface RenamePreview {
  from: string;
  to: string;
  /** The new name is taken or empty: this one won't rename. */
  clash: boolean;
}

export interface DuplicateGroup {
  size: number;
  hash: string;
  paths: string[];
}

export type CompareState = "same" | "changed" | "only-left" | "only-right";

export interface CompareRow {
  /** The path inside both folders. */
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

/** What an agent moved to Agent trash (`files_agent_trash` in `misty.db`). */
export interface AgentTrashItem {
  id: number;
  name: string;
  originalPath: string;
  /** Where it waits; absent for a Space drive's item, which the drive's own trash keeps. */
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
  /** When the oldest item went in, when there is one. */
  oldestMs?: number;
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────────

export const disk = {
  // The grant
  /** Whether the disk grant is on, without asking. */
  granted: () => invoke<boolean>("files_grant_status"),
  /** Asks for the disk grant in a native prompt if it is off; true once it is on. */
  grant: () => invoke<boolean>("files_grant"),
  /** Turns the disk grant off (Settings › Agents › Access). */
  revokeGrant: () => invoke<void>("files_grant_revoke"),

  // Places and listing
  places: () => invoke<Places>("files_places"),
  list: (path: string, hidden: boolean) => invoke<Listing>("files_list", { path, hidden }),
  info: (path: string) => invoke<FileInfo>("files_info", { path }),
  folderSize: (path: string) => invoke<FolderSize>("files_folder_size", { path }),
  freeSpace: (path: string) => invoke<FreeSpace>("files_free_space", { path }),
  /** Starts sending `files://changed` for this folder; `unwatch` stops. Several watches may run. */
  watch: (path: string) => invoke<void>("files_watch", { path }),
  unwatch: (path: string) => invoke<void>("files_unwatch", { path }),
  /** A text file's start, for Quick Look and the info panel (the project panel's 1 MB cap). */
  readText: (path: string) =>
    invoke<{ text: string; truncated: boolean }>("files_read_text", { path }),
  /** A file's bytes, up to 100 MB, for previews and for copying into a Space drive. */
  readBytes: (path: string) => invoke<ArrayBuffer>("files_read_bytes", { path }),

  // Making and changing
  createFolder: (dir: string, name: string) =>
    invoke<FileEntry>("files_create_folder", { dir, name }),
  createFile: (dir: string, name: string) => invoke<FileEntry>("files_create_file", { dir, name }),
  rename: (path: string, name: string) => invoke<FileEntry>("files_rename", { path, name }),
  duplicate: (paths: string[]) => invoke<string[]>("files_duplicate", { paths }),
  conflicts: (sources: string[], dir: string) =>
    invoke<Conflict[]>("files_conflicts", { sources, dir }),
  /** Copies or moves into `dir`. `resolutions` answers each conflict by its source path; a source
   * with a conflict and no answer is skipped. Sends `files://progress` under `opId`. */
  transfer: (
    op: "copy" | "move",
    sources: string[],
    dir: string,
    resolutions: Record<string, Resolution>,
    opId: string,
  ) => invoke<TransferResult>("files_transfer", { op, sources, dir, resolutions, opId }),
  /** Stops the operation running under `opId`; what it already did stays. */
  cancel: (opId: string) => invoke<void>("files_cancel", { opId }),

  // Trash
  trash: (paths: string[]) => invoke<TrashedItem[]>("files_trash", { paths }),
  /** What Misty moved to the Trash that is still there, newest first. */
  trashed: () => invoke<TrashedItem[]>("files_trashed"),
  putBack: (ids: string[]) => invoke<TransferResult>("files_put_back", { ids }),
  /** Deletes for good. Only after `ConfirmDeleteDialog`. */
  deleteForever: (paths: string[]) => invoke<Failure[]>("files_delete_forever", { paths }),

  // Undo
  undoState: () => invoke<UndoState>("files_undo_state"),
  undo: () => invoke<UndoState>("files_undo"),
  redo: () => invoke<UndoState>("files_redo"),

  // Clipboard (the system's, so Finder and Explorer see the same files)
  copyToClipboard: (paths: string[], cut: boolean) =>
    invoke<void>("files_clipboard_set", { paths, cut }),
  clipboard: () => invoke<ClipboardFiles>("files_clipboard"),

  // Opening
  open: (paths: string[]) => invoke<void>("files_open", { paths }),
  appsFor: (path: string) => invoke<AppChoice[]>("files_apps_for", { path }),
  openWith: (path: string, app: string) => invoke<void>("files_open_with", { path, app }),
  /** Shows it in Finder or Explorer. */
  reveal: (path: string) => invoke<void>("files_reveal", { path }),
  /** Opens the system terminal in a folder (Kura's terminal button). */
  openTerminal: (path: string) => invoke<void>("files_open_terminal", { path }),

  // Starred, Recent, Tags
  starred: () => invoke<FileEntry[]>("files_starred"),
  star: (paths: string[], on: boolean) => invoke<void>("files_star", { paths, on }),
  recent: () => invoke<FileEntry[]>("files_recent"),
  /** Notes that the person opened it, for Recent. */
  noteRecent: (path: string) => invoke<void>("files_note_recent", { path }),
  /** Every tag in use and Finder's own, for the sidebar and the tag menu. */
  tags: () => invoke<FinderTag[]>("files_tags"),
  setTags: (paths: string[], tags: FinderTag[]) => invoke<void>("files_set_tags", { paths, tags }),
  tagged: (name: string) => invoke<FileEntry[]>("files_tagged", { name }),

  // Search
  search: (query: string, scope: string | null, limit: number) =>
    invoke<FileEntry[]>("files_search", { query, scope, limit }),
  indexStatus: () => invoke<IndexStatus>("files_index_status"),

  // Power tools
  compress: (paths: string[]) => invoke<string>("files_compress", { paths }),
  extract: (path: string) => invoke<string>("files_extract", { path }),
  checksum: (path: string) => invoke<string>("files_checksum", { path }),

  // The thumbnail cache (`src-tauri/features/files/thumbnail_cache.rs`): its limit is a device
  // setting native code keeps, and setting it trims the cache at once.
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
  compare: (left: string, right: string) => invoke<CompareRow[]>("files_compare", { left, right }),

  // Agent trash (the person's window only; no tool or SDK call reaches these)
  agentTrash: () => invoke<AgentTrashItem[]>("files_agent_trash_list"),
  agentTrashUsage: () => invoke<AgentTrashUsage>("files_agent_trash_usage"),
  agentTrashPutBack: (ids: number[], resolution: Resolution) =>
    invoke<TransferResult>("files_agent_trash_put_back", { ids, resolution }),
  agentTrashDelete: (ids: number[]) => invoke<Failure[]>("files_agent_trash_delete", { ids }),
  agentTrashEmpty: () => invoke<Failure[]>("files_agent_trash_empty"),

  // Letting agents delete (off by default; turning it on is a native warning)
  agentDeleteOn: () => invoke<boolean>("files_agent_delete_status"),
  /** Shows the native warning; true only if the person chose "Let agents delete". */
  allowAgentDelete: () => invoke<boolean>("files_agent_delete_allow"),
  stopAgentDelete: () => invoke<void>("files_agent_delete_stop"),
};

/** A picture of the file, small, for a grid card or the info panel: served by the `misty-disk:`
 * protocol under the disk grant (`src-tauri/features/files/protocol.rs`), to a person's window
 * only. `modifiedMs` makes a changed file load anew. */
export function thumbnailUrl(path: string, modifiedMs: number, size: number): string {
  const query = new URLSearchParams({ kind: "thumbnail", size: String(size), v: String(modifiedMs) });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

/** The file itself, for Quick Look's image, video, audio and PDF views. */
export function fileUrl(path: string, modifiedMs: number): string {
  const query = new URLSearchParams({ kind: "file", v: String(modifiedMs) });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

/** The same picture of a file in a Space's drive (`path` from the drive's root), from the content this
 * computer already holds: a file only on the server isn't served, so a grid never downloads it. */
export function driveThumbnailUrl(spaceId: string, path: string, modifiedMs: number, size: number): string {
  const query = new URLSearchParams({ kind: "thumbnail", size: String(size), v: String(modifiedMs), space: spaceId });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

/** A Space drive's file itself, streamed from this computer's copy, for the preview. */
export function driveFileUrl(spaceId: string, path: string, modifiedMs: number): string {
  const query = new URLSearchParams({ kind: "file", v: String(modifiedMs), space: spaceId });
  return `${safeTauriAssetUrl(path, "misty-disk")}?${query.toString()}`;
}

// ── Events ──────────────────────────────────────────────────────────────────────────────────────

/** `files://changed`: something in a watched folder changed. */
export interface FolderChange {
  path: string;
}

/** `files://index`: the search index moved on. */
export type IndexChange = IndexStatus;

export const fileEvents = {
  changed: "files://changed",
  progress: "files://progress",
  index: "files://index",
  /** `files://reveal`: an agent's `files.reveal` asks the person's window to show an item. */
  reveal: "files://reveal",
} as const;

/** Hears one of Files' events; outside the Misty app it hears nothing. Returns the stop. */
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
