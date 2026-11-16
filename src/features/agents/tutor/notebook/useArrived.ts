import { useEffect, useRef, useState } from "react";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import type { Notebook } from "../tutorTypes";

/** How long something someone else just added stays lit, so it's seen arriving. */
const litMs = 2500;

/**
 * The sources and notes someone else or an agent added since the notebook opened, for a moment
 * after they arrive. What was there on opening, and what this person adds by hand, isn't lit.
 */
export function useArrived(notebook: Notebook): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const [lit, setLit] = useState<Set<string>>(() => new Set());
  const me = spacesGateway.maybe()?.me()?.userId;
  const items = [
    ...notebook.sources.map((source) => ({
      id: source.id,
      by: source.addedBy,
      agent: source.agent,
    })),
    ...notebook.notes.map((note) => ({ id: note.id, by: note.authorId, agent: note.agent })),
  ];
  const key = items.map((item) => item.id).join(",");
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(items.map((item) => item.id));
      return;
    }
    const arrived = items.filter(
      // What someone else added, or any agent, this person's own included: it arrives on its own.
      (item) => !seen.current!.has(item.id) && ((item.by && item.by !== me) || item.agent),
    );
    for (const item of items) seen.current.add(item.id);
    if (!arrived.length) return;
    setLit((current) => new Set([...current, ...arrived.map((item) => item.id)]));
    // Each arrival goes dark on its own clock, so a second one doesn't keep the first lit.
    timers.current.push(
      window.setTimeout(
        () =>
          setLit((current) => {
            const next = new Set(current);
            for (const item of arrived) next.delete(item.id);
            return next;
          }),
        litMs,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return lit;
}
