import { useSettingsStore } from "@/features/settings";
import { useCallback, useEffect, useRef, useState } from "react";
import { reorderIds } from "@/shared/hooks/usePointerReorder";

type Orders = Record<string, Record<string, string[]>>;
function orders(document: Record<string, unknown> | null | undefined): Orders {
  const navigation = document?.navigation as Record<string, unknown> | undefined;
  const value = navigation?.orders_by_account;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Orders) : {};
}
export function orderedNavigatorIds(ids: string[], saved: unknown): string[] {
  const order = Array.isArray(saved)
    ? saved.filter((id): id is string => typeof id === "string" && ids.includes(id))
    : [];
  return [...new Set([...order, ...ids])];
}
export function useNavigatorOrder(accountId: string, section: string, ids: string[]) {
  const document = useSettingsStore((state) => state.settings?.document);
  const loaded = useSettingsStore((state) => state.loaded);
  const account = accountId || "guest";
  const scope = `${account}:${section}`;
  const [pending, setPending] = useState<{ scope: string; ids: string[] } | null>(null);
  const saved = orders(document)[account]?.[section];
  const current = orderedNavigatorIds(ids, pending?.scope === scope ? pending.ids : saved);
  const persist = useCallback(
    (next: string[]) => {
      const store = useSettingsStore.getState();
      if (!store.loaded) {
        setPending({ scope, ids: next });
        return;
      }
      const all = orders(store.settings?.document);
      store.updateSetting("navigation", "orders_by_account", {
        ...all,
        [account]: { ...all[account], [section]: next },
      });
      setPending(null);
    },
    [account, section, scope],
  );
  useEffect(() => {
    if (loaded && pending?.scope === scope) persist(pending.ids);
  }, [loaded, pending, scope, persist]);
  const currentRef = useRef(current);
  currentRef.current = current;
  return {
    ids: current,
    move: (id: string, target: string, after: boolean) => {
      const before = currentRef.current,
        next = reorderIds(before, [id], target, after);
      if (next !== before) persist(next);
    },
    step: (id: string, direction: -1 | 1) => {
      const before = currentRef.current,
        target = before[before.indexOf(id) + direction];
      if (target) persist(reorderIds(before, [id], target, direction === 1));
    },
  };
}
