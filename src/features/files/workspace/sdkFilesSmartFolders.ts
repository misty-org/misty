import type { MistyAppSDK } from "@misty/sdk";
import type { SavedSearch } from "@/native/contracts";
import {
  createSidebarSmartFolders,
  type SidebarSmartFolderServices,
} from "./explorer/components/explorerSidebar/createSidebarSmartFolders";
const prefix = "files.smart-folder.v1.";
function key(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid smart folder ID.");
  return `${prefix}${id}`;
}
function parse(value: unknown): SavedSearch {
  const item = value as Partial<SavedSearch> | null;
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.query !== "string" ||
    !Number.isSafeInteger(item.updatedAtMs) ||
    !Array.isArray(item.rules) ||
    item.rules.some(
      (rule) =>
        !rule ||
        typeof rule.field !== "string" ||
        typeof rule.operator !== "string" ||
        typeof rule.value !== "string",
    )
  )
    throw new Error("Saved smart folder data is invalid.");
  key(item.id);
  return {
    id: item.id,
    name: item.name,
    query: item.query,
    updatedAtMs: item.updatedAtMs!,
    rules: item.rules.map((rule) => ({
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
    })),
  };
}
/** Each saved search has its own key, so separate views never replace the entire list. */
export function createSdkFilesSmartFolders(
  misty: Pick<MistyAppSDK, "storage">,
  signal: AbortSignal,
  openSearch: SidebarSmartFolderServices["openSearch"],
) {
  const assert = () => {
    if (signal.aborted) throw new Error("This Files view is closed.");
  };
  const snapshot = async () => {
    assert();
    const keys = await misty.storage.local.keys();
    assert();
    const searches: SavedSearch[] = [];
    for (const storedKey of keys.filter((key) => key.startsWith(prefix))) {
      const value = await misty.storage.local.get(storedKey);
      assert();
      if (value === null) continue;
      const search = parse(value);
      if (key(search.id) !== storedKey)
        throw new Error("Saved smart folder ID does not match its record.");
      searches.push(search);
    }
    return { searches };
  };
  const services: SidebarSmartFolderServices = {
    snapshot,
    async save(value) {
      assert();
      const search = parse(value);
      await misty.storage.local.set(key(search.id), search);
      return snapshot();
    },
    async delete(id) {
      assert();
      await misty.storage.local.delete(key(id));
      return snapshot();
    },
    async openSearch(path, query) {
      assert();
      await openSearch(path, query);
    },
  };
  return { services, useSidebarSmartFolders: createSidebarSmartFolders(services) };
}
