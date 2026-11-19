import { readApiSessionGeneration } from "@/api/client/session";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { assertStableSpaceAccount } from "../api/api";
import { folderNative, withFolderProgress, type FolderProgress } from "./folderNative";
import { spaceFoldersApi, type SpaceFolder, type SpaceFolderFile } from "./spaceFoldersApi";

/**
 * Which folder on this computer each shared folder came from, by `<space>/<folder id>`, so
 * Upload changes opens the dialog there. Kept for this device only.
 */
export const useFolderSources = createDeviceSetting<Record<string, string>>({
  scope: "spaces.folders.sources",
  defaults: {},
  normalize: (stored) =>
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? Object.fromEntries(
          Object.entries(stored as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {},
});

const sourceKey = (spaceId: string, folderId: string) => `${spaceId}/${folderId}`;

/** The folder on this computer a shared folder was last uploaded from, if it was from here. */
export function folderSource(spaceId: string, folderId: string): string | undefined {
  return useFolderSources.getState().value[sourceKey(spaceId, folderId)];
}

export function forgetFolderSource(spaceId: string, folderId: string) {
  const key = sourceKey(spaceId, folderId);
  if (!(key in useFolderSources.getState().value)) return;
  useFolderSources.getState().set((current) => {
    const { [key]: _gone, ...rest } = current;
    return rest;
  });
}

function rememberFolderSource(spaceId: string, folderId: string, localFolder: string) {
  const key = sourceKey(spaceId, folderId);
  useFolderSources.getState().set((current) => ({ ...current, [key]: localFolder }));
}

/** The last part of a path: what a new shared folder is called unless the person renames it. */
export function folderNameFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "Folder"
  );
}

/** Lets the person pick a folder in the system's dialog. Null when they cancel. */
export function pickFolderToShare(start?: string): Promise<string | null> {
  return folderNative.pick(start);
}

export type ShareStage = "reading" | "uploading" | "saving";
export type ShareProgress = Omit<FolderProgress, "folder"> & { stage: ShareStage };

/**
 * Shares `localFolder` into the Space, or uploads its changes to an existing shared folder:
 * reads and hashes its files natively, asks the server which ones it lacks, sends those natively
 * straight to object storage on the signed addresses the server hands out (the bytes never pass
 * through the Space server), then commits the new file list. A folder made here is removed again
 * if the upload fails.
 */
export async function uploadFolder(input: {
  spaceId: string;
  localFolder: string;
  /** For a new shared folder. */
  name?: string;
  /** For Upload changes. */
  folderId?: string;
  onProgress: (progress: ShareProgress) => void;
}): Promise<SpaceFolder> {
  const { spaceId, localFolder, onProgress } = input;
  const generation = readApiSessionGeneration();
  const files = await withFolderProgress(
    localFolder,
    ({ folder: _folder, ...progress }) => onProgress({ stage: "reading", ...progress }),
    () => folderNative.manifest(localFolder),
  );
  if (!files.length) throw new Error("Nothing in that folder is shared. Check .mistyignore.");
  assertStableSpaceAccount(generation);

  let folderId = input.folderId;
  let created = false;
  if (!folderId) {
    const name = input.name?.trim() || folderNameFromPath(localFolder);
    folderId = (await spaceFoldersApi.create(spaceId, name)).id;
    created = true;
  }
  try {
    const diff = await spaceFoldersApi.diff(spaceId, folderId, files);
    assertStableSpaceAccount(generation);
    const byContent = new Map<string, SpaceFolderFile>();
    for (const file of files) {
      const key = `${file.sha256}:${file.size}`;
      if (!byContent.has(key)) byContent.set(key, file);
    }
    const uploads: {
      path: string;
      url: string;
      method?: string;
      headers?: Record<string, string>;
    }[] = [];
    let bytesTotal = 0;
    for (const upload of diff.upload) {
      const file = byContent.get(`${upload.sha256.toLowerCase()}:${upload.size}`);
      if (!file)
        throw new Error("The server asked for a file that isn't in the folder. Try again.");
      uploads.push({
        path: file.path,
        url: upload.url,
        method: upload.method,
        headers: upload.headers,
      });
      bytesTotal += file.size;
    }
    const total = uploads.length;
    onProgress({ stage: "uploading", done: 0, total, bytesDone: 0, bytesTotal });
    if (total)
      await withFolderProgress(
        localFolder,
        ({ folder: _folder, ...progress }) => onProgress({ stage: "uploading", ...progress }),
        () => folderNative.put(localFolder, uploads),
      );

    onProgress({ stage: "saving", done: total, total, bytesDone: bytesTotal, bytesTotal });
    const folder = await spaceFoldersApi.commit(spaceId, folderId, files);
    rememberFolderSource(spaceId, folder.id, localFolder);
    return folder;
  } catch (error) {
    if (created && folderId) void spaceFoldersApi.remove(spaceId, folderId).catch(() => undefined);
    throw error;
  }
}

/**
 * Brings this computer's copy of a shared folder up to date (only changed files are fetched,
 * straight from object storage on signed addresses) and returns where it is kept.
 */
export async function downloadFolder(
  spaceId: string,
  folder: SpaceFolder,
  onProgress: (progress: FolderProgress) => void,
): Promise<string> {
  const manifest = await spaceFoldersApi.manifest(spaceId, folder.id);
  return withFolderProgress(folder.id, onProgress, () =>
    folderNative.download(spaceId, folder.id, manifest.files),
  );
}
