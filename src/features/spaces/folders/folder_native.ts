import { invoke } from "@/shared/platform/native_invoke";

export interface FolderScan {
  included: { path: string; size: number }[];
  excluded: string[];
  truncated: boolean;
}

export const folderNative = {
  pick: (start?: string) => invoke<string | null>("space_folder_pick", { start: start ?? null }),
  scan: (folder: string) => invoke<FolderScan>("space_folder_scan", { folder }),
  readIgnore: (folder: string) => invoke<string>("space_folder_ignore_read", { folder }),
  writeIgnore: (folder: string, text: string) =>
    invoke<void>("space_folder_ignore_write", { folder, text }),
};
