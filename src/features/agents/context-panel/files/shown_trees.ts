import type { FilesStore } from "./files_store";

type ShownTree = Pick<FilesStore, "children" | "repositories" | "fileColors">;

export const shownTrees = new Map<string, ShownTree>();
const MOST_SHOWN_TREES = 8;

export function keepShownTree(state: FilesStore) {
  if (!state.root || !state.children[state.root]) return;
  shownTrees.delete(state.root);
  shownTrees.set(state.root, {
    children: state.children,
    repositories: state.repositories,
    fileColors: state.fileColors,
  });
  if (shownTrees.size > MOST_SHOWN_TREES) shownTrees.delete(shownTrees.keys().next().value!);
}
