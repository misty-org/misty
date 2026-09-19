import { createContext, useContext, type ComponentType } from "react";
import type { FileEntry } from "@/native/contracts";

export interface FileBrowserRuntime {
  thumbnailPreviewsEnabled: boolean;
  compactModeEnabled: boolean;
  prewarmThumbnails(entries: FileEntry[]): void;
  requestThumbnail(
    entry: FileEntry,
    maxDimension: number,
    subscriber: (url: string | null) => void,
  ): () => void;
  Error: ComponentType<{ error: string; paneId: string }>;
}

const Runtime = createContext<FileBrowserRuntime | null>(null);
export const FileBrowserRuntimeProvider = Runtime.Provider;
export function useFileBrowserRuntime(): FileBrowserRuntime {
  const runtime = useContext(Runtime);
  if (!runtime) throw new Error("FileBrowser requires its owning app runtime.");
  return runtime;
}
