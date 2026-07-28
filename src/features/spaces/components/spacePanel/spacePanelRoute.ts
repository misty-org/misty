import { useMemo } from "react";
import { useLocation } from "react-router-dom";

const validSections = new Set([
  "chat",
  "tasks",
  "notes",
  "drawings",
  "library",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "chat", "integrations"]);

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
  const routeSection = routeParts[2] === "files" ? "library" : (routeParts[2] ?? "chat");

  return {
    activeSpaceId: routeParts[0] === "spaces" ? decodeRouteSegment(routeParts[1] ?? "") : "",
    section: validSections.has(routeSection) ? routeSection : "chat",
    settingsSection: validSettingsSections.has(routeParts[3] ?? "")
      ? (routeParts[3] as string)
      : "general",
    libraryCollection: search.get("collection") ?? "recent",
    conversationId: search.get("conversation"),
    drawingId: routeSection === "drawings" ? decodeRouteSegment(routeParts[3] ?? "") : "",
  };
}

export function spaceSectionPath(spaceId: string, section: string, settingsSection: string) {
  const destination = section === "settings" ? `settings/${settingsSection}` : section;
  return `/spaces/${encodeURIComponent(spaceId)}/${destination}`;
}

export function spaceConversationPath(spaceId: string, conversationId: string) {
  return `/spaces/${encodeURIComponent(spaceId)}/chat?conversation=${encodeURIComponent(conversationId)}`;
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
