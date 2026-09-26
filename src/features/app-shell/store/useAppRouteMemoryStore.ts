import { create } from "zustand";
import { persist } from "zustand/middleware";

const defaultAppRoute = "/browser";
const workspaceRoutes = ["/browser", "/files", "/agents", "/spaces"];

export interface AppRouteMemoryStore {
  lastAppRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}

export const useAppRouteMemoryStore = create<AppRouteMemoryStore>()(
  persist(
    (set, get) => ({
      lastAppRoute: defaultAppRoute,
      rememberAppRoute: (path) => {
        const normalized = normalizeRememberedRoute(path);
        if (normalized && get().lastAppRoute !== normalized) set({ lastAppRoute: normalized });
      },
      resetAppRoute: () => set({ lastAppRoute: defaultAppRoute }),
    }),
    {
      // Keep the storage key so an existing installation can recover its current destination.
      name: "misty:app-route-memory",
      partialize: (state) => ({ lastAppRoute: state.lastAppRoute }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppRouteMemoryStore> | undefined;
        return {
          ...currentState,
          lastAppRoute: normalizeRememberedRoute(persisted?.lastAppRoute ?? "") ?? defaultAppRoute,
        };
      },
    },
  ),
);

export function isRememberableAppRoute(path: string): boolean {
  return normalizeRememberedRoute(path) !== null;
}

function normalizeRememberedRoute(path: string): string | null {
  if (typeof path !== "string") return null;
  const pathname = path.split(/[?#]/, 1)[0];
  if (["/home", "/new", "/apps/browser"].includes(pathname)) return defaultAppRoute;
  if (pathname === "/apps/agents") return path.replace("/apps/agents", "/agents");
  if (!workspaceRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`)))
    return null;
  // URLs and navigation history belong to the browser tab, not shell route memory.
  return pathname === "/browser" ? defaultAppRoute : path.split("#", 1)[0];
}
