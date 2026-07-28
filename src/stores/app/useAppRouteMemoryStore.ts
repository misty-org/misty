import type { AppRouteMemoryStore } from "@/models/interfaces/stores/app/useAppRouteMemoryStore";
export type { AppRouteMemoryStore } from "@/models/interfaces/stores/app/useAppRouteMemoryStore";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const defaultAppRoute = "/files";
const defaultSpacesRoute = "/spaces";
const desktopRememberableRoutes = ["/spaces"];
const validSpaceSections = new Set([
  "chat",
  "tasks",
  "notes",
  "drawings",
  "library",
  "assistant",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "chat", "integrations"]);
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
  const requestedSection = parts[2] === "files" ? "library" : parts[2];
  if (!requestedSection || !validSpaceSections.has(requestedSection)) return base;

  let normalizedPath = `${base}/${requestedSection}`;
  if (requestedSection === "tasks" && validTaskViews.has(parts[3] ?? "")) {
    normalizedPath += `/${parts[3]}`;
  }
  if (requestedSection === "settings") {
    normalizedPath += `/${validSettingsSections.has(parts[3] ?? "") ? parts[3] : "general"}`;
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
  // "mika" is the pre-rename name for the agent panel query parameter. It stays
  // allowed so a route persisted before the rename still round-trips instead of
  // being silently stripped; "agent" is what is written now.
  const agentPanelParams = ["agent", "mika"];
  const allowed =
    section === "chat"
      ? new Set(["conversation", "message", ...agentPanelParams])
      : section === "tasks"
        ? new Set([
            "q",
            "status",
            "assignee",
            "priority",
            "due",
            "mine",
            "sort",
            ...agentPanelParams,
          ])
        : section === "library"
          ? new Set(["collection", ...agentPanelParams])
          : section === "notes"
            ? new Set(["group"])
            : new Set(agentPanelParams);
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
