import { useCallback, useEffect, useMemo, useState } from "react";

type StoredPins = {
  key: string;
  ids: string[];
};

export function usePinnedIds(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  availableIds: string[],
  loading = false,
) {
  const [stored, setStored] = useState<StoredPins>(() => ({
    key: storageKey,
    ids: readPinnedIds(storage, storageKey),
  }));
  const availableIdsKey = availableIds.join("\u0000");
  const resolved = useMemo(
    () =>
      stored.key === storageKey
        ? stored
        : { key: storageKey, ids: readPinnedIds(storage, storageKey) },
    [storage, storageKey, stored],
  );

  useEffect(() => {
    if (stored.key !== storageKey) setStored(resolved);
  }, [resolved, storageKey, stored.key]);

  useEffect(() => {
    if (loading || stored.key !== storageKey) return;
    const available = new Set(availableIds);
    setStored((current) => {
      if (current.key !== storageKey) return current;
      const ids = current.ids.filter((id) => available.has(id));
      return ids.length === current.ids.length ? current : { ...current, ids };
    });
  }, [availableIds, availableIdsKey, loading, storageKey, stored.key]);

  useEffect(() => {
    if (stored.key !== storageKey) return;
    writePinnedIds(storage, storageKey, stored.ids);
  }, [storage, storageKey, stored]);

  const togglePinned = useCallback(
    (id: string) => {
      setStored((current) => {
        const ids = current.key === storageKey ? current.ids : readPinnedIds(storage, storageKey);
        return {
          key: storageKey,
          ids: ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [id, ...ids],
        };
      });
    },
    [storage, storageKey],
  );

  return {
    pinnedIds: resolved.ids,
    pinnedIdSet: useMemo(() => new Set(resolved.ids), [resolved.ids]),
    togglePinned,
  };
}

function readPinnedIds(storage: Pick<Storage, "getItem">, storageKey: string): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writePinnedIds(storage: Pick<Storage, "setItem">, storageKey: string, ids: string[]) {
  try {
    storage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // Personal pin state is optional.
  }
}
