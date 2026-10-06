import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/entities";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import { preloadSpaceSection } from "../SpaceSectionView";
import { SpaceAvatar } from "./SpaceAvatar";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";
import { SpaceSectionNavigation, spaceSections } from "./SpaceSectionNavigation";

/**
 * The top of every Space page: its name, its sections (Chat, Notes, Drawings,
 * Files, Code, also on ⌘1 to ⌘5) and its management actions. There is no
 * Space rail; the tab strip is the only bar.
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

  const focused = useWorkspaceViewFocused();
  const sectionPath = (index: number) =>
    `/spaces/${encodeURIComponent(space.id)}/${spaceSections[index].id}`;
  useShortcutHandler("space.section_1", () => void openPage(sectionPath(0)), focused);
  useShortcutHandler("space.section_2", () => void openPage(sectionPath(1)), focused);
  useShortcutHandler("space.section_3", () => void openPage(sectionPath(2)), focused);
  useShortcutHandler("space.section_4", () => void openPage(sectionPath(3)), focused);
  useShortcutHandler("space.section_5", () => void openPage(sectionPath(4)), focused);

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-3 border-b border-charcoal-border px-3"
      aria-label={`${space.name} navigation`}
    >
      <div className="flex min-w-0 shrink items-center gap-2">
        <SpaceAvatar space={space} className="size-6" />
        <h1 className="m-0 truncate text-sm font-semibold">{space.name || "Space"}</h1>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <SpaceSectionNavigation
          spaceId={space.id}
          section={["chat", "social"].includes(section) ? "social" : section}
          horizontal
          onNavigate={(path) => void openPage(path)}
        />
      </div>
      <SpaceManagementNavigation key={space.id} space={space} />
      {error ? (
        <p role="alert" className="m-0 shrink-0 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </header>
  );
}
