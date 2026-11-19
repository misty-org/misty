import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "../api/dto/entities";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import { preloadSpaceSection } from "../overview/SpaceSectionView";

/** ⌘1 to ⌘4: the home, the Docs and Whiteboards pages, and the home's files. */
const shortcutPages = ["home", "notes", "drawings", "home?filter=files"] as const;

/**
 * A Space's page shortcuts (⌘1 to ⌘4). There is no bar: the tab strip names the page, and the
 * home carries the Space's name and members.
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

  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const focused = useWorkspaceViewFocused();
  const page = (index: number) => `${base}/${shortcutPages[index]}`;
  useShortcutHandler("space.section_1", () => void openPage(page(0)), focused);
  useShortcutHandler("space.section_2", () => void openPage(page(1)), focused);
  useShortcutHandler("space.section_3", () => void openPage(page(2)), focused);
  useShortcutHandler("space.section_4", () => void openPage(page(3)), focused);

  return null;
}
