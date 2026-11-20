import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "../api/dto/entities";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import { preloadSpaceSection } from "../overview/SpaceSectionView";

/** ⌘1 to ⌘3: the Space's chat, its Files and its Lab. */
const shortcutPages = ["chat", "files", "lab"] as const;

/** A Space's page shortcuts (⌘1 to ⌘3). There is no bar: the tab strip names the page. */
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

  return null;
}
