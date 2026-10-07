import { definitionById } from "./profiles/registry";

/** The engine is stored by its legacy index; ids stay stable if the list is reordered. */
export function browserSearchEngineStorageIndex(id: string): number {
  return definitionById.get("browser.searchEngine")!.legacyValues!.indexOf(id);
}
