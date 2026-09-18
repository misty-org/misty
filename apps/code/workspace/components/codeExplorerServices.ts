import type { ComponentType } from "react";
import type { FileEntry } from "@/native/contracts/app-explorer";
import type { createCodingWorkspaceStore } from "../store/createCodingWorkspaceStore";
import type { CodeEditorServices } from "./createCodeEditor";

export type CodeExplorerEntry = Pick<FileEntry, "id" | "name" | "path" | "kind">;
export interface CodeExplorerServices {
  store: ReturnType<typeof createCodingWorkspaceStore>;
  listDirectory(path: string): Promise<{ entries: CodeExplorerEntry[] }>;
  createFile(path: string, contents?: string): Promise<unknown>;
  createFolder(path: string): Promise<unknown>;
  renamePath(from: string, to: string): Promise<unknown>;
  deletePath(path: string): Promise<unknown>;
  deleteItems(request: { paths: string[]; permanent: boolean }): Promise<unknown>;
  pasteItems(request: {
    sources: Array<{ path: string; isDirectory: boolean }>;
    destinationDirectory: string;
    operation: "copy" | "move";
  }): Promise<unknown>;
  renameItems(request: {
    items: Array<{ path: string; newName: string; sourceIsDirectory: boolean }>;
  }): Promise<unknown>;
  ErrorActivity: CodeEditorServices["ErrorActivity"];
  FolderPicker: ComponentType<{ onCancel(): void; onSelect(path: string): void }>;
  useRevision(root: string): number;
  rootName?(root: string): string;
}
