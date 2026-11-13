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

  /** What a right-click on `id` acts on: the selection when `id` is in it, else `id` alone. */
  const menuTargets = useCallback(
    (id: string) => (current.includes(id) ? current : [id]),
    [current],
  );

  /** A right-click outside the selection selects that item alone, as in Finder. */
  const pickForMenu = useCallback(
    (id: string) => {
      if (current.includes(id) || !ids.includes(id)) return;
      anchor.current = id;
      commit([id]);
    },
    [ids, current, commit],
  );

  // Escape lets go of the selection.
  const hasSelection = current.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection, clear]);

  return { selectedIds: current, setSelectedIds: commit, select, clear, menuTargets, pickForMenu };
}
