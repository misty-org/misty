import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppRouteMemoryStore {
  lastAppRoute: string;
  lastSpacesRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}

const defaultAppRoute = "/files";
const defaultSpacesRoute = "/spaces/personal";
const desktopRememberableRoutes = ["/spaces/personal", "/agents", "/extensions", "/changelog"];

export const useAppRouteMemoryStore = create<AppRouteMemoryStore>()(
  persist(
    (set, get) => ({
      lastAppRoute: defaultAppRoute,
      lastSpacesRoute: defaultSpacesRoute,
      rememberAppRoute: (path) => {
        const normalized = normalizeRememberedRoute(path);
        if (!normalized) return;
        const spacesRoute = normalizeRememberedSpacesRoute(path);
        const current = get();
        if (
          current.lastAppRoute === normalized &&
          (!spacesRoute || current.lastSpacesRoute === spacesRoute)
        )
          return;
        set({
          lastAppRoute: normalized,
          ...(spacesRoute ? { lastSpacesRoute: spacesRoute } : {}),
        });
      },
      resetAppRoute: () =>
        set({ lastAppRoute: defaultAppRoute, lastSpacesRoute: defaultSpacesRoute }),
    }),
    {
      name: "misty:app-route-memory",
      partialize: (state) => ({
        lastAppRoute: state.lastAppRoute,
        lastSpacesRoute: state.lastSpacesRoute,
      }),
    },
  ),
);

export function isRememberableAppRoute(path: string): boolean {
  const pathname = pathnameFromRoute(path);
  return (
    pathname === "/files" ||
    pathname === "/providers" ||
    pathname === "/transfers" ||
    pathname === "/account" ||
    desktopRememberableRoutes.includes(pathname) ||
    pathname.startsWith("/spaces/") ||
    pathname.startsWith("/studio/")
  );
}

function normalizeRememberedRoute(path: string): string | null {
  const pathname = pathnameFromRoute(path);
  if (!isRememberableAppRoute(pathname)) return null;
  if (pathname === "/library") return "/spaces/personal";
  if (pathname === "/agents") return "/agents";
  if (pathname === "/automations") return "/studio/workflows";
  return pathname;
}

function normalizeRememberedSpacesRoute(path: string): string | null {
  const pathname = pathnameFromRoute(path);
  if (pathname !== defaultSpacesRoute && !pathname.startsWith("/spaces/")) return null;
  const hashIndex = path.indexOf("#");
  return hashIndex >= 0 ? path.slice(0, hashIndex) : path;
}

function pathnameFromRoute(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end =
    [queryIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? path.length;
  return path.slice(0, end);
}
