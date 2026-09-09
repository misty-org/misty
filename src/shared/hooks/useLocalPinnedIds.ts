import { usePinnedIds } from "./usePinnedIds";

export function useLocalPinnedIds(storageKey: string, availableIds: string[], loading = false) {
  return usePinnedIds(window.localStorage, storageKey, availableIds, loading);
}
