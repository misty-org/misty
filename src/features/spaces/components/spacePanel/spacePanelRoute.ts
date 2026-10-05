import { useMemo } from "react";
import { useLocation } from "react-router-dom";

const validSections = new Set([
  "social",
  "chat",
  "notes",
  "drawings",
  "library",
  "code",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "members", "connections", "suggestions"]);

export interface SpacePanelRoute {
  activeSpaceId: string;
  section: string;
  settingsSection: string;
  libraryCollection: string;
  conversationId: string | null;
  drawingId: string;
}

/**
 * Reads the Space panel's position out of the URL.
 *
 * The panel is driven entirely by the route, so every section, settings tab and
 * Library collection is derived here rather than mirrored into local state.
 */
export function useSpacePanelRoute(): SpacePanelRoute {
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const defaultSection = "social";
  const requestedSection = routeParts[2] ?? defaultSection;
  const routeSection = requestedSection === "files" ? "library" : requestedSection;
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
    drawingId: routeSection === "drawings" ? decodeRouteSegment(routeParts[3] ?? "") : "",
  };
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
