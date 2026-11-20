import { filesApi } from "@/features/agents";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { uploadLibraryBlob, type LibraryUploadOptions } from "../../api/library-upload";
import { mimeFromFileName } from "../../library/library-primitives/libraryMediaTypes";
import { appFolderName, driveFileRef, driveHostError } from "../../drive/driveAppFiles";
import { driveNative, type DriveEntry } from "../../drive/driveNative";
import { HostError } from "../protocol";
import type { AppFileRef } from "../spaceAppFiles";

/** What the person chose in the file picker, by where each file is. */
export interface PickedFiles {
  /** Files already in the Space's drive. */
  drive: DriveEntry[];
  /** Files inside one of the person's projects, read through `project_read_bytes`. */
  projectFiles: string[];
  /** Files from anywhere else on this computer, chosen in the system's own dialog. */
  otherFiles: string[];
}

export const nameOfPath = (path: string) =>
  path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";

/** A project file added to Media, as the upload hands it back. */
export async function uploadProjectFile(
  spaceId: string,
  path: string,
  options?: LibraryUploadOptions,
) {
  options?.onStage?.("reading");
  const name = nameOfPath(path);
  const bytes = await filesApi.readBytes(path);
  return uploadLibraryBlob(
    spaceId,
    new Blob([bytes], { type: mimeFromFileName(name) }),
    name,
    "library",
    options,
  );
}

/**
 * The most a file copied into the drive from the picker may weigh: its bytes cross into native in one call.
 */
const MAX_COPY_BYTES = 128 * 1024 * 1024;

/** A file anywhere on this computer the person chose in the system's dialog, read whole. */
async function readPickedFile(path: string): Promise<ArrayBuffer> {
  const response = await fetch(safeTauriAssetUrl(path));
  if (!response.ok) throw new HostError("internal", `Misty couldn't read ${nameOfPath(path)}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_COPY_BYTES) throw tooBig(path);
  return response.arrayBuffer();
}

const tooBig = (path: string) =>
  new HostError("invalid", `${nameOfPath(path)} is too big to copy into the Space from here.`);

/**
 * What an app is handed for the files the person chose. An app only ever sees the Space's drive, so a file
 * from this computer, outside the drive, is copied into the app's own folder there (`/<App name>/`) first,
 * and the app gets that copy.
 */
export async function appFilesFor(
  spaceId: string,
  picked: PickedFiles,
  appName: string,
): Promise<AppFileRef[]> {
  const files = picked.drive.filter((entry) => entry.kind === "file").map(driveFileRef);
  const folder = `/${appFolderName(appName)}`;
  const copies = [
    ...picked.projectFiles.map((path) => ({ path, read: () => filesApi.readBytes(path) })),
    ...picked.otherFiles.map((path) => ({ path, read: () => readPickedFile(path) })),
  ];
  for (const copy of copies) {
    const bytes = await copy.read();
    if (bytes.byteLength > MAX_COPY_BYTES) throw tooBig(copy.path);
    const entry = await driveNative
      .write(spaceId, folder, nameOfPath(copy.path), bytes)
      .catch((cause) => {
        throw driveHostError(cause);
      });
    files.push(driveFileRef(entry));
  }
  return files;
}
