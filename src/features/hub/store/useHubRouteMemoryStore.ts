import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const DEFAULT_HUB_ROUTE = "/hub";
const LEGACY_HUB_EXTENSIONS_ROUTE = "/hub/plugins";
const HUB_EXTENSIONS_ROUTE = "/hub/extensions";
const HUB_ROUTE_MEMORY_STORAGE_KEY = "misty:hub-route-memory";

type HubRouteMemoryStore = {
  lastHubRoute: string;
  rememberHubRoute: (pathname: string) => void;
  resetHubRoute: () => void;
};

export function isRememberableHubRoute(pathname: string) {
  return (
    pathname === "/hub" ||
    pathname === "/hub/dashboard" ||
    pathname === HUB_EXTENSIONS_ROUTE ||
    pathname === LEGACY_HUB_EXTENSIONS_ROUTE ||
    pathname === "/hub/resources/changelog"
  );
}

function safeHubRoute(pathname: string) {
  if (pathname === LEGACY_HUB_EXTENSIONS_ROUTE) {
    return HUB_EXTENSIONS_ROUTE;
  }
  return isRememberableHubRoute(pathname) ? pathname : DEFAULT_HUB_ROUTE;
}

export const useHubRouteMemoryStore = create<HubRouteMemoryStore>()(
  persist(
    (set, get) => ({
      lastHubRoute: DEFAULT_HUB_ROUTE,
      rememberHubRoute: (pathname) => {
        if (!isRememberableHubRoute(pathname)) {
          return;
        }
        if (get().lastHubRoute === pathname) return;
        set({ lastHubRoute: pathname });
      },
      resetHubRoute: () => set({ lastHubRoute: DEFAULT_HUB_ROUTE }),
    }),
    {
      name: HUB_ROUTE_MEMORY_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ lastHubRoute: state.lastHubRoute }),
      merge: (persisted, current) => {
        const route =
          persisted && typeof persisted === "object" && "lastHubRoute" in persisted
            ? String(persisted.lastHubRoute)
            : DEFAULT_HUB_ROUTE;
        return { ...current, lastHubRoute: safeHubRoute(route) };
      },
    },
  ),
);
