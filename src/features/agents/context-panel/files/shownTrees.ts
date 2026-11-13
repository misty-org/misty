import type { FilesStore } from "./filesStore";

/** A folder's tree as it was last shown: its read levels and their Git marks. */
type ShownTree = Pick<FilesStore, "children" | "repositories" | "fileColors">;

/**
 * The trees of folders shown before this session, newest last, so switching back to one paints
 * it at once and reads it again behind what shows. A few are kept; the oldest goes first.
 */
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
