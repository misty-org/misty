import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isRememberableHubRoute } from "../features/hub/store/useHubRouteMemoryStore";

interface AppRouteMemoryStore {
  lastAppRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}

const defaultAppRoute = "/files";

export const useAppRouteMemoryStore = create<AppRouteMemoryStore>()(
  persist(
    (set, get) => ({
      lastAppRoute: defaultAppRoute,
      rememberAppRoute: (path) => {
        const normalized = normalizeRememberedRoute(path);
        if (!normalized) return;
        if (get().lastAppRoute === normalized) return;
        set({ lastAppRoute: normalized });
      },
      resetAppRoute: () => set({ lastAppRoute: defaultAppRoute }),
    }),
    {
      name: "misty:app-route-memory",
      partialize: (state) => ({ lastAppRoute: state.lastAppRoute }),
    },
  ),
);

export function isRememberableAppRoute(path: string): boolean {
  const pathname = pathnameFromRoute(path);
  if (isRememberableHubRoute(pathname)) return true;
  return (
    pathname === "/files" ||
    pathname === "/providers" ||
    pathname === "/transfers" ||
    pathname === "/dock" ||
    pathname === "/activity" ||
    pathname === "/settings" ||
    pathname === "/diagnostics"
  );
}

function normalizeRememberedRoute(path: string): string | null {
  const pathname = pathnameFromRoute(path);
  if (!isRememberableAppRoute(pathname)) return null;
  if (pathname === "/dock") return path;
  return pathname;
}

function pathnameFromRoute(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end = [queryIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? path.length;
  return path.slice(0, end);
}
