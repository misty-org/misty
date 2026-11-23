// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { DirEntry, RepositorySummary } from "./files_api";

interface ChainState {
  children: Record<string, DirEntry[]>;
  loadingDirs: Record<string, true>;
  dirErrors: Record<string, string>;
  repositories: Record<string, RepositorySummary>;
  hideIgnored: boolean;
}

export function nextChainDir(path: string, ignored: boolean, state: ChainState): DirEntry | null {
  if (state.repositories[path] || state.loadingDirs[path] || state.dirErrors[path]) return null;
  const visible = state.children[path]?.filter((entry) => !state.hideIgnored || !entry.ignored);
  if (visible?.length !== 1) return null;
  const [only] = visible;
  return only.isDir && !!only.ignored === ignored ? only : null;
}
