import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@/shared/platform/nativeInvoke";
import type { SpaceFolderFile } from "./spaceFoldersApi";

/** How far reading, uploading or downloading a folder has got. */
export interface FolderProgress {
  /** The local folder, or the shared folder's id for a download. */
  folder: string;
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

/** The picker's tree: shared files, and what `.gitignore` or `.mistyignore` leave out. */
export interface FolderScan {
  included: { path: string; size: number }[];
  /** The topmost files and folders a rule leaves out; a folder's path ends in `/`. */
  excluded: string[];
  /** The tree stopped short: the folder is too big or deep to show whole. */
  truncated: boolean;
}

export const FOLDER_PROGRESS_EVENT = "misty://space-folder-progress";

export const folderNative = {
  /** The system's folder dialog, opening at `start`. Null when the person cancels. */
  pick: (start?: string) => invoke<string | null>("space_folder_pick", { start: start ?? null }),
  scan: (folder: string) => invoke<FolderScan>("space_folder_scan", { folder }),
  readIgnore: (folder: string) => invoke<string>("space_folder_ignore_read", { folder }),
  writeIgnore: (folder: string, text: string) =>
    invoke<void>("space_folder_ignore_write", { folder, text }),
  manifest: (folder: string) => invoke<SpaceFolderFile[]>("space_folder_manifest", { folder }),
  put: (
    folder: string,
    uploads: { path: string; url: string; method?: string; headers?: Record<string, string> }[],
  ) => invoke<void>("space_folder_put", { folder, uploads }),
  /** Brings this computer's copy up to `files` and returns where it is kept. */
  download: (
    space: string,
    folderId: string,
    files: (SpaceFolderFile & { url: string; headers?: Record<string, string> })[],
  ) => invoke<string>("space_folder_download", { space, folderId, files }),
  cachePath: (space: string, folderId: string) =>
    invoke<string>("space_folder_cache_path", { space, folderId }),
};

/** Runs `work` while hearing its progress events for `folder`. */
export async function withFolderProgress<T>(
  folder: string,
  onProgress: (progress: FolderProgress) => void,
  work: () => Promise<T>,
): Promise<T> {
  const unlisten = await getCurrentWebview().listen<FolderProgress>(
    FOLDER_PROGRESS_EVENT,
    ({ payload }) => {
      if (payload.folder === folder) onProgress(payload);
    },
  );
  try {
    return await work();
  } finally {
    unlisten();
  }
}
