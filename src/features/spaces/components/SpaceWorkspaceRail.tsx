import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { WorkspaceSectionLabel, WorkspaceSidebar } from "@/shared/ui";
import { SpaceRecentNavigation } from "./SpaceRecentNavigation";
import { useSpacesStore } from "../store/useSpacesStore";
import { preloadSpaceSection } from "../SpaceSectionView";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpaceSidebarHeader } from "./SpaceSidebarHeader";

export function SpaceWorkspaceRail({
  activeSpaceId,
  section,
  onNavigated,
}: {
  activeSpaceId: string;
  section: string;
  onNavigated?: () => void;
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
  }, [location.pathname, location.search, user?.id, cancelNavigation]);

  async function openPage(path: string) {
    const request = ++requestRef.current;
    setError("");
    try {
      await preloadSpaceSection(path.split("?")[0].split("/")[3]);
      if (request !== requestRef.current) return;
      // The pane's router updates only its owning tab, including in split layouts.
      navigate(path);
      onNavigated?.();
    } catch {
      if (request === requestRef.current) setError("Could not open this page. Try again.");
    }
  }

  if (!user) return null;
  const chatSection = ["chat", "social"].includes(section);
  return (
    <>
      <WorkspaceSidebar className="gap-1 pt-3" aria-label="Space navigation">
        {space && (
          <>
            <SpaceSidebarHeader space={space} />
            <div className="mb-1.5 shrink-0">
              <WorkspaceSectionLabel className="mt-2">Explore</WorkspaceSectionLabel>
              <SpaceSectionNavigation
                spaceId={space.id}
                section={chatSection ? "social" : section}
                onNavigate={(path) => void openPage(path)}
              />
            </div>
            <SpaceRecentNavigation space={space} onNavigate={(path) => void openPage(path)} />
          </>
        )}
      </WorkspaceSidebar>
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
