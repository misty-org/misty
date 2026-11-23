import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "../api/dto/entities";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import { preloadSpaceSection } from "../overview/SpaceSectionView";

const shortcutPages = ["chat", "files"] as const;

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
      navigate(path);
    } catch {}
  }

  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const focused = useWorkspaceViewFocused();
  const page = (index: number) => `${base}/${shortcutPages[index]}`;
  useShortcutHandler("space.section_1", () => void openPage(page(0)), focused);
  useShortcutHandler("space.section_2", () => void openPage(page(1)), focused);

  return null;
}
