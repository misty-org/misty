import { useMemo } from "react";
import { useLocation } from "react-router-dom";

const validSections = new Set([
  "home",
  "social",
  "chat",
  "explore",
  "files",
  "app",
  "voice",
  "members",
  "settings",
]);
/** Old names for a page, still accepted in links. */
const renamedSections: Record<string, string> = {
  agents: "explore",
  media: "files",
  library: "files",
};
const validSettingsSections = new Set(["general", "members", "connections", "suggestions"]);

interface SpaceRoute {
  activeSpaceId: string;
  section: string;
  settingsSection: string;
  libraryCollection: string;
  conversationId: string | null;
  /** The app open on its page (`/app/<id>`), or the voice channel (`/voice/<id>`). */
  itemId: string;
}

/**
 * Reads the open Space page out of the URL.
 *
 * Space pages are driven entirely by the route, so every section, settings tab and
 * Library collection is derived here rather than mirrored into local state.
 */
export function useSpaceRoute(): SpaceRoute {
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const defaultSection = "home";
  const requestedSection = routeParts[2] ?? defaultSection;
  const routeSection = renamedSections[requestedSection] ?? requestedSection;
  const requestedSettingsSection =
    routeParts[3] === "integrations" ? "connections" : (routeParts[3] ?? "");

  return {
    activeSpaceId: routeParts[0] === "spaces" ? decodeRouteSegment(routeParts[1] ?? "") : "",
    section: validSections.has(routeSection) ? routeSection : defaultSection,
    settingsSection: validSettingsSections.has(requestedSettingsSection)
      ? requestedSettingsSection
      : "general",
    libraryCollection: search.get("collection") ?? "recent",
    conversationId: search.get("conversation"),
    // An app opens at /app/<id>, a voice channel's call at /voice/<id>.
    itemId:
      routeSection === "app" || routeSection === "voice"
        ? decodeRouteSegment(routeParts[3] ?? "")
        : "",
  };
}

/**
 * The same address under a page's current name when a Space link uses an old name, or null when
 * it already uses the current one.
 */
export function renamedSectionPath(pathname: string): string | null {
  const parts = pathname.split("/");
  // "", "spaces", the Space's id, then the page.
  const renamed = parts[1] === "spaces" ? renamedSections[parts[3] ?? ""] : undefined;
  if (!renamed) return null;
  parts[3] = renamed;
  return parts.join("/");
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
