import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

/** Finder-style range and modifier selection for an ordered list of visible items. */
export function useRangeSelection(
  ids: string[],
  controlledIds?: string[],
  onSelectionChange?: (ids: string[]) => void,
) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const current = controlledIds ?? selectedIds;
  const commit = useCallback(
    (next: string[]) => {
      setSelectedIds(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  useEffect(() => {
    const visible = new Set(ids);
    const selected = current;
    const next = selected.filter((id) => visible.has(id));
    if (next.length !== selected.length) {
      commit(next);
    }
    if (anchor.current && !visible.has(anchor.current)) anchor.current = undefined;
  }, [ids, current, commit]);

  const select = useCallback(
    (event: MouseEvent, id: string, onOpen: () => void) => {
      const position = ids.indexOf(id);
      if (position < 0) return;
      if (event.shiftKey && anchor.current) {
        const from = ids.indexOf(anchor.current);
        if (from >= 0) {
          commit(ids.slice(Math.min(from, position), Math.max(from, position) + 1));
          return;
        }
      }
      anchor.current = id;
      if (event.metaKey || event.ctrlKey) {
        commit(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
        return;
      }
      commit([]);
      onOpen();
    },
    [ids, current, commit],
  );

  const clear = useCallback(() => {
    anchor.current = undefined;
    commit([]);
  }, [commit]);

  return { selectedIds: current, setSelectedIds: commit, select, clear };
}
