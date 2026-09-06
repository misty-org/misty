import type { MistyAppSDK, MistyFileSource } from "@misty/sdk";
import type {
  CreateItemRequest,
  DirectoryListing,
  ExplorerLocation,
  ExplorerOperationResult,
  FileEntry,
  ListDirectoryRequest,
  RenameItemRequest,
} from "@/native/contracts";
import {
  openSdkCodeProject,
  transferSdkCodeEntry,
} from "@/features/coding-workspace/sdkCodeProject";

// Reuse the existing owned-directory implementation. Its virtual paths are UI
// identifiers; the Files component never receives an ambient native path.
type Directory = NonNullable<Awaited<ReturnType<typeof openSdkCodeProject>>>;
const directories = new WeakMap<object, Directory>();
const local: ExplorerLocation = {
  kind: "local",
  providerType: null,
  remoteName: null,
  remotePath: null,
};

export async function openSdkFilesDirectory(
  misty: Pick<MistyAppSDK, "files">,
  options: NonNullable<Parameters<typeof openSdkCodeProject>[1]> & {
    source?: MistyFileSource;
  } = {},
) {
  const directory = await openSdkCodeProject(misty, options);
  if (!directory) return null;
  const parent = (path: string) =>
    path === directory.root ? null : path.slice(0, path.lastIndexOf("/"));
  const changed = (path: string): ExplorerOperationResult => ({
    affectedPaths: [path],
    parentPath: parent(path),
  });
  const result = {
    root: directory.root,
    source: options.source,
    name: directory.name,
    writable: directory.writable,
    close: directory.close,
    watch: directory.watch,
    stat: directory.stat,
    readText: directory.readText,
    readBytes: directory.readBytes,
    writeText: directory.writeText,
    saveBytes: directory.saveBytes,
    openExternal: directory.openExternal,
    previewImage: directory.previewImage,
    startDrag: directory.startDrag,
    withDragHandle: directory.withDragHandle,
    importDrop: directory.importDrop,
    listArchive: directory.listArchive,
    remember: directory.remember,
    forget: directory.forget,
    reference: directory.reference,
    share: directory.share,
    cancelShare: directory.cancelShare,
    async list(request: ListDirectoryRequest = {}): Promise<DirectoryListing> {
      const path = request.path || directory.root;
      const children = await directory.list(path);
      const entries: FileEntry[] = children.map((entry) => ({
        id: entry.path,
        path: entry.path,
        name: entry.name,
        kind: entry.kind === "directory" ? "folder" : entry.kind,
        extension:
          entry.kind === "file" && entry.name.includes(".")
            ? entry.name.slice(entry.name.lastIndexOf(".") + 1)
            : "",
        mimeType: null,
        remoteModified: null,
        sizeBytes: entry.bytes ?? null,
        modifiedMs: null,
        createdMs: null,
        readonly: !directory.writable || !["file", "directory"].includes(entry.kind),
        hidden: entry.name.startsWith("."),
        location:
          options.source && options.source.kind !== "local"
            ? {
                kind: options.source.kind === "device" ? "peer_device" : "remote",
                providerType: options.source.providerType,
                remoteName: options.source.name,
                remotePath: null,
              }
            : { ...local },
      }));
      return {
        path,
        title: path === directory.root ? directory.name : childrenTitle(path),
        parentPath: parent(path),
        location:
          options.source && options.source.kind !== "local"
            ? {
                kind: options.source.kind === "device" ? "peer_device" : "remote",
                providerType: options.source.providerType,
                remoteName: options.source.name,
                remotePath: null,
              }
            : { ...local },
        entries: request.showHidden ? entries : entries.filter((entry) => !entry.hidden),
        totalCount: entries.length,
        hiddenCount: entries.filter((entry) => entry.hidden).length,
      };
    },
    async create(request: CreateItemRequest) {
      if (!request.name || /[/\\\0]/.test(request.name) || [".", ".."].includes(request.name))
        throw new Error("Enter a file or folder name without path separators.");
      const created = await directory.create(
        `${request.directory}/${request.name}`,
        request.kind === "folder" ? "directory" : "file",
      );
      return changed(created.path);
    },
    async rename(request: RenameItemRequest) {
      const renamed = await directory.rename(request.path, request.newName);
      return { ...changed(renamed.path), previousPath: request.path };
    },
    async remove(path: string, recursive = false) {
      await directory.remove(path, { recursive });
      return changed(path);
    },
  };
  directories.set(result, directory);
  return result;
}

function childrenTitle(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export type SdkFilesDirectory = NonNullable<Awaited<ReturnType<typeof openSdkFilesDirectory>>>;

export function transferSdkFilesEntry(
  source: SdkFilesDirectory,
  destination: SdkFilesDirectory,
  path: string,
  destinationPath: string,
  operation: "copy" | "move",
  options: Parameters<typeof transferSdkCodeEntry>[5] = {},
) {
  const from = directories.get(source),
    to = directories.get(destination);
  if (!from || !to) throw new Error("Choose folders belonging to this Files view.");
  return transferSdkCodeEntry(from, to, path, destinationPath, operation, options);
}
