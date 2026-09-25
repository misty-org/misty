import { codeWalkFiles, type WalkedFile } from "../native";

interface FileIndexCacheEntry {
  files: WalkedFile[];
  dirty: boolean;
  pending: Promise<WalkedFile[]> | null;
}

const fileIndexCache = new Map<string, FileIndexCacheEntry>();

export function loadProjectFileIndex(rootPath: string): Promise<WalkedFile[]> {
  const cached = fileIndexCache.get(rootPath) ?? { files: [], dirty: true, pending: null };
  fileIndexCache.set(rootPath, cached);
  if (cached.pending) return cached.pending;
  if (!cached.dirty) return Promise.resolve(cached.files);
  cached.dirty = false;
  cached.pending = codeWalkFiles(rootPath)
    .then((files) => {
      cached.files = files;
      return files;
    })
    .catch((error) => {
      cached.dirty = true;
      throw error;
    })
    .finally(() => {
      cached.pending = null;
    });
  return cached.pending;
}

export function invalidateProjectFileIndex(rootPath: string) {
  const cached = fileIndexCache.get(rootPath);
  if (cached) cached.dirty = true;
  else fileIndexCache.set(rootPath, { files: [], dirty: true, pending: null });
}

export { rankFiles } from "./rankCodeFiles";
