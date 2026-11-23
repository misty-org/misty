import { useContextPanel } from "../context_panel_store";
import { useChatFolders } from "../../shared-folders/chat_folder";
import { useFileIndex, type IndexEntry } from "./file_index";
import { joinPath, useFilesStore } from "./files_store";

interface FolderFileHit {
  folder: string;
  path: string;
  rel: string;
  name: string;
  match: number;
}

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

export async function searchFolderFiles(
  match: (name: string, rel: string) => number,
  limit = 8,
): Promise<FolderFileHit[]> {
  const folders = (await useChatFolders.getState().loadProjects()).map((project) => project.path);
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

export function openFolderFile(path: string): string {
  useContextPanel.getState().show("files");
  void useFilesStore.getState().openFile(path);
  return "/agents";
}
