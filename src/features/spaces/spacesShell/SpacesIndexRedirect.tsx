import type { Space } from "@/api/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SpacePageLoadingPlaceholder } from "../components/SpacesLoadingPlaceholder";
import { preferredDefaultSpace } from "../defaultSpace";
import { useSpacesStore } from "../store/useSpacesStore";
import { defaultSpaceRoute } from "../store/useSpacesTabsStore";
import type { SpacesShellOutletContext } from "./outletContext";

/** Redirects /spaces into remembered work, preferring Misty when no route is remembered. */
export function SpacesIndexRedirect() {
  const navigate = useNavigate();
  const { openCreateSpaceDialog } = useOutletContext<SpacesShellOutletContext>();
  const { spaces, loading, error, snapshotReady, load } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      loading: state.loading,
      error: state.error,
      snapshotReady: state.snapshotReady,
      load: state.load,
    })),
  );
  const destination = resolveSpacesLandingRoute(spaces);

  useEffect(() => {
    if (!destination) return;
    navigate(destination, { replace: true, state: { spaceSwitch: true } });
  }, [destination, navigate]);

  if (loading || (!snapshotReady && !error)) {
    return <SpacePageLoadingPlaceholder label="Opening Misty" />;
  }

  if (!snapshotReady && error) {
    return (
      <SpacePageLoadingPlaceholder
        label="Loading Spaces"
        onRetry={() => void load({ force: true })}
      />
    );
  }

  if (destination) return <SpacePageLoadingPlaceholder label="Opening Space" />;

  return (
    <div className="grid h-full place-items-center px-6 py-10 text-center">
      <div className="max-w-md">
        <h1 className="m-0 text-xl font-semibold">Create your first Space</h1>
        <p className="mb-0 mt-2 text-sm leading-6 text-cream-muted">
          Bring conversations, plans, notes, and shared files together in one place.
        </p>
        <Button className="mt-5" type="button" onClick={openCreateSpaceDialog}>
          Create Space
        </Button>
      </div>
    </div>
  );
}

export function resolveSpacesLandingRoute(spaces: Space[]): string | null {
  const fallback = preferredDefaultSpace(spaces);
  if (!fallback) return null;
  return defaultSpaceRoute(fallback.id);
}
