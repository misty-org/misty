import { useContextPanel } from "../contextPanelStore";
import { useSpaceFolders } from "../../engines/enginesApi";
import { useFileIndex, type IndexEntry } from "./fileIndex";
import { joinPath, useFilesStore } from "./filesStore";

export interface FolderFileHit {
  folder: string;
  /** Where it is on disk. */
  path: string;
  /** Relative to its folder. */
  rel: string;
  name: string;
  match: number;
}

/** A folder's file list, waiting up to `wait` ms for its first walk. */
function entriesOf(folder: string, wait: number): Promise<IndexEntry[]> {
  const index = useFileIndex.getState();
  index.ensure(folder);
  const ready = () => {
    const known = useFileIndex.getState().byRoot[folder];
    return known && !known.loading ? known.entries : undefined;
  };
  const now = ready();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const stop = useFileIndex.subscribe(() => {
      const entries = ready();
      if (!entries) return;
      stop();
      clearTimeout(timer);
      resolve(entries);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(useFileIndex.getState().byRoot[folder]?.entries ?? []);
    }, wait);
  });
}

/**
 * The files in a Space's linked folders on this computer that `match` scores above 0, best first.
 * Matching is the caller's, so search ranks them as it ranks everything else.
 */
export async function searchFolderFiles(
  space: string,
  match: (name: string, rel: string) => number,
  limit = 8,
): Promise<FolderFileHit[]> {
  const folders = await useSpaceFolders.getState().load(space);
  const lists = await Promise.all(folders.map((folder) => entriesOf(folder, 2500)));
  const hits: FolderFileHit[] = [];
  lists.forEach((entries, index) => {
    const folder = folders[index];
    for (const entry of entries) {
      if (entry.isDir) continue;
      const score = match(entry.name, entry.rel);
      if (score > 0)
        hits.push({
          folder,
          path: joinPath(folder, entry.rel),
          rel: entry.rel,
          name: entry.name,
          match: score,
        });
    }
  });
  return hits.sort((a, b) => b.match - a.match || a.rel.length - b.rel.length).slice(0, limit);
}

/** Shows a file in the context panel's Files tab, beside the chat. */
export function openFolderFile(path: string) {
  useContextPanel.getState().show("files");
  void useFilesStore.getState().openFile(path);
}
