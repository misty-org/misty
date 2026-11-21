// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

type Modifiers = Pick<MouseEvent | KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey">;

/**
 * Finder's selection over a list in its shown order: a click picks one, ⌘ (Ctrl) adds or takes one away,
 * ⇧ picks the run from the anchor. Arrow moves start from the lead, the last one picked.
 */
export function useSelection(multiple: boolean) {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const lead = useRef<string | undefined>(undefined);

  const pick = useCallback(
    (id: string, order: readonly string[], modifiers?: Modifiers) => {
      const extend = multiple && modifiers?.shiftKey;
      const toggle = multiple && (modifiers?.metaKey || modifiers?.ctrlKey);
      lead.current = id;
      if (extend && anchor.current && order.includes(anchor.current) && order.includes(id)) {
        const [from, to] = [order.indexOf(anchor.current), order.indexOf(id)].sort((a, b) => a - b);
        return setSelected(order.slice(from, to + 1));
      }
      anchor.current = id;
      if (toggle)
        return setSelected((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id]));
      setSelected([id]);
    },
    [multiple],
  );

  /** Moves the lead by `delta` rows (or to an end), extending with ⇧. Answers the new lead. */
  const move = useCallback(
    (delta: number, order: readonly string[], extend: boolean): string | undefined => {
      if (!order.length) return undefined;
      const from = lead.current ? order.indexOf(lead.current) : -1;
      const index = from < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, from + delta));
      const id = order[index];
      if (extend && multiple) {
        if (!anchor.current || !order.includes(anchor.current)) anchor.current = order[Math.max(from, 0)];
        const [a, b] = [order.indexOf(anchor.current), index].sort((x, y) => x - y);
        setSelected(order.slice(a, b + 1));
        lead.current = id;
      } else pick(id, order);
      return id;
    },
    [multiple, pick],
  );

  const selectAll = useCallback(
    (order: readonly string[]) => {
      if (!multiple) return;
      setSelected([...order]);
      anchor.current = order[0];
      lead.current = order[order.length - 1];
    },
    [multiple],
  );

  /** Sets the selection outright (after a change, a reveal, the columns). */
  const set = useCallback((ids: string[]) => {
    setSelected(ids);
    anchor.current = ids[0];
    lead.current = ids[ids.length - 1];
  }, []);

  return { selected, pick, move, selectAll, set };
}
