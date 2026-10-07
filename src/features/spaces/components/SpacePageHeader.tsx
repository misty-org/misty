import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/entities";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import { preloadSpaceSection } from "../SpaceSectionView";
import { Button } from "@/shared/ui";
import { SpaceAvatar } from "./SpaceAvatar";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";

/** ⌘1 to ⌘5 open these Space home tabs. */
const shortcutFilters = ["", "notes", "drawings", "files", "code"] as const;

/**
 * The bar above a Space's item pages (a note, a drawing, a file, a project, the
 * chat): the Space's name, which leads back to its home, and its members. The
 * home has its own header, so there this renders nothing but the shortcuts.
 */
export function SpacePageHeader({ space, section }: { space: Space; section: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const cancel = useCallback(() => {
    requestRef.current++;
  }, []);
  useEffect(() => {
    setError("");
    return cancel;
  }, [location.pathname, location.search, cancel]);

  async function openPage(path: string) {
    const request = ++requestRef.current;
    setError("");
    try {
      await preloadSpaceSection(path.split("?")[0].split("/")[3]);
      if (request !== requestRef.current) return;
      // The pane's router updates only its owning tab, including in split layouts.
      navigate(path);
    } catch {
      if (request === requestRef.current) setError("Could not open this page. Try again.");
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

  if (section === "home") return null;
  return (
    <header
      className="flex h-11 shrink-0 items-center gap-2 border-b border-charcoal-border px-3"
      aria-label={`${space.name} navigation`}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void openPage(home)}
        className="min-w-0 gap-2 px-1.5 text-cream-muted"
        aria-label={`Back to ${space.name || "Space"} home`}
      >
        <ChevronLeft aria-hidden className="size-4 shrink-0" />
        <SpaceAvatar space={space} className="size-5" />
        <span className="truncate text-sm text-cream-bright">{space.name || "Space"}</span>
      </Button>
      <span className="flex-1" />
      {error ? (
        <p role="alert" className="m-0 shrink-0 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
      <SpaceManagementNavigation key={space.id} space={space} />
    </header>
  );
}
