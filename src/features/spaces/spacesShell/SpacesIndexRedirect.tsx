import { useEffect, useRef } from "react";
import { Navigate, useOutletContext } from "react-router-dom";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpacePageLoadingPlaceholder } from "../components/SpacesLoadingPlaceholder";
import { readLastActiveSpaceId } from "./spacesShellStorage";
import type { SpacesShellOutletContext } from "./outletContext";

/**
 * The /spaces landing route: sends you to the Space you were last in.
 *
 * Falls back to the first Space, then to an empty state. The load is attempted
 * exactly once per signed-in user so a genuinely empty account does not retry
 * forever.
 */
export function SpacesIndexRedirect() {
  const { user } = useAuth();
  const { openCreateSpaceDialog } = useOutletContext<SpacesShellOutletContext>();
  const { spaces, loading, error, load } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      loading: state.loading,
      error: state.error,
      load: state.load,
    })),
  );
  const firstSpace =
    spaces.find((space) => space.id === readLastActiveSpaceId(user?.id)) ?? spaces[0];
  const [skeletonVisible] = useMinimumSpin(!firstSpace);
  const attemptedLoad = useRef(false);
  const attemptedLoadForUserId = useRef(user?.id);

  if (attemptedLoadForUserId.current !== user?.id) {
    attemptedLoadForUserId.current = user?.id;
    attemptedLoad.current = false;
  }

  useEffect(() => {
    if (!firstSpace && !loading && !attemptedLoad.current) {
      attemptedLoad.current = true;
      void load();
    }
  }, [firstSpace, load, loading]);

  if (firstSpace && !skeletonVisible)
    return <Navigate to={`/spaces/${encodeURIComponent(firstSpace.id)}/chat`} replace />;

  if (error && !loading && !skeletonVisible)
    return (
      <SpacePageLoadingPlaceholder
        label="Loading Spaces"
        onRetry={() => {
          void load({ force: true });
        }}
      />
    );

  if (!loading && !skeletonVisible && spaces.length === 0)
    return (
      <div className="grid h-full place-items-center px-6 py-10 text-center">
        <div className="max-w-md">
          <h1 className="m-0 text-2xl font-semibold">Create your first Space</h1>
          <p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">
            Start from a blank Space or choose a template with starter tasks, notes, and
            collections.
          </p>
          <Button className="mt-6" type="button" onClick={openCreateSpaceDialog}>
            <Plus size={15} />
            Create Space
          </Button>
        </div>
      </div>
    );

  return <SpacePageLoadingPlaceholder label="Loading your Spaces" />;
}
