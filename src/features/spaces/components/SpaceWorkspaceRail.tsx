import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { cn } from "@/shared/ui";
import { useSpacesStore } from "../store/useSpacesStore";
import { preloadSpaceSection } from "../SpaceSectionView";
import { SpaceChatSidebar } from "../chat/sidebar/SpaceChatSidebar";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpaceSidebarHeader } from "./SpaceSidebarHeader";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";

export function SpaceWorkspaceRail({
  activeSpaceId,
  section,
}: {
  activeSpaceId: string;
  section: string;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const spaces = useSpacesStore((state) => state.spaces);
  const space = spaces.find((item) => item.id === activeSpaceId);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const cancelNavigation = useCallback(() => {
    requestRef.current++;
  }, []);
  useEffect(() => {
    setError("");
    return cancelNavigation;
  }, [location.pathname, user?.id, cancelNavigation]);

  async function openPage(path: string) {
    const request = ++requestRef.current;
    setError("");
    try {
      await preloadSpaceSection(path.split("/")[3]);
      if (request !== requestRef.current) return;
      // The pane's router updates only its owning tab, including in split layouts.
      navigate(path);
    } catch {
      if (request === requestRef.current) setError("Could not open this page. Try again.");
    }
  }

  if (!user) return null;
  const chatSection = ["home", "chat", "social"].includes(section);
  return (
    <>
      <aside
        className={cn(
          "misty-navigation-icons flex h-full w-52 shrink-0 flex-col items-stretch",
          "overflow-hidden border-r border-charcoal-border bg-charcoal-workspace",
          "px-2 pb-2 pt-2.5",
        )}
        aria-label="Space navigation"
      >
        {space && (
          <>
            <SpaceSidebarHeader space={space} />
            <div className="mb-3 mt-2 shrink-0">
              <SpaceSectionNavigation
                strip
                spaceId={space.id}
                section={chatSection ? "social" : section}
                onNavigate={(path) => void openPage(path)}
              />
            </div>
            {/* The rest of the sidebar belongs to the active tool's own list. */}
            {chatSection ? (
              <SpaceChatSidebar spaceId={space.id} onNavigate={(path) => void openPage(path)} />
            ) : (
              <div className="flex-1" />
            )}
            <div className="shrink-0 border-t border-charcoal-border/70 pt-2">
              <SpaceManagementNavigation key={space.id} space={space} compact={false} />
            </div>
          </>
        )}
      </aside>
      {error && (
        <p
          role="alert"
          className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-charcoal-border bg-charcoal-card p-3 text-xs text-cream"
        >
          {error}
        </p>
      )}
    </>
  );
}
