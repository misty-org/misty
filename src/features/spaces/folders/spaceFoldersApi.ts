import { spaceRequest } from "../api/api";

/** A folder a member shared into the Space: its files live on the server, by content. */
export interface SpaceFolder {
  id: string;
  name: string;
  uploadedBy: { id: string; name: string };
  uploadedAt: string;
  byteSize: number;
  fileCount: number;
}

/** One file of a folder: its path inside the folder (`docs/notes.md`), checksum and size. */
export interface SpaceFolderFile {
  path: string;
  sha256: string;
  size: number;
}

/** A blob the server lacks, and where to send it. */
export interface SpaceFolderUpload {
  sha256: string;
  size: number;
  /** A presigned address on object storage, or the server's own proxy address. */
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

/** What the server needs for a new manifest: the blobs it lacks and the paths it will drop. */
export interface SpaceFolderDiff {
  upload: SpaceFolderUpload[];
  remove: string[];
  /** How many files it already holds. */
  reused: number;
}

export interface SpaceFolderManifest {
  folder: SpaceFolder;
  /** Each with a presigned or proxy address to fetch it from. */
  files: (SpaceFolderFile & { url: string })[];
}

function folderPath(spaceId: string, folderId?: string, rest = ""): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}/folders`;
  return folderId ? `${base}/${encodeURIComponent(folderId)}${rest}` : base;
}

export const spaceFoldersApi = {
  list: (spaceId: string) => spaceRequest<{ folders: SpaceFolder[] }>(folderPath(spaceId)),
  create: (spaceId: string, name: string) =>
    spaceRequest<SpaceFolder>(folderPath(spaceId), {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  diff: (spaceId: string, folderId: string, files: SpaceFolderFile[]) =>
    spaceRequest<SpaceFolderDiff>(folderPath(spaceId, folderId, "/diff"), {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  /** Replaces the folder's files with `files`; the last commit wins. */
  commit: (spaceId: string, folderId: string, files: SpaceFolderFile[]) =>
    spaceRequest<SpaceFolder>(folderPath(spaceId, folderId, "/commit"), {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  manifest: (spaceId: string, folderId: string) =>
    spaceRequest<SpaceFolderManifest>(folderPath(spaceId, folderId, "/manifest")),
  remove: (spaceId: string, folderId: string) =>
    spaceRequest(folderPath(spaceId, folderId), { method: "DELETE" }),
};
