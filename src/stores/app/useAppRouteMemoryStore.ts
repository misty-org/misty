import { create } from "zustand";
import { persist } from "zustand/middleware";

const defaultAppRoute = "/spaces";
const defaultSpacesRoute = "/spaces";
const desktopRememberableRoutes = ["/spaces"];
const validSpaceSections = new Set([
  "chat",
  "planner",
  "notes",
  "drawings",
  "library",
  "assistant",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "members", "chat", "connections"]);
const validTaskViews = new Set(["board", "list", "calendar"]);

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
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppRouteMemoryStore> | undefined;
        const lastSpacesRoute = normalizeRememberedSpacesRoute(
          persisted?.lastSpacesRoute ?? defaultSpacesRoute,
        );
        return {
          ...currentState,
          lastAppRoute:
            normalizeRememberedRoute(persisted?.lastAppRoute ?? defaultAppRoute) ?? defaultAppRoute,
          lastSpacesRoute: lastSpacesRoute ?? defaultSpacesRoute,
        };
      },
    },
  ),
);

export function isRememberableAppRoute(path: string): boolean {
  const pathname = pathnameFromRoute(path);
  return (
    pathname === "/files" ||
    pathname === "/transfers" ||
    pathname === "/account" ||
    desktopRememberableRoutes.includes(pathname) ||
    pathname.startsWith("/spaces/")
  );
}

function normalizeRememberedRoute(path: string): string | null {
  const pathname = pathnameFromRoute(path);
  if (!isRememberableAppRoute(pathname)) return null;
  if (pathname === "/library") return "/files";
  if (pathname.startsWith("/spaces/")) {
    const spacesRoute = normalizeRememberedSpacesRoute(path);
    return spacesRoute ? pathnameFromRoute(spacesRoute) : null;
  }
  return pathname;
}

export function normalizeRememberedSpacesRoute(path: string): string | null {
  const pathname = pathnameFromRoute(path);
  if (pathname === defaultSpacesRoute) return defaultSpacesRoute;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return null;

  const base = `/spaces/${parts[1]}`;
  const requestedSection =
    parts[2] === "files" ? "library" : parts[2] === "tasks" ? "planner" : parts[2];
  if (!requestedSection || !validSpaceSections.has(requestedSection)) return base;

  let normalizedPath = `${base}/${requestedSection}`;
  if (requestedSection === "planner" && validTaskViews.has(parts[3] ?? "")) {
    normalizedPath += `/${parts[3]}`;
  }
  if (requestedSection === "settings") {
    const requestedSettingsSection = parts[3] === "integrations" ? "connections" : parts[3];
    normalizedPath += `/${
      validSettingsSections.has(requestedSettingsSection ?? "")
        ? requestedSettingsSection
        : "general"
    }`;
  }

  const query = safeSpaceQuery(path, requestedSection);
  return `${normalizedPath}${query}`;
}

function safeSpaceQuery(path: string, section: string): string {
  const queryIndex = path.indexOf("?");
  if (queryIndex < 0) return "";
  const hashIndex = path.indexOf("#", queryIndex);
  const params = new URLSearchParams(
    path.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : path.length),
  );
  const allowed =
    section === "chat"
      ? new Set(["conversation", "message"])
      : section === "planner"
        ? new Set(["q", "status", "assignee", "priority", "due", "mine", "sort"])
        : section === "library"
          ? new Set(["collection"])
          : section === "notes"
            ? new Set(["group"])
            : new Set<string>();
  for (const key of [...params.keys()]) {
    if (!allowed.has(key)) params.delete(key);
  }
  return params.size ? `?${params.toString()}` : "";
}

function pathnameFromRoute(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end =
    [queryIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? path.length;
  return path.slice(0, end);
}

export interface AppRouteMemoryStore {
  lastAppRoute: string;
  lastSpacesRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}
