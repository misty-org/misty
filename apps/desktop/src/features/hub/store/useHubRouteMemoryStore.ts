import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const DEFAULT_HUB_ROUTE = "/hub";
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
    pathname === "/hub/plugins" ||
    pathname === "/hub/resources/changelog" ||
    pathname === "/hub/account" ||
    pathname === "/hub/settings" ||
    pathname === "/hub/docs" ||
    pathname.startsWith("/hub/docs/")
  );
}

function safeHubRoute(pathname: string) {
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
