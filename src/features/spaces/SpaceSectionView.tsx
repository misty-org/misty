import { useAuth } from "@/features/auth";
import { HomeDashboard } from "@/features/home";
import { Button, EmptyState, PermissionState } from "@/shared/ui";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SpaceSettings } from "./components/SpaceSettings";
import { SpacePageLoadingPlaceholder } from "./components/SpacesLoadingPlaceholder";
import { useSpacesStore } from "./store/useSpacesStore";

/**
 * One Space section, rendered from props rather than the router.
 *
 * The dock can show the same Space in several panes at once, and there is only
 * one router URL — so pane content cannot come from the outlet. Everything
 * here is therefore driven by `spaceId`/`section`, and nothing in it navigates
 * on its own: a background pane that issued redirects would move the whole app
 * out from under the focused one. Route normalisation stays in `SpaceDetail`.
 */
export function SpaceSectionView(props: {
  spaceId: string;
  section: string;
  studioKind?: string;
  workspaceTabId?: string;
}) {
  const { spaceId, section, studioKind = "" } = props;
  const { user, accounts, transitioning } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { spaces, snapshotReady, loading, error, load, loadSpace } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      loading: state.loading,
      error: state.error,
      load: state.load,
      loadSpace: state.loadSpace,
    })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId && user) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user]);

  if (transitioning) return <SpacePageLoadingPlaceholder label="Switching accounts" />;

  if (!user) {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <PermissionState
        className="h-full"
        title="Log in to view this Space"
        description="Sign in to your Misty account to open Spaces and see their content."
        action={
          <Button
            type="button"
            onClick={() => navigate("/signin", { state: { from: returnPath } })}
          >
            {accounts.length > 0 ? "Switch account" : "Log in"}
          </Button>
        }
      />
    );
  }

  if (!snapshotReady && error) {
    return (
      <SpacePageLoadingPlaceholder
        label="Loading Space"
        onRetry={() => {
          void load({ force: true }).then(() => {
            if (useSpacesStore.getState().snapshotReady) void loadSpace(spaceId);
          });
        }}
      />
    );
  }

  if (!snapshotReady || (!space && loading)) return <SpacePageLoadingPlaceholder />;

  if (!space) {
    return (
      <EmptyState
        className="h-full"
        title="This Space isn’t available"
        description="This Space may have been removed, or you may no longer have access."
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {section === "home" ? (
        <HomeDashboard key={`home:${spaceId}`} spaceId={spaceId} />
      ) : section === "settings" ? (
        <SpaceSettings
          key={`settings:${spaceId}:${studioKind}`}
          spaceId={spaceId}
          section={studioKind}
        />
      ) : (
        <EmptyState
          className="h-full"
          title="This view moved to Apps"
          description="Open the corresponding App from the navbar or Discover. Legacy Space tool routes are no longer supported."
        />
      )}
    </div>
  );
}
