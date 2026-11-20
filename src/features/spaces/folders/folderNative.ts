import { invoke } from "@/shared/platform/nativeInvoke";

/** The picker's tree: what is copied, and what `.gitignore` or `.mistyignore` leave out. */
export interface FolderScan {
  included: { path: string; size: number }[];
  /** The topmost files and folders a rule leaves out; a folder's path ends in `/`. */
  excluded: string[];
  /** The tree stopped short: the folder is too big or deep to show whole. */
  truncated: boolean;
}

/**
 * Choosing a folder on this computer to copy into a Space's drive, and showing what its ignore rules leave
 * out. The copy itself is the drive's (`drive_copy_in`); these only pick, read and edit the rules.
 */
export const folderNative = {
  /** The system's folder dialog, opening at `start`. Null when the person cancels. Picking it is what lets
   * Misty read it. */
  pick: (start?: string) => invoke<string | null>("space_folder_pick", { start: start ?? null }),
  scan: (folder: string) => invoke<FolderScan>("space_folder_scan", { folder }),
  readIgnore: (folder: string) => invoke<string>("space_folder_ignore_read", { folder }),
  writeIgnore: (folder: string, text: string) =>
    invoke<void>("space_folder_ignore_write", { folder, text }),
};
