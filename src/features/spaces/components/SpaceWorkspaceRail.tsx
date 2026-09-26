import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { cn } from "@/shared/ui";
import { useSpacesStore } from "../store/useSpacesStore";
import { preloadSpaceSection } from "../SpaceSectionView";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
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

  async function openPage(path: string, state?: { spaceSettingsReturnTo: string }) {
    const request = ++requestRef.current;
    setError("");
    try {
      await preloadSpaceSection(path.split("/")[3]);
      if (request !== requestRef.current) return;
      // The pane's router updates only its owning tab, including in split layouts.
      navigate(path, { state });
    } catch {
      if (request === requestRef.current) setError("Could not open this page. Try again.");
    }
  }

  if (!user) return null;
  return (
    <>
      <aside
        className="misty-navigation-icons flex h-full w-14 shrink-0 flex-col items-center overflow-y-auto border-r border-charcoal-border bg-charcoal-workspace pb-2 pt-1.5"
        aria-label="Space navigation"
      >
        {space && (
          <>
            <SpaceSectionNavigation
              spaceId={space.id}
              section={["home", "chat"].includes(section) ? "social" : section}
              iconOnly
              onNavigate={(path) => void openPage(path)}
            />
            <div className="mt-auto pt-2">
              <SpaceManagementNavigation key={space.id} space={space} />
            </div>
          </>
        )}
        <div className={cn("flex shrink-0 items-center justify-center pt-1", !space && "mt-auto")}>
          <SpaceSwitcher
            iconOnly
            activeSpace={space}
            activeSpaceId={activeSpaceId}
            spaces={spaces}
            userId={user.id}
            canAddSpace
            onNavigate={(path, state) => void openPage(path, state)}
          />
        </div>
      </aside>
      {error && (
        <p
          role="alert"
          className="absolute bottom-3 left-16 right-3 z-10 rounded-md border border-charcoal-border bg-charcoal-card p-3 text-xs text-cream"
        >
          {error}
        </p>
      )}
    </>
  );
}
