import { useEffect, useMemo } from "react";
import { restoreJoin } from "./liveSession";
import { useLiveStore } from "./liveStore";

export { LiveMain, useLiveMainShown } from "./LiveMain";
export { LivePresence } from "./LivePresence";
export { LiveSidebar } from "./LiveSidebar";
export { useLiveAddon } from "./useLiveAddon";

/**
 * The worktree the Code page shows instead of the Space folder while this window has joined a
 * live session of the repository at `spaceFolder`; null otherwise. A session joined before a
 * reload is joined again.
 */
export function useLiveWorkFolder(
  spaceFolder: string,
): { folder: string; sessionId: string; name: string } | null {
  const join = useLiveStore((state) => (spaceFolder ? state.joins[spaceFolder] : undefined));
  useEffect(() => useLiveStore.getState().hydrate(), []);
  useEffect(() => {
    if (join) restoreJoin(spaceFolder);
  }, [join, spaceFolder]);
  return useMemo(
    () => (join ? { folder: join.folder, sessionId: join.sessionId, name: join.name } : null),
    [join],
  );
}
