import { useAppsStore } from "./useAppsStore";

// One authority refresh per Space, regardless of how many app views are mounted.
const refreshes = new Map<string, { users: number; release(): void }>();
const refreshMs = 15_000;
export function retainAppAccessRefresh(accountId: string, spaceId: string): () => void {
  const key = JSON.stringify([accountId, spaceId]);
  let entry = refreshes.get(key);
  if (!entry) {
    let lastRefresh = Date.now();
    void useAppsStore.getState().load(accountId, false, spaceId);
    const refresh = () => {
      if (Date.now() - lastRefresh < refreshMs) return;
      lastRefresh = Date.now();
      void useAppsStore.getState().load(accountId, true, spaceId);
    };
    const timer = window.setInterval(refresh, refreshMs);
    window.addEventListener("focus", refresh);
    entry = {
      users: 0,
      release: () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", refresh);
        refreshes.delete(key);
      },
    };
    refreshes.set(key, entry);
  }
  entry.users++;
  const retained = entry;
  return () => {
    if (--retained.users === 0) retained.release();
  };
}
