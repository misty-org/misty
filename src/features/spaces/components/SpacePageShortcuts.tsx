import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/entities";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import { preloadSpaceSection } from "../SpaceSectionView";

/** ⌘1 to ⌘5 open these Space home tabs. */
const shortcutFilters = ["", "notes", "drawings", "files", "code"] as const;

/**
 * A Space's page shortcuts (⌘1 to ⌘5 open the home's filters). There is no bar: the
 * tab strip names the page, and the home carries the Space's name and members.
 */
export function SpacePageShortcuts({ space }: { space: Space }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestRef = useRef(0);
  const cancel = useCallback(() => {
    requestRef.current++;
  }, []);
  useEffect(() => cancel, [location.pathname, location.search, cancel]);

  async function openPage(path: string) {
    const request = ++requestRef.current;
    try {
      await preloadSpaceSection(path.split("?")[0].split("/")[3]);
      if (request !== requestRef.current) return;
      // The pane's router updates only its owning tab, including in split layouts.
      navigate(path);
    } catch {
      // A page that fails to load leaves the current one in place.
    }
  }

  const home = `/spaces/${encodeURIComponent(space.id)}/home`;
  const focused = useWorkspaceViewFocused();
  const homeTab = (index: number) =>
    shortcutFilters[index] ? `${home}?filter=${shortcutFilters[index]}` : home;
  useShortcutHandler("space.section_1", () => void openPage(homeTab(0)), focused);
  useShortcutHandler("space.section_2", () => void openPage(homeTab(1)), focused);
  useShortcutHandler("space.section_3", () => void openPage(homeTab(2)), focused);
  useShortcutHandler("space.section_4", () => void openPage(homeTab(3)), focused);
  useShortcutHandler("space.section_5", () => void openPage(homeTab(4)), focused);

  return null;
}
