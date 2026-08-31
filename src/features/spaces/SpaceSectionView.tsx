import { useAuth } from "@/features/auth";
import { SpaceDrawings } from "@/features/drawings";
import { HomeDashboard } from "@/features/home";
import { SpaceNotes } from "@/features/notes";
import { SpaceLibrary } from "@/features/spaces/library";
import { SpacePlanner } from "@/features/spaces/planner";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { Button, DesktopAccessState, EmptyState, PermissionState } from "@/shared/ui";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SpaceSocial } from "./chat/SpaceChatEntry";
import { SpaceSettings } from "./components/SpaceSettings";
import { SpacePageLoadingPlaceholder } from "./components/SpacesLoadingPlaceholder";
import { canOpenMistySpaceSection } from "./mistySpace";
import { useSpacesStore } from "./store/useSpacesStore";
import { socialProvider } from "./social/socialRoute";

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
  const { spaceId, section, studioKind = "", workspaceTabId } = props;
  const { user, accounts, transitioning } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { spaces, snapshotReady, referenceOnly, loading, error, load, loadSpace } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      referenceOnly: state.referenceOnly,
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

  if (!canOpenMistySpaceSection(space, section)) {
    return (
      <PermissionState
        className="h-full"
        title="Not available in this Space"
        description="You do not have permission to open this section."
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {section === "home" ? (
        <HomeDashboard key={`home:${spaceId}`} spaceId={spaceId} />
      ) : section === "library" ? (
        isWebBuild ? (
          <DesktopAccessState feature="Space Library" />
        ) : space.permissions?.["library.view"] === false ? (
          <SpacePermissionDenied
            title="Library access required"
            detail="You do not have permission to view this Space's Library."
          />
        ) : (
          <SpaceLibrary
            key={`library:${spaceId}`}
            spaceId={spaceId}
            workspaceTabId={workspaceTabId}
          />
        )
      ) : section === "planner" ? (
        space.permissions?.["tasks.view"] === false ? (
          <SpacePermissionDenied
            title="Planner access required"
            detail="Ask a Space owner to grant Planner access."
          />
        ) : (
          <SpacePlanner
            key={`planner:${spaceId}`}
            spaceId={spaceId}
            canManage={!referenceOnly && space.permissions?.["tasks.manage"] !== false}
            canManageIntegrations={!referenceOnly && space.role === "owner"}
            workspaceTabId={workspaceTabId}
          />
        )
      ) : section === "notes" ? (
        <SpaceNotes
          key={`notes:${spaceId}`}
          spaceId={spaceId}
          spaceName={space.name}
          workspaceTabId={workspaceTabId}
        />
      ) : section === "drawings" ? (
        <SpaceDrawings
          key={`drawings:${spaceId}`}
          spaceId={spaceId}
          drawingId={studioKind}
          workspaceTabId={workspaceTabId}
        />
      ) : section === "settings" ? (
        <SpaceSettings
          key={`settings:${spaceId}:${studioKind}`}
          spaceId={spaceId}
          section={studioKind}
        />
      ) : space.permissions?.["messages.read"] === false ? (
        <SpacePermissionDenied
          title="Social access required"
          detail="You do not have permission to read this Space's conversations."
        />
      ) : (
        <SpaceSocial
          key={`social:${spaceId}:${socialProvider(studioKind) ?? "misty"}`}
          spaceId={spaceId}
          spaceName={space.name}
          provider={socialProvider(studioKind) ?? "misty"}
          workspaceTabId={workspaceTabId}
        />
      )}
    </div>
  );
}

function SpacePermissionDenied({ title, detail }: { title: string; detail: string }) {
  return <PermissionState className="h-full" title={title} description={detail} />;
}
